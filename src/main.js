// 应用入口：组装地图、面板、工具栏、模态框、调试控制台
import './styles/main.css';
import L from 'leaflet';
import { MapManager } from './lib/mapManager.js';
import { getSettings, saveSettings, folders, markers as markersDB, tracks as tracksDB, profiles } from './lib/storage.js';
import { initAuth, getUser, isAdmin, isLoggedIn, login, register, logout } from './lib/auth.js';
import { importData, exportData, downloadFile } from './lib/fileio.js';
import { getLogs, clearLogs } from './lib/debug.js';
import { CRS } from './lib/coord.js';

let mapMgr = null;
let currentPanel = null;
let toastTimer = null;
let allFolders = [];
let allMarkers = [];
let allTracks = [];
let expandedFolders = new Set();

// ---- Toast ----
function toast(msg) {
  let el = document.querySelector('.toast');
  if (el) el.remove();
  el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3000);
}

// ---- 模态框 ----
function showModal(title, bodyHTML, footerHTML = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>${title}</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  return { overlay, close };
}

// ---- HTML 转义 ----
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- 顶栏 ----
function renderTopbar() {
  const user = getUser();
  const tb = document.querySelector('.topbar');
  tb.innerHTML = `
    <span class="logo">小兵地图</span>
    <span class="spacer"></span>
    <button class="btn-icon" id="btnPanel" title="收藏夹">☰</button>
    <button class="btn-icon" id="btnDebug" title="调试控制台">bug</button>
    ${user ? `<span class="user-badge ${isAdmin() ? 'admin' : ''}">${esc(user.username)}${isAdmin() ? ' ★' : ''}</span>` : ''}
    <button class="btn-icon" id="btnAuth" title="账号">${user ? '⎋' : '⨀'}</button>
  `;
  document.getElementById('btnPanel').onclick = () => togglePanel('list');
  document.getElementById('btnDebug').onclick = toggleDebug;
  document.getElementById('btnAuth').onclick = () => user ? doLogout() : showAuthModal();
  if (isAdmin()) addAdminButton();
}

// ---- 工具栏 ----
function renderToolbar() {
  const tb = document.querySelector('.toolbar');
  tb.innerHTML = `
    <button class="tool-btn" id="toolAddMarker" title="打点">📍</button>
    <button class="tool-btn" id="toolDrawTrack" title="绘制线路">〰</button>
    <button class="tool-btn" id="toolDistance" title="测距">📏</button>
    <button class="tool-btn" id="toolArea" title="测面积">▦</button>
    <button class="tool-btn" id="toolImport" title="导入">📥</button>
    <button class="tool-btn" id="toolExport" title="导出">📤</button>
    <button class="tool-btn" id="toolClearDraw" title="清除绘制">✕</button>
  `;
  document.getElementById('toolAddMarker').onclick = addMarkerMode;
  document.getElementById('toolDrawTrack').onclick = drawTrackMode;
  document.getElementById('toolDistance').onclick = measureDistanceMode;
  document.getElementById('toolArea').onclick = measureAreaMode;
  document.getElementById('toolImport').onclick = showImportModal;
  document.getElementById('toolExport').onclick = showExportModal;
  document.getElementById('toolClearDraw').onclick = () => { mapMgr.clearDrawn(); toast('已清除绘制'); };
}

// ---- GPS 按钮 ----
function renderGPSBtn() {
  const btn = document.querySelector('.gps-btn');
  btn.onclick = async () => {
    btn.classList.add('locating');
    try {
      const { latlng, accuracy } = await mapMgr.locateGPS();
      toast(`已定位，精度 ${Math.round(accuracy)}m`);
    } catch (e) {
      toast('定位失败: ' + e.message);
    } finally {
      btn.classList.remove('locating');
    }
  };
}

// ---- 坐标搜索 ----
function parseCoordInput(input) {
  input = input.trim();
  const dmsMatch = input.match(/(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([NSns])?[\s,]+(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([EWewE]?)/);
  if (dmsMatch) {
    const lat = parseInt(dmsMatch[1]) + parseInt(dmsMatch[2]) / 60 + parseFloat(dmsMatch[3]) / 3600;
    const lng = parseInt(dmsMatch[5]) + parseInt(dmsMatch[6]) / 60 + parseFloat(dmsMatch[7]) / 3600;
    const latVal = (dmsMatch[4] || '').toUpperCase() === 'S' ? -lat : lat;
    const lngVal = (dmsMatch[8] || '').toUpperCase() === 'W' ? -lng : lng;
    return { lat: latVal, lng: lngVal };
  }
  const parts = input.split(/[\s,]+/).filter(s => s).map(parseFloat);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    let [a, b] = parts;
    if (a >= 60 && a <= 150) return { lat: b, lng: a };
    else if (b >= 60 && b <= 150) return { lat: a, lng: b };
    return { lat: b, lng: a };
  }
  return null;
}

function renderSearchBox() {
  const input = document.getElementById('coordSearch');
  const btn = document.getElementById('searchGo');

  const doSearch = async () => {
    const val = input.value.trim();
    if (!val) { toast('请输入坐标或名称'); return; }

    const coord = parseCoordInput(val);
    if (coord) {
      mapMgr.flyToCoord(coord.lat, coord.lng);
      toast(`已定位到坐标: ${coord.lng.toFixed(6)}, ${coord.lat.toFixed(6)}`);
      return;
    }

    const q = val.toLowerCase();
    const matchMarkers = allMarkers.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.remark || '').toLowerCase().includes(q)
    );
    const matchTracks = allTracks.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.remark || '').toLowerCase().includes(q)
    );

    if (matchMarkers.length === 0 && matchTracks.length === 0) {
      toast('未找到匹配的点位或线路');
      return;
    }
    if (matchMarkers.length === 1 && matchTracks.length === 0) {
      mapMgr.flyToMarker(matchMarkers[0]);
      toast(`已定位: ${matchMarkers[0].name}`);
      return;
    }
    if (matchTracks.length === 1 && matchMarkers.length === 0) {
      mapMgr.flyToTrack(matchTracks[0]);
      toast(`已定位: ${matchTracks[0].name}`);
      return;
    }
    showSearchResults(matchMarkers, matchTracks);
  };

  btn.onclick = doSearch;
  input.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
}

function showSearchResults(markers, tracks) {
  let body = '<div style="max-height:300px;overflow-y:auto">';
  for (const m of markers) {
    body += `<div class="list-item" data-srch-mk="${m.id}">
      <span class="item-icon">📍</span>
      <div class="item-info"><div class="item-name">${esc(m.name)}</div><div class="item-sub">${m.lng?.toFixed(4)},${m.lat?.toFixed(4)}</div></div>
    </div>`;
  }
  for (const t of tracks) {
    body += `<div class="list-item" data-srch-tk="${t.id}">
      <span class="item-icon">〰</span>
      <div class="item-info"><div class="item-name">${esc(t.name)}</div><div class="item-sub">${(t.points||[]).length} 个点</div></div>
    </div>`;
  }
  body += '</div>';
  const { close } = showModal(`搜索结果 (${markers.length + tracks.length})`, body);
  document.querySelectorAll('[data-srch-mk]').forEach(el => {
    el.onclick = () => {
      const m = markers.find(x => x.id === el.dataset.srchMk);
      if (m) { mapMgr.flyToMarker(m); close(); }
    };
  });
  document.querySelectorAll('[data-srch-tk]').forEach(el => {
    el.onclick = () => {
      const t = tracks.find(x => x.id === el.dataset.srchTk);
      if (t) { mapMgr.flyToTrack(t); close(); }
    };
  });
}

// ---- 坐标显示 ----
function updateCoordDisplay(latlng) {
  const el = document.querySelector('.coord-display');
  if (!el) return;
  const disp = mapMgr._toDisplay(latlng);
  el.textContent = `经度: ${disp.lng.toFixed(6)}  纬度: ${disp.lat.toFixed(6)}  [${mapMgr.currentCRS}]`;
}

// ---- 加载数据 ----
async function loadAllData() {
  const [foldersData, markersData, tracksData] = await Promise.all([
    folders.list(),
    markersDB.list(),
    tracksDB.list(),
  ]);
  allFolders = foldersData;
  allMarkers = markersData;
  allTracks = tracksData;
}

async function loadUserData(userId) {
  const [markersData, tracksData] = await Promise.all([
    markersDB.listByUser(userId),
    tracksDB.listByUser(userId),
  ]);
  return { markers: markersData, tracks: tracksData };
}

// ---- 打点 ----
function addMarkerMode() {
  toast('点击地图添加点位');
  mapMgr.onMapClick = async (dispLatLng) => {
    mapMgr.onMapClick = null;
    // 点击的显示坐标转回WGS84
    const wgs84 = mapMgr._fromDisplay(dispLatLng);
    showMarkerModal({ lat: wgs84.lat, lng: wgs84.lng });
  };
}

async function showMarkerModal(partial) {
  const folderTree = buildFolderSelectOptions();
  const body = `
    <div class="form-group"><label>名称</label><input class="form-input" id="mkName" placeholder="点位名称"></div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="mkRemark" placeholder="备注信息"></textarea></div>
    <div class="form-group"><label>收藏夹</label>${folderTree}</div>
    <div class="form-group" id="mkNewFolderWrap" style="display:none"><label>新文件夹名</label><input class="form-input" id="mkNewFolder"></div>
    <div class="form-group"><label>坐标</label>
      <div style="font-family:monospace;font-size:13px;color:var(--text-muted)">
        ${partial.lng?.toFixed(6) || ''}, ${partial.lat?.toFixed(6) || ''} (WGS84)
      </div>
    </div>`;
  const footer = `<button class="btn btn-outline" id="mkCancel">取消</button><button class="btn btn-primary" id="mkSave">保存</button>`;
  const { close } = showModal('添加点位', body, footer);
  document.getElementById('mkCancel').onclick = close;
  const folderSel = document.getElementById('mkFolderSel');
  const newFolderWrap = document.getElementById('mkNewFolderWrap');
  folderSel.onchange = (e) => {
    newFolderWrap.style.display = e.target.value === '__new' ? 'block' : 'none';
  };
  document.getElementById('mkSave').onclick = async () => {
    const name = document.getElementById('mkName').value.trim() || '未命名点位';
    const remark = document.getElementById('mkRemark').value.trim();
    const folderVal = folderSel.value;
    let folderId = null;
    if (folderVal === '__new') {
      const newName = document.getElementById('mkNewFolder').value.trim();
      if (newName) {
        const f = await folders.create(newName, null);
        folderId = f.id;
      }
    } else if (folderVal && folderVal !== '__root') {
      folderId = folderVal;
    }
    try {
      const created = await markersDB.create({ name, remark, lat: partial.lat, lng: partial.lng, folder_id: folderId });
      allMarkers.unshift(created);
      mapMgr.addMarker(created);
      close();
      toast('点位已添加');
      if (currentPanel === 'list') renderListPanel();
    } catch (e) {
      toast('保存失败: ' + e.message);
    }
  };
}

// ---- 绘制线路 ----
function drawTrackMode() {
  toast('点击地图绘制线路，双击结束');
  mapMgr.enableDrawTrack(async (pts) => {
    const folderTree = buildFolderSelectOptions();
    const body = `
      <div class="form-group"><label>名称</label><input class="form-input" id="tkName" placeholder="线路名称"></div>
      <div class="form-group"><label>备注</label><textarea class="form-textarea" id="tkRemark"></textarea></div>
      <div class="form-group"><label>收藏夹</label>${folderTree}</div>
      <div class="form-group" id="tkNewFolderWrap" style="display:none"><label>新文件夹名</label><input class="form-input" id="tkNewFolder"></div>
      <div class="form-group"><label>点数</label><div style="color:var(--text-muted)">${pts.length} 个点</div></div>`;
    const footer = `<button class="btn btn-outline" id="tkCancel">取消</button><button class="btn btn-primary" id="tkSave">保存</button>`;
    const { close } = showModal('保存线路', body, footer);
    document.getElementById('tkCancel').onclick = close;
    const folderSel = document.getElementById('tkFolderSel');
    const newFolderWrap = document.getElementById('tkNewFolderWrap');
    folderSel.onchange = (e) => {
      newFolderWrap.style.display = e.target.value === '__new' ? 'block' : 'none';
    };
    document.getElementById('tkSave').onclick = async () => {
      const name = document.getElementById('tkName').value.trim() || '未命名线路';
      const remark = document.getElementById('tkRemark').value.trim();
      const folderVal = folderSel.value;
      let folderId = null;
      if (folderVal === '__new') {
        const newName = document.getElementById('tkNewFolder').value.trim();
        if (newName) {
          const f = await folders.create(newName, null);
          folderId = f.id;
        }
      } else if (folderVal && folderVal !== '__root') {
        folderId = folderVal;
      }
      try {
        const created = await tracksDB.create({ name, remark, points: pts, folder_id: folderId });
        allTracks.unshift(created);
        mapMgr.addTrack(created);
        close();
        toast('线路已保存');
        if (currentPanel === 'list') renderListPanel();
      } catch (e) {
        toast('保存失败: ' + e.message);
      }
    };
  });
}

// ---- 测距/测面积 ----
function measureDistanceMode() {
  toast('点击地图测距，双击结束');
  mapMgr.enableMeasureDistance((dist) => {
    toast(`距离: ${(dist / 1000).toFixed(2)} km`);
  });
}

function measureAreaMode() {
  toast('点击地图测面积，双击结束');
  mapMgr.enableMeasureArea((area) => {
    toast(`面积: ${(area / 1000000).toFixed(4)} km²`);
  });
}

// ---- 收藏夹树形结构 ----
function buildFolderSelectOptions() {
  const tree = buildFolderTree(allFolders);
  let opts = '<select class="form-select" id="mkFolderSel"><option value="__root">根目录</option>';
  function walk(nodes, depth) {
    for (const n of nodes) {
      opts += `<option value="${n.id}">${'　'.repeat(depth)}📁 ${esc(n.name)}</option>`;
      walk(n.children || [], depth + 1);
    }
  }
  walk(tree, 0);
  opts += '<option value="__new">+ 新文件夹</option></select>';
  return opts;
}

function buildFolderTree(folderList) {
  const map = new Map();
  const roots = [];
  for (const f of folderList) {
    map.set(f.id, { ...f, children: [] });
  }
  for (const f of folderList) {
    const node = map.get(f.id);
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function renderListPanel() {
  const panel = document.querySelector('.side-panel');
  const tree = buildFolderTree(allFolders);
  const rootMarkers = allMarkers.filter(m => !m.folder_id);
  const rootTracks = allTracks.filter(t => !t.folder_id);

  let html = '<div class="folder-toolbar">' +
    '<button class="btn btn-outline btn-sm" id="btnNewFolder">+ 新建文件夹</button>' +
    '<button class="btn btn-outline btn-sm" id="btnExpandAll">全部展开</button>' +
    '<button class="btn btn-outline btn-sm" id="btnCollapseAll">全部收起</button>' +
    '</div>';

  if (tree.length === 0 && rootMarkers.length === 0 && rootTracks.length === 0) {
    html = '<div class="empty-state"><div class="icon">📍</div>暂无收藏数据<br>点击工具栏添加点位或线路</div>';
  } else {
    // 根目录下的散落数据
    if (rootMarkers.length > 0 || rootTracks.length > 0) {
      html += renderFolderHeader('未分类', '__root', rootMarkers, rootTracks, true);
      if (expandedFolders.has('__root')) {
        html += renderItems(rootMarkers, rootTracks, '__root');
      }
    }
    // 文件夹树
    for (const node of tree) {
      html += renderFolderNode(node, 0);
    }
  }

  panel.querySelector('.panel-body').innerHTML = html;
  bindFolderEvents();
  bindItemEvents();
}

function renderFolderNode(node, depth) {
  const folderMarkers = allMarkers.filter(m => m.folder_id === node.id);
  const folderTracks = allTracks.filter(t => t.folder_id === node.id);
  const childCount = countAllDescendants(node);
  const total = folderMarkers.length + folderTracks.length + childCount;
  const isExpanded = expandedFolders.has(node.id);

  let html = renderFolderHeader(node.name, node.id, folderMarkers, folderTracks, isExpanded, depth, total);
  if (isExpanded) {
    html += renderItems(folderMarkers, folderTracks, node.id);
    for (const child of node.children || []) {
      html += renderFolderNode(child, depth + 1);
    }
  }
  return html;
}

function countAllDescendants(node) {
  let count = 0;
  for (const child of node.children || []) {
    count += allMarkers.filter(m => m.folder_id === child.id).length;
    count += allTracks.filter(t => t.folder_id === child.id).length;
    count += countAllDescendants(child);
  }
  return count;
}

function renderFolderHeader(name, id, folderMarkers, folderTracks, isExpanded, depth = 0, total = null) {
  const count = total !== null ? total : folderMarkers.length + folderTracks.length;
  const indent = depth * 16;
  const arrow = isExpanded ? '▾' : '▸';
  return `
    <div class="folder-header" data-folder="${id}" style="padding-left:${12 + indent}px">
      <span class="folder-arrow">${arrow}</span>
      <span class="folder-icon">📁</span>
      <span class="folder-name">${esc(name)}</span>
      <span class="folder-count">${count}</span>
      <span class="folder-actions">
        <button data-add-folder="${id}" title="子文件夹" class="folder-btn">＋</button>
        <button data-del-folder="${id}" title="删除文件夹" class="folder-btn">✕</button>
      </span>
    </div>`;
}

function renderItems(folderMarkers, folderTracks, folderId) {
  let html = '';
  for (const m of folderMarkers) {
    html += `<div class="list-item" data-mid="${m.id}" data-folder="${folderId}">
      <span class="item-icon">📍</span>
      <div class="item-info"><div class="item-name">${esc(m.name)}</div><div class="item-sub">${esc(m.remark || '')}</div></div>
      <div class="item-actions">
        <button data-edit-mk="${m.id}" title="编辑">✎</button>
        <button data-del-mk="${m.id}" title="删除">✕</button>
      </div>
    </div>`;
  }
  for (const t of folderTracks) {
    html += `<div class="list-item" data-tid="${t.id}" data-folder="${folderId}">
      <span class="item-icon">〰</span>
      <div class="item-info"><div class="item-name">${esc(t.name)}</div><div class="item-sub">${(t.points||[]).length} 个点</div></div>
      <div class="item-actions">
        <button data-edit-tk="${t.id}" title="编辑">✎</button>
        <button data-del-tk="${t.id}" title="删除">✕</button>
      </div>
    </div>`;
  }
  return html;
}

function bindFolderEvents() {
  // 展开/收起
  document.querySelectorAll('.folder-header').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('.folder-actions')) return;
      const id = el.dataset.folder;
      if (expandedFolders.has(id)) {
        expandedFolders.delete(id);
      } else {
        expandedFolders.add(id);
      }
      renderListPanel();
    };
  });

  // 新建子文件夹
  document.querySelectorAll('[data-add-folder]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const parentId = btn.dataset.addFolder;
      const realParentId = parentId === '__root' ? null : parentId;
      showNewFolderModal(realParentId);
    };
  });

  // 删除文件夹
  document.querySelectorAll('[data-del-folder]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delFolder;
      if (id === '__root') return;
      if (!confirm('删除文件夹将同时删除其中的所有子文件夹和收藏，确认删除？')) return;
      try {
        await folders.remove(id);
        allFolders = allFolders.filter(f => f.id !== id);
        allMarkers = allMarkers.filter(m => m.folder_id !== id);
        allTracks = allTracks.filter(t => t.folder_id !== id);
        renderListPanel();
        refreshMap();
        toast('文件夹已删除');
      } catch (err) {
        toast('删除失败: ' + err.message);
      }
    };
  });

  // 工具栏按钮
  const btnNewFolder = document.getElementById('btnNewFolder');
  if (btnNewFolder) btnNewFolder.onclick = () => showNewFolderModal(null);
  const btnExpandAll = document.getElementById('btnExpandAll');
  if (btnExpandAll) btnExpandAll.onclick = () => {
    function addAll(nodes) {
      for (const n of nodes) {
        expandedFolders.add(n.id);
        addAll(n.children || []);
      }
    }
    expandedFolders.add('__root');
    addAll(buildFolderTree(allFolders));
    renderListPanel();
  };
  const btnCollapseAll = document.getElementById('btnCollapseAll');
  if (btnCollapseAll) btnCollapseAll.onclick = () => {
    expandedFolders.clear();
    renderListPanel();
  };
}

function bindItemEvents() {
  // 点位点击
  document.querySelectorAll('[data-mid]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('.item-actions')) return;
      const m = allMarkers.find(x => x.id === el.dataset.mid);
      if (m) mapMgr.flyToMarker(m);
    };
  });
  // 线路点击
  document.querySelectorAll('[data-tid]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('.item-actions')) return;
      const t = allTracks.find(x => x.id === el.dataset.tid);
      if (t) mapMgr.flyToTrack(t);
    };
  });
  // 删除点位
  document.querySelectorAll('[data-del-mk]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delMk;
      try {
        await markersDB.remove(id);
        allMarkers = allMarkers.filter(m => m.id !== id);
        mapMgr.removeMarker(id);
        renderListPanel();
      } catch (err) { toast('删除失败: ' + err.message); }
    };
  });
  // 编辑点位
  document.querySelectorAll('[data-edit-mk]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const m = allMarkers.find(x => x.id === btn.dataset.editMk);
      if (m) showEditMarkerModal(m);
    };
  });
  // 删除线路
  document.querySelectorAll('[data-del-tk]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delTk;
      try {
        await tracksDB.remove(id);
        allTracks = allTracks.filter(t => t.id !== id);
        mapMgr.removeTrack(id);
        renderListPanel();
      } catch (err) { toast('删除失败: ' + err.message); }
    };
  });
  // 编辑线路
  document.querySelectorAll('[data-edit-tk]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const t = allTracks.find(x => x.id === btn.dataset.editTk);
      if (t) showEditTrackModal(t);
    };
  });
}

function showNewFolderModal(parentId) {
  const body = `<div class="form-group"><label>文件夹名称</label><input class="form-input" id="newFolderName" placeholder="如：爬山路线"></div>`;
  const footer = `<button class="btn btn-outline" id="nfCancel">取消</button><button class="btn btn-primary" id="nfSave">创建</button>`;
  const { close } = showModal('新建文件夹', body, footer);
  document.getElementById('nfCancel').onclick = close;
  document.getElementById('nfSave').onclick = async () => {
    const name = document.getElementById('newFolderName').value.trim();
    if (!name) { toast('请输入名称'); return; }
    try {
      const f = await folders.create(name, parentId);
      allFolders.push(f);
      expandedFolders.add(f.id);
      if (parentId) expandedFolders.add(parentId);
      else expandedFolders.add('__root');
      close();
      renderListPanel();
      toast('文件夹已创建');
    } catch (e) {
      toast('创建失败: ' + e.message);
    }
  };
  setTimeout(() => document.getElementById('newFolderName')?.focus(), 100);
}

// ---- 编辑点位 ----
async function showEditMarkerModal(marker) {
  const folderTree = buildFolderSelectOptions();
  const body = `
    <div class="form-group"><label>名称</label><input class="form-input" id="edMkName" value="${esc(marker.name)}"></div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="edMkRemark">${esc(marker.remark || '')}</textarea></div>
    <div class="form-group"><label>收藏夹</label><select class="form-select" id="edMkFolderSel">${folderTree.replace('id="mkFolderSel"', 'id="edMkFolderSel"')}</select></div>
    <div class="form-group"><label>坐标</label>
      <div style="font-family:monospace;font-size:13px;color:var(--text-muted)">
        ${marker.lng?.toFixed(6) || ''}, ${marker.lat?.toFixed(6) || ''} (WGS84)
      </div>
    </div>`;
  const footer = `<button class="btn btn-outline" id="edMkCancel">取消</button><button class="btn btn-primary" id="edMkSave">保存</button>`;
  const { close } = showModal('编辑点位', body, footer);
  document.getElementById('edMkCancel').onclick = close;
  const sel = document.getElementById('edMkFolderSel');
  sel.value = marker.folder_id || '__root';
  document.getElementById('edMkSave').onclick = async () => {
    const name = document.getElementById('edMkName').value.trim() || '未命名点位';
    const remark = document.getElementById('edMkRemark').value.trim();
    const folderVal = sel.value;
    let folderId = (folderVal && folderVal !== '__root') ? folderVal : null;
    try {
      const updated = await markersDB.update(marker.id, { name, remark, folder_id: folderId });
      const idx = allMarkers.findIndex(m => m.id === marker.id);
      if (idx >= 0) allMarkers[idx] = updated;
      mapMgr.updateMarker(updated);
      close();
      toast('点位已更新');
      renderListPanel();
    } catch (e) { toast('保存失败: ' + e.message); }
  };
}

// ---- 编辑线路 ----
async function showEditTrackModal(track) {
  const folderTree = buildFolderSelectOptions();
  const body = `
    <div class="form-group"><label>名称</label><input class="form-input" id="edTkName" value="${esc(track.name)}"></div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="edTkRemark">${esc(track.remark || '')}</textarea></div>
    <div class="form-group"><label>收藏夹</label><select class="form-select" id="edTkFolderSel">${folderTree.replace('id="mkFolderSel"', 'id="edTkFolderSel"')}</select></div>
    <div class="form-group"><label>点数</label><div style="color:var(--text-muted)">${(track.points||[]).length} 个点</div></div>`;
  const footer = `<button class="btn btn-outline" id="edTkCancel">取消</button><button class="btn btn-primary" id="edTkSave">保存</button>`;
  const { close } = showModal('编辑线路', body, footer);
  document.getElementById('edTkCancel').onclick = close;
  const sel = document.getElementById('edTkFolderSel');
  sel.value = track.folder_id || '__root';
  document.getElementById('edTkSave').onclick = async () => {
    const name = document.getElementById('edTkName').value.trim() || '未命名线路';
    const remark = document.getElementById('edTkRemark').value.trim();
    const folderVal = sel.value;
    let folderId = (folderVal && folderVal !== '__root') ? folderVal : null;
    try {
      const updated = await tracksDB.update(track.id, { name, remark, folder_id: folderId });
      const idx = allTracks.findIndex(t => t.id === track.id);
      if (idx >= 0) allTracks[idx] = updated;
      mapMgr.removeTrack(track.id);
      mapMgr.addTrack(updated);
      close();
      toast('线路已更新');
      renderListPanel();
    } catch (e) { toast('保存失败: ' + e.message); }
  };
}

// ---- 面板切换 ----
function togglePanel(type) {
  const panel = document.querySelector('.side-panel');
  if (currentPanel === type) {
    panel.classList.remove('open');
    currentPanel = null;
    return;
  }
  currentPanel = type;
  panel.classList.add('open');
  if (type === 'list') {
    panel.querySelector('.panel-header').innerHTML = `<h2>收藏夹</h2>`;
    renderListPanel();
  } else if (type === 'admin') {
    renderAdminPanel();
  }
}

// ---- 导入模态框 ----
function showImportModal() {
  const folderTree = buildFolderSelectOptions();
  const body = `
    <div class="form-group"><label>选择格式</label>
      <select class="form-select" id="impFormat">
        <option value="geojson">GeoJSON</option>
        <option value="gpx">GPX</option>
        <option value="kml">KML</option>
        <option value="shp">SHP (Shapefile)</option>
        <option value="csv">CSV</option>
      </select>
    </div>
    <div class="form-group"><label>导入到文件夹</label>${folderTree.replace('id="mkFolderSel"', 'id="impFolderSel"')}</div>
    <div class="form-group"><label>选择文件</label><input type="file" id="impFile" accept=".geojson,.json,.gpx,.kml,.csv,.shp,.zip"></div>
    <div class="form-group"><label>或粘贴内容</label><textarea class="form-textarea" id="impText" style="min-height:100px"></textarea></div>`;
  const footer = `<button class="btn btn-outline" id="impCancel">取消</button><button class="btn btn-primary" id="impGo">导入</button>`;
  const { close } = showModal('导入数据', body, footer);
  document.getElementById('impCancel').onclick = close;
  document.getElementById('impGo').onclick = async () => {
    const format = document.getElementById('impFormat').value;
    const file = document.getElementById('impFile').files[0];
    const text = document.getElementById('impText').value.trim();
    const folderVal = document.getElementById('impFolderSel').value;
    let folderId = (folderVal && folderVal !== '__root') ? folderVal : null;
    let content = text;
    let fileBuffer = null;
    if (file) {
      if (format === 'shp') {
        fileBuffer = await file.arrayBuffer();
      } else {
        content = await file.text();
      }
    }
    if (!content && !fileBuffer) { toast('请选择文件或粘贴内容'); return; }
    try {
      const result = await importData(content, format, fileBuffer, folderId);
      await loadAllData();
      refreshMap();
      close();
      toast(`导入成功: ${result.markers.length} 点位, ${result.tracks.length} 线路`);
      if (currentPanel === 'list') renderListPanel();
    } catch (e) {
      toast('导入失败: ' + e.message);
    }
  };
}

// ---- 导出模态框 ----
function showExportModal() {
  const body = `
    <div class="form-group"><label>选择格式</label>
      <select class="form-select" id="expFormat">
        <option value="geojson">GeoJSON</option>
        <option value="gpx">GPX</option>
        <option value="kml">KML</option>
        <option value="csv">CSV</option>
      </select>
    </div>
    <p style="color:var(--text-muted);font-size:13px">将导出你的全部点位和线路数据</p>`;
  const footer = `<button class="btn btn-outline" id="expCancel">取消</button><button class="btn btn-primary" id="expGo">导出</button>`;
  const { close } = showModal('导出数据', body, footer);
  document.getElementById('expCancel').onclick = close;
  document.getElementById('expGo').onclick = async () => {
    const format = document.getElementById('expFormat').value;
    try {
      const { content, ext } = await exportData(format, allMarkers, allTracks);
      downloadFile(content, `xiaobingmap_${Date.now()}.${ext}`);
      close();
      toast('导出成功');
    } catch (e) {
      toast('导出失败: ' + e.message);
    }
  };
}

// ---- 认证模态框 ----
function showAuthModal() {
  const body = `
    <div class="form-group"><label>用户名</label><input class="form-input" id="authUser" placeholder="用户名"></div>
    <div class="form-group"><label>密码</label><input class="form-input" id="authPass" type="password" placeholder="密码"></div>
    <p id="authError" style="color:var(--error);font-size:13px;display:none"></p>`;
  const footer = `<button class="btn btn-outline" id="authCancel">取消</button><button class="btn btn-primary" id="authLogin">登录</button><button class="btn btn-success" id="authRegister">注册</button>`;
  const { close } = showModal('账号', body, footer);
  document.getElementById('authCancel').onclick = close;
  const errEl = document.getElementById('authError');
  const onAuthSuccess = async () => {
    close();
    hideLoginGate();
    toast('登录成功');
    renderTopbar();
    await loadAndRenderAll();
  };
  document.getElementById('authLogin').onclick = async () => {
    const u = document.getElementById('authUser').value.trim();
    const p = document.getElementById('authPass').value;
    try {
      await login(u, p);
      await onAuthSuccess();
    } catch (e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  };
  document.getElementById('authRegister').onclick = async () => {
    const u = document.getElementById('authUser').value.trim();
    const p = document.getElementById('authPass').value;
    try {
      await register(u, p);
      await onAuthSuccess();
    } catch (e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  };
}

// ---- 登录拦截 ----
function showLoginGate() {
  let gate = document.getElementById('loginGate');
  if (gate) return;
  gate = document.createElement('div');
  gate.id = 'loginGate';
  gate.className = 'login-gate';
  gate.innerHTML = `
    <div class="login-gate-card">
      <div class="login-gate-logo">小兵地图</div>
      <p class="login-gate-hint">请登录后使用</p>
      <div class="form-group"><label>用户名</label><input class="form-input" id="gateUser" placeholder="用户名"></div>
      <div class="form-group"><label>密码</label><input class="form-input" id="gatePass" type="password" placeholder="密码"></div>
      <p id="gateError" style="color:var(--error);font-size:13px;display:none"></p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-block" id="gateLogin">登录</button>
        <button class="btn btn-success btn-block" id="gateRegister">注册</button>
      </div>
    </div>`;
  document.body.appendChild(gate);
  const errEl = document.getElementById('gateError');
  const onAuthSuccess = async () => {
    hideLoginGate();
    toast('登录成功');
    renderTopbar();
    await loadAndRenderAll();
  };
  document.getElementById('gateLogin').onclick = async () => {
    const u = document.getElementById('gateUser').value.trim();
    const p = document.getElementById('gatePass').value;
    try {
      await login(u, p);
      await onAuthSuccess();
    } catch (e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  };
  document.getElementById('gateRegister').onclick = async () => {
    const u = document.getElementById('gateUser').value.trim();
    const p = document.getElementById('gatePass').value;
    try {
      await register(u, p);
      await onAuthSuccess();
    } catch (e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    }
  };
  document.getElementById('gatePass').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('gateLogin').click();
  };
  setTimeout(() => document.getElementById('gateUser')?.focus(), 100);
}

function hideLoginGate() {
  const gate = document.getElementById('loginGate');
  if (gate) gate.remove();
}

function addAdminButton() {
  if (document.getElementById('btnAdmin')) return;
  const btn = document.createElement('button');
  btn.className = 'btn-icon';
  btn.id = 'btnAdmin';
  btn.title = '管理后台';
  btn.textContent = '★';
  btn.onclick = () => togglePanel('admin');
  document.querySelector('.topbar').insertBefore(btn, document.getElementById('btnAuth'));
}

async function doLogout() {
  await logout();
  toast('已退出');
  renderTopbar();
  mapMgr.clearMarkers();
  mapMgr.clearTracks();
  allFolders = [];
  allMarkers = [];
  allTracks = [];
  const adminBtn = document.getElementById('btnAdmin');
  if (adminBtn) adminBtn.remove();
  if (currentPanel) {
    document.querySelector('.side-panel').classList.remove('open');
    currentPanel = null;
  }
  showLoginGate();
}

// ---- 刷新地图 ----
function refreshMap() {
  mapMgr.clearMarkers();
  mapMgr.clearTracks();
  for (const m of allMarkers) mapMgr.addMarker(m);
  for (const t of allTracks) mapMgr.addTrack(t);
}

async function loadAndRenderAll() {
  await loadAllData();
  refreshMap();
  if (currentPanel === 'list') renderListPanel();
}

// ---- 管理员面板 ----
async function renderAdminPanel() {
  const panel = document.querySelector('.side-panel');
  panel.querySelector('.panel-header').innerHTML = `<h2>管理后台</h2>`;
  try {
    const [users, markersData, tracksData] = await Promise.all([
      profiles.list(),
      markersDB.list(),
      tracksDB.list(),
    ]);

    let html = '<div class="section-title">用户管理</div>';
    html += '<table class="admin-table"><thead><tr><th>用户名</th><th>角色</th><th>操作</th></tr></thead><tbody>';
    for (const u of users) {
      html += `<tr><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '管理员' : '普通用户'}</td>
        <td>
          ${u.role !== 'admin' ? `<button class="btn btn-outline btn-sm" data-promote-user="${u.id}">设为管理员</button>` : ''}
          ${u.id !== getUser().id ? `<button class="btn btn-danger btn-sm" data-del-user="${u.id}">删除</button>` : ''}
        </td></tr>`;
    }
    html += '</tbody></table>';

    html += `<div class="section-title">全部点位 (${markersData.length})</div>`;
    html += `<div style="display:flex;gap:4px;flex-wrap:wrap">`;
    html += `<button class="btn btn-outline btn-sm" id="adminExpMarkers">导出全部</button>`;
    html += `<button class="btn btn-danger btn-sm" id="adminDelAllMarkers">清空全部</button></div>`;
    html += `<div class="section-title">全部线路 (${tracksData.length})</div>`;
    html += `<div style="display:flex;gap:4px;flex-wrap:wrap">`;
    html += `<button class="btn btn-outline btn-sm" id="adminExpTracks">导出全部</button>`;
    html += `<button class="btn btn-danger btn-sm" id="adminDelAllTracks">清空全部</button></div>`;

    // 按用户列出数据概要
    html += '<div class="section-title">用户数据概览</div>';
    html += '<table class="admin-table"><thead><tr><th>用户名</th><th>点位数</th><th>线路数</th></tr></thead><tbody>';
    for (const u of users) {
      const mkCount = markersData.filter(m => m.user_id === u.id).length;
      const tkCount = tracksData.filter(t => t.user_id === u.id).length;
      html += `<tr><td>${esc(u.username)}</td><td>${mkCount}</td><td>${tkCount}</td></tr>`;
    }
    html += '</tbody></table>';

    panel.querySelector('.panel-body').innerHTML = html;

    // 用户操作
    panel.querySelectorAll('[data-del-user]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('确认删除该用户及其所有数据？')) return;
        try {
          await profiles.remove(btn.dataset.delUser);
          toast('已删除用户');
          renderAdminPanel();
        } catch (e) { toast('删除失败: ' + e.message); }
      };
    });
    panel.querySelectorAll('[data-promote-user]').forEach(btn => {
      btn.onclick = async () => {
        try {
          await profiles.setRole(btn.dataset.promoteUser, 'admin');
          toast('已设为管理员');
          renderAdminPanel();
        } catch (e) { toast('操作失败: ' + e.message); }
      };
    });

    // 导出全部
    document.getElementById('adminExpMarkers').onclick = () => {
      const gj = { type: 'FeatureCollection', features: markersData.map(m => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: { name: m.name, remark: m.remark }
      })) };
      downloadFile(JSON.stringify(gj, null, 2), `all_markers_${Date.now()}.geojson`);
    };
    document.getElementById('adminExpTracks').onclick = () => {
      const gj = { type: 'FeatureCollection', features: tracksData.map(t => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: t.points || [] },
        properties: { name: t.name, remark: t.remark }
      })) };
      downloadFile(JSON.stringify(gj, null, 2), `all_tracks_${Date.now()}.geojson`);
    };

    // 清空全部（管理员只能删除能看到的数据，即所有用户的）
    document.getElementById('adminDelAllMarkers').onclick = async () => {
      if (!confirm('确认删除全部用户的所有点位？此操作不可撤销！')) return;
      try {
        await markersDB.removeMany(markersData.map(m => m.id));
        toast('已清空全部点位');
        renderAdminPanel();
      } catch (e) { toast('操作失败: ' + e.message); }
    };
    document.getElementById('adminDelAllTracks').onclick = async () => {
      if (!confirm('确认删除全部用户的所有线路？此操作不可撤销！')) return;
      try {
        await tracksDB.removeMany(tracksData.map(t => t.id));
        toast('已清空全部线路');
        renderAdminPanel();
      } catch (e) { toast('操作失败: ' + e.message); }
    };
  } catch (e) {
    panel.querySelector('.panel-body').innerHTML = `<div class="empty-state">加载失败: ${esc(e.message)}</div>`;
  }
}

// ---- 调试控制台 ----
function toggleDebug() {
  const el = document.querySelector('.debug-console');
  el.classList.toggle('open');
  if (el.classList.contains('open')) renderDebugLogs();
}

function renderDebugLogs() {
  const body = document.querySelector('.debug-body');
  if (!body) return;
  const logs = getLogs();
  body.innerHTML = logs.map(l => `<div class="debug-line ${l.level}">[${l.time}] ${esc(l.msg)}</div>`).join('');
  body.scrollTop = body.scrollHeight;
}

// ---- 初始化 ----
async function init() {
  const root = document.getElementById('app');
  root.innerHTML = `
    <div class="topbar"></div>
    <div class="main-area">
      <div class="side-panel"><div class="panel-header"><h2></h2></div><div class="panel-body"></div></div>
      <div class="map-container">
        <div class="toolbar"></div>
        <div class="search-box">
          <input type="text" id="coordSearch" placeholder="搜索坐标或收藏名称..." title="输入坐标定位或搜索已保存的点位/线路名称">
          <button id="searchGo" title="定位">🔍</button>
        </div>
        <div id="map"></div>
        <button class="gps-btn" title="GPS定位">⊙</button>
        <div class="coord-display">--</div>
      </div>
    </div>
    <div class="debug-console">
      <div class="debug-header"><span>调试控制台</span><button id="dbgClear">清空</button><button id="dbgClose">×</button></div>
      <div class="debug-body"></div>
    </div>
  `;

  mapMgr = new MapManager(document.getElementById('map'));
  mapMgr.onMapClick = (latlng) => updateCoordDisplay(latlng);

  renderTopbar();
  renderToolbar();
  renderGPSBtn();
  renderSearchBox();

  document.getElementById('dbgClear').onclick = () => { clearLogs(); renderDebugLogs(); };
  document.getElementById('dbgClose').onclick = toggleDebug;
  window.addEventListener('debuglog', () => {
    if (document.querySelector('.debug-console.open')) renderDebugLogs();
  });

  await initAuth();
  renderTopbar();

  if (!isLoggedIn()) {
    showLoginGate();
  } else {
    setTimeout(async () => {
      mapMgr.invalidateSize();
      await loadAndRenderAll();
    }, 300);
  }
}

init();
