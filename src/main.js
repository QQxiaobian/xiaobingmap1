// 应用入口：组装地图、面板、工具栏、模态框、调试控制台
import './styles/main.css';
import L from 'leaflet';
import { MapManager } from './lib/mapManager.js';
import { localMarkers, localTracks, getSettings, saveSettings } from './lib/storage.js';
import { syncAll } from './lib/sync.js';
import { api, isOnline } from './lib/api.js';
import { initAuth, getUser, isAdmin, isLoggedIn, login, register, logout } from './lib/auth.js';
import { importData, exportData, downloadFile } from './lib/fileio.js';
import { getLogs, clearLogs } from './lib/debug.js';
import { CRS, gcj02ToWgs84 } from './lib/coord.js';

let mapMgr = null;
let currentPanel = null;
let toastTimer = null;

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

// ---- 顶栏 ----
function renderTopbar() {
  const user = getUser();
  const tb = document.querySelector('.topbar');
  tb.innerHTML = `
    <span class="logo">小兵地图</span>
    <span class="spacer"></span>
    <span class="sync-status" id="syncStatus">${isOnline() ? '在线' : '离线'}</span>
    <button class="btn-icon" id="btnSync" title="同步">⟳</button>
    <button class="btn-icon" id="btnPanel" title="列表">☰</button>
    <button class="btn-icon" id="btnDebug" title="调试控制台">bug</button>
    ${user ? `<span class="user-badge ${isAdmin() ? 'admin' : ''}">${user.username}${isAdmin() ? ' ★' : ''}</span>` : ''}
    <button class="btn-icon" id="btnAuth" title="账号">${user ? '⎋' : '⨀'}</button>
  `;
  document.getElementById('btnSync').onclick = doSync;
  document.getElementById('btnPanel').onclick = () => togglePanel('list');
  document.getElementById('btnDebug').onclick = toggleDebug;
  document.getElementById('btnAuth').onclick = () => user ? doLogout() : showAuthModal();
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
  // 度分秒格式: 25°08'52.4"N 103°02'39.1"E
  const dmsMatch = input.match(/(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([NSns])?[\s,]+(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([EWewE]?)/);
  if (dmsMatch) {
    const lat = parseInt(dmsMatch[1]) + parseInt(dmsMatch[2]) / 60 + parseFloat(dmsMatch[3]) / 3600;
    const lng = parseInt(dmsMatch[5]) + parseInt(dmsMatch[6]) / 60 + parseFloat(dmsMatch[7]) / 3600;
    const latVal = (dmsMatch[4] || '').toUpperCase() === 'S' ? -lat : lat;
    const lngVal = (dmsMatch[8] || '').toUpperCase() === 'W' ? -lng : lng;
    return { lat: latVal, lng: lngVal };
  }
  // 十进制: lng,lat 或 lat,lng
  const parts = input.split(/[\s,]+/).filter(s => s).map(parseFloat);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    // 中国经度 70-140, 纬度 0-55 — 判断哪个是经度
    let [a, b] = parts;
    if (a >= 60 && a <= 150) {
      // a 是经度
      return { lat: b, lng: a };
    } else if (b >= 60 && b <= 150) {
      // b 是经度
      return { lat: a, lng: b };
    }
    // 默认: 第一个是经度
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

    // 先尝试坐标解析
    const coord = parseCoordInput(val);
    if (coord) {
      mapMgr.flyToCoord(coord.lat, coord.lng);
      toast(`已定位到坐标: ${coord.lng.toFixed(6)}, ${coord.lat.toFixed(6)}`);
      return;
    }

    // 搜索收藏的点位和线路
    const markers = await localMarkers.list();
    const tracks = await localTracks.list();
    const q = val.toLowerCase();
    const matchMarkers = markers.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.remark || '').toLowerCase().includes(q) ||
      (m.group || '').toLowerCase().includes(q)
    );
    const matchTracks = tracks.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.remark || '').toLowerCase().includes(q) ||
      (t.group || '').toLowerCase().includes(q)
    );

    if (matchMarkers.length === 0 && matchTracks.length === 0) {
      toast('未找到匹配的点位或线路');
      return;
    }

    // 单个结果直接定位
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

    // 多个结果弹出选择列表
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
      <div class="item-info"><div class="item-name">${esc(m.name)}</div><div class="item-sub">${esc(m.group || '')} · ${m.lng?.toFixed(4)},${m.lat?.toFixed(4)}</div></div>
    </div>`;
  }
  for (const t of tracks) {
    body += `<div class="list-item" data-srch-tk="${t.id}">
      <span class="item-icon">〰</span>
      <div class="item-info"><div class="item-name">${esc(t.name)}</div><div class="item-sub">${esc(t.group || '')} · ${(t.points||[]).length} 个点</div></div>
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
  el.textContent = `经度: ${latlng.lng.toFixed(6)}  纬度: ${latlng.lat.toFixed(6)}  [${mapMgr.currentCRS}]`;
}

// ---- 打点 ----
function addMarkerMode() {
  toast('点击地图添加点位');
  mapMgr.onMapClick = async (latlng) => {
    mapMgr.onMapClick = null;
    showMarkerModal({ lat: latlng.lat, lng: latlng.lng });
  };
}

async function showMarkerModal(partial) {
  const settings = await getSettings();
  const groups = await getGroups();
  const groupOpts = groups.map(g => `<option value="${g}">${g}</option>`).join('') + '<option value="">+ 新分组</option>';
  const body = `
    <div class="form-group"><label>名称</label><input class="form-input" id="mkName" placeholder="点位名称"></div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="mkRemark" placeholder="备注信息"></textarea></div>
    <div class="form-group"><label>分组</label><select class="form-select" id="mkGroupSel">${groupOpts}</select></div>
    <div class="form-group" id="mkNewGroupWrap" style="display:none"><label>新分组名</label><input class="form-input" id="mkNewGroup"></div>
    <div class="form-group"><label>坐标 (${mapMgr.currentCRS})</label>
      <div style="font-family:monospace;font-size:13px;color:var(--text-muted)">
        ${partial.lng?.toFixed(6) || ''}, ${partial.lat?.toFixed(6) || ''}
      </div>
    </div>`;
  const footer = `<button class="btn btn-outline" id="mkCancel">取消</button><button class="btn btn-primary" id="mkSave">保存</button>`;
  const { overlay, close } = showModal('添加点位', body, footer);
  document.getElementById('mkCancel').onclick = close;
  document.getElementById('mkGroupSel').onchange = (e) => {
    document.getElementById('mkNewGroupWrap').style.display = e.target.value === '' ? 'block' : 'none';
  };
  document.getElementById('mkSave').onclick = async () => {
    const name = document.getElementById('mkName').value.trim() || '未命名点位';
    const remark = document.getElementById('mkRemark').value.trim();
    const groupSel = document.getElementById('mkGroupSel').value;
    const newGroup = document.getElementById('mkNewGroup').value.trim();
    const group = groupSel || newGroup || '默认';
    // 存储用 WGS84
    let storeLat = partial.lat, storeLng = partial.lng;
    if (mapMgr.currentCRS === CRS.GCJ02) {
      const [wlng, wlat] = gcj02ToWgs84(partial.lng, partial.lat);
      [storeLng, storeLat] = [wlng, wlat];
    }
    const marker = {
      id: 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name, remark, group, lat: storeLat, lng: storeLng,
      userId: getUser()?.id || null,
      updateAt: Date.now(), _dirty: true,
    };
    await localMarkers.set(marker);
    mapMgr.addMarker(marker);
    close();
    toast('点位已添加');
    if (currentPanel === 'list') renderListPanel();
    autoSync();
  };
}

// ---- 绘制线路 ----
function drawTrackMode() {
  toast('点击地图绘制线路，双击结束');
  mapMgr.enableDrawTrack(async (pts) => {
    const groups = await getGroups();
    const groupOpts = groups.map(g => `<option value="${g}">${g}</option>`).join('') + '<option value="">+ 新分组</option>';
    const body = `
      <div class="form-group"><label>名称</label><input class="form-input" id="tkName" placeholder="线路名称"></div>
      <div class="form-group"><label>备注</label><textarea class="form-textarea" id="tkRemark"></textarea></div>
      <div class="form-group"><label>分组</label><select class="form-select" id="tkGroupSel">${groupOpts}</select></div>
      <div class="form-group" id="tkNewGroupWrap" style="display:none"><label>新分组名</label><input class="form-input" id="tkNewGroup"></div>
      <div class="form-group"><label>点数</label><div style="color:var(--text-muted)">${pts.length} 个点</div></div>`;
    const footer = `<button class="btn btn-outline" id="tkCancel">取消</button><button class="btn btn-primary" id="tkSave">保存</button>`;
    const { close } = showModal('保存线路', body, footer);
    document.getElementById('tkCancel').onclick = close;
    document.getElementById('tkGroupSel').onchange = (e) => {
      document.getElementById('tkNewGroupWrap').style.display = e.target.value === '' ? 'block' : 'none';
    };
    document.getElementById('tkSave').onclick = async () => {
      const name = document.getElementById('tkName').value.trim() || '未命名线路';
      const remark = document.getElementById('tkRemark').value.trim();
      const groupSel = document.getElementById('tkGroupSel').value;
      const newGroup = document.getElementById('tkNewGroup').value.trim();
      const group = groupSel || newGroup || '默认';
      const track = {
        id: 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name, remark, group, points: pts,
        userId: getUser()?.id || null,
        updateAt: Date.now(), _dirty: true,
      };
      await localTracks.set(track);
      mapMgr.addTrack(track);
      close();
      toast('线路已保存');
      if (currentPanel === 'list') renderListPanel();
      autoSync();
    };
  });
}

// ---- 测距 ----
function measureDistanceMode() {
  toast('点击地图测距，双击结束');
  mapMgr.enableMeasureDistance((dist) => {
    toast(`距离: ${(dist / 1000).toFixed(2)} km`);
  });
}

// ---- 测面积 ----
function measureAreaMode() {
  toast('点击地图测面积，双击结束');
  mapMgr.enableMeasureArea((area) => {
    toast(`面积: ${(area / 1000000).toFixed(4)} km²`);
  });
}

// ---- 分组列表 ----
async function getGroups() {
  const markers = await localMarkers.list();
  const tracks = await localTracks.list();
  const set = new Set(['默认']);
  markers.forEach(m => set.add(m.group || '默认'));
  tracks.forEach(t => set.add(t.group || '默认'));
  return [...set];
}

// ---- 列表面板 ----
async function renderListPanel() {
  const panel = document.querySelector('.side-panel');
  const markers = await localMarkers.list();
  const tracks = await localTracks.list();
  const grouped = {};
  for (const m of markers) {
    const g = m.group || '默认';
    if (!grouped[g]) grouped[g] = { markers: [], tracks: [] };
    grouped[g].markers.push(m);
  }
  for (const t of tracks) {
    const g = t.group || '默认';
    if (!grouped[g]) grouped[g] = { markers: [], tracks: [] };
    grouped[g].tracks.push(t);
  }
  let html = '';
  if (markers.length === 0 && tracks.length === 0) {
    html = '<div class="empty-state"><div class="icon">📍</div>暂无点位和线路<br>点击工具栏添加</div>';
  } else {
    for (const [group, items] of Object.entries(grouped).sort()) {
      html += `<div class="section-title">${esc(group)}</div>`;
      for (const m of items.markers) {
        html += `<div class="list-item" data-mid="${m.id}">
          <span class="item-icon">📍</span>
          <div class="item-info"><div class="item-name">${esc(m.name)}</div><div class="item-sub">${esc(m.remark || '')}</div></div>
          <div class="item-actions">
            <button data-edit-mk="${m.id}" title="编辑">✎</button>
            <button data-del-mk="${m.id}" title="删除">✕</button>
          </div>
        </div>`;
      }
      for (const t of items.tracks) {
        html += `<div class="list-item" data-tid="${t.id}">
          <span class="item-icon">〰</span>
          <div class="item-info"><div class="item-name">${esc(t.name)}</div><div class="item-sub">${(t.points||[]).length} 个点</div></div>
          <div class="item-actions">
            <button data-edit-tk="${t.id}" title="编辑">✎</button>
            <button data-del-tk="${t.id}" title="删除">✕</button>
          </div>
        </div>`;
      }
    }
  }
  panel.querySelector('.panel-body').innerHTML = html;
  // 绑定点击
  panel.querySelectorAll('[data-mid]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.dataset.delMk) return;
      const m = markers.find(x => x.id === el.dataset.mid);
      if (m) mapMgr.flyToMarker(m);
    };
  });
  panel.querySelectorAll('[data-tid]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.dataset.delTk) return;
      const t = tracks.find(x => x.id === el.dataset.tid);
      if (t) mapMgr.flyToTrack(t);
    };
  });
  panel.querySelectorAll('[data-del-mk]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delMk;
      await localMarkers.remove(id);
      mapMgr.removeMarker(id);
      renderListPanel();
      autoSync();
    };
  });
  panel.querySelectorAll('[data-edit-mk]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const m = markers.find(x => x.id === btn.dataset.editMk);
      if (m) showEditMarkerModal(m);
    };
  });
  panel.querySelectorAll('[data-del-tk]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delTk;
      await localTracks.remove(id);
      mapMgr.removeTrack(id);
      renderListPanel();
      autoSync();
    };
  });
  panel.querySelectorAll('[data-edit-tk]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const t = tracks.find(x => x.id === btn.dataset.editTk);
      if (t) showEditTrackModal(t);
    };
  });
}

// ---- 编辑点位 ----
async function showEditMarkerModal(marker) {
  const groups = await getGroups();
  const groupOpts = groups.map(g => `<option value="${g}" ${g === (marker.group || '默认') ? 'selected' : ''}>${g}</option>`).join('') + '<option value="">+ 新分组</option>';
  const body = `
    <div class="form-group"><label>名称</label><input class="form-input" id="edMkName" value="${esc(marker.name)}"></div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="edMkRemark">${esc(marker.remark || '')}</textarea></div>
    <div class="form-group"><label>分组</label><select class="form-select" id="edMkGroupSel">${groupOpts}</select></div>
    <div class="form-group" id="edMkNewGroupWrap" style="display:none"><label>新分组名</label><input class="form-input" id="edMkNewGroup"></div>
    <div class="form-group"><label>坐标 (WGS84)</label>
      <div style="font-family:monospace;font-size:13px;color:var(--text-muted)">
        ${marker.lng?.toFixed(6) || ''}, ${marker.lat?.toFixed(6) || ''}
      </div>
    </div>`;
  const footer = `<button class="btn btn-outline" id="edMkCancel">取消</button><button class="btn btn-primary" id="edMkSave">保存</button>`;
  const { close } = showModal('编辑点位', body, footer);
  document.getElementById('edMkCancel').onclick = close;
  document.getElementById('edMkGroupSel').onchange = (e) => {
    document.getElementById('edMkNewGroupWrap').style.display = e.target.value === '' ? 'block' : 'none';
  };
  document.getElementById('edMkSave').onclick = async () => {
    const name = document.getElementById('edMkName').value.trim() || '未命名点位';
    const remark = document.getElementById('edMkRemark').value.trim();
    const groupSel = document.getElementById('edMkGroupSel').value;
    const newGroup = document.getElementById('edMkNewGroup').value.trim();
    const group = groupSel || newGroup || '默认';
    const updated = { ...marker, name, remark, group, updateAt: Date.now(), _dirty: true };
    await localMarkers.set(updated);
    mapMgr.updateMarker(updated);
    close();
    toast('点位已更新');
    renderListPanel();
    autoSync();
  };
}

// ---- 编辑线路 ----
async function showEditTrackModal(track) {
  const groups = await getGroups();
  const groupOpts = groups.map(g => `<option value="${g}" ${g === (track.group || '默认') ? 'selected' : ''}>${g}</option>`).join('') + '<option value="">+ 新分组</option>';
  const body = `
    <div class="form-group"><label>名称</label><input class="form-input" id="edTkName" value="${esc(track.name)}"></div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="edTkRemark">${esc(track.remark || '')}</textarea></div>
    <div class="form-group"><label>分组</label><select class="form-select" id="edTkGroupSel">${groupOpts}</select></div>
    <div class="form-group" id="edTkNewGroupWrap" style="display:none"><label>新分组名</label><input class="form-input" id="edTkNewGroup"></div>
    <div class="form-group"><label>点数</label><div style="color:var(--text-muted)">${(track.points||[]).length} 个点</div></div>`;
  const footer = `<button class="btn btn-outline" id="edTkCancel">取消</button><button class="btn btn-primary" id="edTkSave">保存</button>`;
  const { close } = showModal('编辑线路', body, footer);
  document.getElementById('edTkCancel').onclick = close;
  document.getElementById('edTkGroupSel').onchange = (e) => {
    document.getElementById('edTkNewGroupWrap').style.display = e.target.value === '' ? 'block' : 'none';
  };
  document.getElementById('edTkSave').onclick = async () => {
    const name = document.getElementById('edTkName').value.trim() || '未命名线路';
    const remark = document.getElementById('edTkRemark').value.trim();
    const groupSel = document.getElementById('edTkGroupSel').value;
    const newGroup = document.getElementById('edTkNewGroup').value.trim();
    const group = groupSel || newGroup || '默认';
    const updated = { ...track, name, remark, group, updateAt: Date.now(), _dirty: true };
    await localTracks.set(updated);
    mapMgr.removeTrack(track.id);
    mapMgr.addTrack(updated);
    close();
    toast('线路已更新');
    renderListPanel();
    autoSync();
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
    panel.querySelector('.panel-header').innerHTML = `<h2>点位与线路</h2>`;
    renderListPanel();
  } else if (type === 'admin') {
    renderAdminPanel();
  }
}

// ---- 导入模态框 ----
function showImportModal() {
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
    <div class="form-group"><label>选择文件</label><input type="file" id="impFile" accept=".geojson,.json,.gpx,.kml,.csv,.shp,.zip"></div>
    <div class="form-group"><label><input type="checkbox" id="impUseFileName" checked> 用文件名作为分组</label></div>
    <div class="form-group"><label>或粘贴内容</label><textarea class="form-textarea" id="impText" style="min-height:100px"></textarea></div>`;
  const footer = `<button class="btn btn-outline" id="impCancel">取消</button><button class="btn btn-primary" id="impGo">导入</button>`;
  const { close } = showModal('导入数据', body, footer);
  document.getElementById('impCancel').onclick = close;
  document.getElementById('impGo').onclick = async () => {
    const format = document.getElementById('impFormat').value;
    const file = document.getElementById('impFile').files[0];
    const text = document.getElementById('impText').value.trim();
    const useFileName = document.getElementById('impUseFileName').checked;
    let content = text;
    let fileBuffer = null;
    let groupName = null;
    if (file) {
      if (format === 'shp') {
        fileBuffer = await file.arrayBuffer();
      } else {
        content = await file.text();
      }
      if (useFileName) {
        groupName = file.name.replace(/\.[^.]+$/, '');
      }
    } else if (useFileName && text) {
      // 粘贴内容时无文件名，用格式名作为分组
      groupName = null;
    }
    if (!content && !fileBuffer) { toast('请选择文件或粘贴内容'); return; }
    try {
      const result = await importData(content, format, fileBuffer, groupName);
      // 刷新地图
      for (const m of result.markers) mapMgr.addMarker(m);
      for (const t of result.tracks) mapMgr.addTrack(t);
      close();
      toast(`导入成功: ${result.markers.length} 点位, ${result.tracks.length} 线路`);
      if (currentPanel === 'list') renderListPanel();
      autoSync();
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
    <p style="color:var(--text-muted);font-size:13px">将导出全部本地点位和线路数据</p>`;
  const footer = `<button class="btn btn-outline" id="expCancel">取消</button><button class="btn btn-primary" id="expGo">导出</button>`;
  const { close } = showModal('导出数据', body, footer);
  document.getElementById('expCancel').onclick = close;
  document.getElementById('expGo').onclick = async () => {
    const format = document.getElementById('expFormat').value;
    try {
      const { content, ext } = await exportData(format);
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
    await doSync();
    await loadAndRenderAll();
    if (isAdmin()) addAdminButton();
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
    await doSync();
    await loadAndRenderAll();
    if (isAdmin()) addAdminButton();
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
  const adminBtn = document.getElementById('btnAdmin');
  if (adminBtn) adminBtn.remove();
  if (currentPanel) {
    document.querySelector('.side-panel').classList.remove('open');
    currentPanel = null;
  }
  showLoginGate();
}

// ---- 同步 ----
let syncTimer = null;
async function doSync() {
  const statusEl = document.getElementById('syncStatus');
  if (statusEl) statusEl.textContent = '同步中...';
  const result = await syncAll();
  if (result.synced) {
    if (statusEl) statusEl.textContent = '已同步';
    toast('同步成功');
    await loadAndRenderAll();
  } else {
    if (statusEl) statusEl.textContent = isOnline() ? '同步失败' : '离线';
    if (isOnline()) toast('同步失败: ' + result.reason);
  }
}

function autoSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (isOnline()) doSync(); }, 3000);
}

// ---- 加载并渲染所有数据 ----
async function loadAndRenderAll() {
  mapMgr.clearMarkers();
  mapMgr.clearTracks();
  const markers = await localMarkers.list();
  const tracks = await localTracks.list();
  for (const m of markers) mapMgr.addMarker(m);
  for (const t of tracks) mapMgr.addTrack(t);
  if (currentPanel === 'list') renderListPanel();
}

// ---- 管理员面板 ----
async function renderAdminPanel() {
  const panel = document.querySelector('.side-panel');
  panel.querySelector('.panel-header').innerHTML = `<h2>管理后台</h2>`;
  try {
    const [users, markers, tracks] = await Promise.all([
      api.adminListUsers(), api.adminListAllMarkers(), api.adminListAllTracks()
    ]);
    let html = '<div class="section-title">用户管理</div>';
    html += '<table class="admin-table"><thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>操作</th></tr></thead><tbody>';
    for (const u of users) {
      html += `<tr><td>${u.id}</td><td>${esc(u.username)}</td><td>${u.role}</td>
        <td>${u.role !== 'admin' ? `<button class="btn btn-danger btn-sm" data-del-user="${u.id}">删除</button>` : '-'}</td></tr>`;
    }
    html += '</tbody></table>';
    html += `<div class="section-title">全部点位 (${markers.length})</div>`;
    html += `<button class="btn btn-outline btn-sm" id="adminExpMarkers">导出全部点位</button> `;
    html += `<button class="btn btn-danger btn-sm" id="adminDelAllMarkers">删除全部点位</button>`;
    html += `<div class="section-title">全部线路 (${tracks.length})</div>`;
    html += `<button class="btn btn-outline btn-sm" id="adminExpTracks">导出全部线路</button> `;
    html += `<button class="btn btn-danger btn-sm" id="adminDelAllTracks">删除全部线路</button>`;
    panel.querySelector('.panel-body').innerHTML = html;
    panel.querySelectorAll('[data-del-user]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('确认删除该用户？')) return;
        try {
          await api.adminDeleteUser(btn.dataset.delUser);
          toast('已删除');
          renderAdminPanel();
        } catch (e) { toast('删除失败: ' + e.message); }
      };
    });
    document.getElementById('adminExpMarkers').onclick = () => {
      const gj = { type: 'FeatureCollection', features: markers.map(m => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: { name: m.name, remark: m.remark, group: m.group, user: m.username }
      })) };
      downloadFile(JSON.stringify(gj, null, 2), `all_markers_${Date.now()}.geojson`);
    };
    document.getElementById('adminExpTracks').onclick = () => {
      const gj = { type: 'FeatureCollection', features: tracks.map(t => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: t.points || [] },
        properties: { name: t.name, remark: t.remark, group: t.group, user: t.username }
      })) };
      downloadFile(JSON.stringify(gj, null, 2), `all_tracks_${Date.now()}.geojson`);
    };
    document.getElementById('adminDelAllMarkers').onclick = async () => {
      if (!confirm('确认删除全部点位？')) return;
      await api.adminDeleteMarkers(markers.map(m => m.id));
      toast('已删除全部点位');
      renderAdminPanel();
    };
    document.getElementById('adminDelAllTracks').onclick = async () => {
      if (!confirm('确认删除全部线路？')) return;
      await api.adminDeleteTracks(tracks.map(t => t.id));
      toast('已删除全部线路');
      renderAdminPanel();
    };
  } catch (e) {
    panel.querySelector('.panel-body').innerHTML = `<div class="empty-state">加载失败: ${e.message}</div>`;
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

// ---- HTML 转义 ----
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
          <input type="text" id="coordSearch" placeholder="搜索坐标或收藏名称..." title="输入坐标定位(如 103.044,25.147)或搜索已保存的点位/线路名称">
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

  // 调试控制台事件
  document.getElementById('dbgClear').onclick = () => { clearLogs(); renderDebugLogs(); };
  document.getElementById('dbgClose').onclick = toggleDebug;
  window.addEventListener('debuglog', () => {
    if (document.querySelector('.debug-console.open')) renderDebugLogs();
  });

  // 在线/离线事件
  window.addEventListener('online', () => {
    document.getElementById('syncStatus').textContent = '在线';
    toast('已联网，开始同步');
    doSync();
  });
  window.addEventListener('offline', () => {
    document.getElementById('syncStatus').textContent = '离线';
    toast('已断网，可离线编辑');
  });

  // 鉴权初始化
  await initAuth();
  renderTopbar();

  if (!isLoggedIn()) {
    // 未登录：显示登录拦截，不加载任何数据
    showLoginGate();
  } else {
    // 已登录：正常进入
    setTimeout(async () => {
      mapMgr.invalidateSize();
      await doSync();
      await loadAndRenderAll();
    }, 300);
    if (isAdmin()) addAdminButton();
  }
}

init();
