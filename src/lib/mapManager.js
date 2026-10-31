// 地图管理器：Leaflet 实例、图源切换、GPS定位、打点、绘制、测量
// 关键：所有坐标在内部以 WGS84 存储/渲染，GCJ02 图源显示时做偏移补偿
import L from 'leaflet';
import 'leaflet-draw';
import { wgs84ToGcj02, gcj02ToWgs84, CRS } from './coord.js';
import { getSettings } from './storage.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 修复 Leaflet 默认图标路径
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

// 图源定义
// crs 字段标识该图源使用哪种坐标系：WGS84 图源直接用，GCJ02 图源需要偏移补偿
const tileSources = {
  // --- WGS84 图源（国际标准，无偏移）---
  esri: {
    name: 'Esri 卫星图',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Imagery',
    maxZoom: 19,
    crs: CRS.WGS84,
  },
  esrihybrid: {
    name: 'Esri卫星+地名',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri Imagery + Boundaries',
    maxZoom: 19,
    crs: CRS.WGS84,
    isHybrid: true,
  },
  osm: {
    name: 'OSM 街道图',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: 'OpenStreetMap',
    maxZoom: 19,
    crs: CRS.WGS84,
  },
  esritopo: {
    name: 'Esri 地形图',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri Topo',
    maxZoom: 17,
    crs: CRS.WGS84,
  },
  esriterrain: {
    name: 'Esri 地形渲染',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri Terrain',
    maxZoom: 13,
    crs: CRS.WGS84,
  },
  // --- GCJ02 图源（中国偏移坐标系，需补偿）---
  ghyx: {
    name: '高德卫星图',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    attribution: '高德地图 AutoNavi',
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    crs: CRS.GCJ02,
  },
  ghybrid: {
    name: '高德卫星+地名',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    labelUrl: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
    attribution: '高德地图 AutoNavi (卫星+标注)',
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    crs: CRS.GCJ02,
    isHybrid: true,
  },
  gdmap: {
    name: '高德街道图',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    attribution: '高德地图 AutoNavi',
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    crs: CRS.GCJ02,
  },
  txsat: {
    name: '腾讯卫星图',
    url: 'https://p{s}.map.gtimg.com/sateTiles/{z}/{x}/{y}/{x}_{y}.jpg',
    attribution: '腾讯地图 Tencent',
    maxZoom: 18,
    subdomains: ['0', '1', '2', '3'],
    crs: CRS.GCJ02,
    isTencent: true,
  },
  txmap: {
    name: '腾讯街道图',
    url: 'https://p{s}.map.gtimg.com/realtimerender/{z}/{x}/{y}/{x}_{y}.png',
    attribution: '腾讯地图 Tencent',
    maxZoom: 18,
    subdomains: ['0', '1', '2', '3'],
    crs: CRS.GCJ02,
    isTencent: true,
  },
};

// 当前激活图层的 CRS
let activeLayerCRS = CRS.WGS84;

export class MapManager {
  constructor(container) {
    this.container = container;
    this.markers = new Map();
    this.tracks = new Map();
    this.onMarkerClick = null;
    this.onTrackClick = null;
    this.onMapClick = null;
    this._drawnItems = null;
    this._drawHandler = null;
    this._gpsMarker = null;
    this._gpsCircle = null;
    this.currentCRS = CRS.WGS84; // 显示坐标格式
    this._init();
  }

  async _init() {
    const settings = await getSettings();
    this.currentCRS = settings.coordDisplay || CRS.WGS84;
    const defaultLayer = settings.defaultLayer || 'esri';

    const baseLayers = {};
    for (const [key, src] of Object.entries(tileSources)) {
      const opts = {
        attribution: src.attribution,
        maxZoom: src.maxZoom,
      };
      if (src.subdomains) opts.subdomains = src.subdomains;

      let layer;
      if (src.isTencent) {
        // 腾讯地图：Y 轴翻转 + 瓦片分块
        const TxBayer = L.TileLayer.extend({
          getTileUrl(coords) {
            const z = coords.z;
            const x = coords.x;
            const y = (1 << z) - 1 - coords.y;
            const group = Math.floor(y / 16);
            const xGroup = Math.floor(x / 16);
            const subs = src.subdomains;
            const s = subs[Math.abs(x + y) % subs.length];
            const ext = src.url.endsWith('.jpg') ? '.jpg' : '.png';
            const path = src.url.includes('sateTiles') ? 'sateTiles' : 'realtimerender';
            return `https://p${s}.map.gtimg.com/${path}/${z}/${xGroup}/${x}/${group}/${y}/${x}_${y}${ext}`;
          },
        });
        layer = new TxBayer('', opts);
      } else if (src.isHybrid) {
        const satLayer = L.tileLayer(src.url, opts);
        const labelOpts = { ...opts, maxZoom: src.maxZoom };
        if (src.subdomains) labelOpts.subdomains = src.subdomains;
        const labelLayer = L.tileLayer(src.labelUrl, { ...labelOpts, className: 'hybrid-labels' });
        layer = L.layerGroup([satLayer, labelLayer]);
      } else {
        layer = L.tileLayer(src.url, opts);
      }

      baseLayers[src.name] = layer;

      // 记录当前图层的 CRS
      if (key === defaultLayer) {
        activeLayerCRS = src.crs;
        layer.on('add', () => { activeLayerCRS = src.crs; });
      } else {
        layer.on('add', () => { activeLayerCRS = src.crs; this._reprojectOverlays(); });
      }
    }

    this.map = L.map(this.container, {
      zoomControl: false,
      attributionControl: true,
      drawControl: false,
    }).setView([35.0, 105.0], 4);

    baseLayers[tileSources[defaultLayer].name].addTo(this.map);
    L.control.layers(baseLayers).addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ imperial: false }).addTo(this.map);

    this._drawnItems = new L.FeatureGroup();
    this.map.addLayer(this._drawnItems);

    this.map.on('click', (e) => {
      if (this.onMapClick) this.onMapClick(this._toDisplay(e.latlng));
    });
  }

  // 当前图层是否为 GCJ02
  _isGCJ02Layer() {
    return activeLayerCRS === CRS.GCJ02;
  }

  // 将 WGS84 经纬度转换为当前图层坐标系（用于在 GCJ02 图层上正确显示）
  _toLayer(latlng) {
    if (this._isGCJ02Layer()) {
      const [lng, lat] = wgs84ToGcj02(latlng.lng, latlng.lat);
      return L.latLng(lat, lng);
    }
    return latlng;
  }

  // 将图层上的点击坐标转回 WGS84（用于存储）
  _fromLayer(latlng) {
    if (this._isGCJ02Layer()) {
      const [lng, lat] = gcj02ToWgs84(latlng.lng, latlng.lat);
      return L.latLng(lat, lng);
    }
    return latlng;
  }

  // 坐标显示转换
  _toDisplay(latlng) {
    if (this.currentCRS === CRS.GCJ02) {
      const [lng, lat] = wgs84ToGcj02(latlng.lng, latlng.lat);
      return L.latLng(lat, lng);
    }
    return latlng;
  }

  _fromDisplay(latlng) {
    if (this.currentCRS === CRS.GCJ02) {
      const [lng, lat] = gcj02ToWgs84(latlng.lng, latlng.lat);
      return L.latLng(lat, lng);
    }
    return latlng;
  }

  setCoordDisplay(crs) {
    this.currentCRS = crs;
  }

  // 切换图层后重新投影所有叠加物（点位/线路）
  _reprojectOverlays() {
    const markerData = [...this.markers.entries()].map(([id, m]) => ({
      id,
      data: m._xbData,
    }));
    const trackData = [...this.tracks.entries()].map(([id, t]) => ({
      id,
      data: t._xbData,
    }));
    this.clearMarkers();
    this.clearTracks();
    for (const { id, data } of markerData) {
      if (data) this.addMarker(data);
    }
    for (const { id, data } of trackData) {
      if (data) this.addTrack(data);
    }
  }

  // ---- GPS 定位 ----
  locateGPS() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('浏览器不支持定位功能'));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const wgs84 = L.latLng(pos.coords.latitude, pos.coords.longitude);
          this._showGPS(wgs84, pos.coords.accuracy);
          resolve({ latlng: wgs84, accuracy: pos.coords.accuracy });
        },
        (err) => {
          let msg = '定位失败';
          if (err.code === 1) msg = '定位权限被拒绝，请在浏览器设置中允许位置访问';
          else if (err.code === 2) msg = '无法获取位置，请检查网络或GPS信号';
          else if (err.code === 3) msg = '定位超时，请重试';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  _showGPS(wgs84, accuracy) {
    const pos = this._toLayer(wgs84);
    if (this._gpsMarker) this.map.removeLayer(this._gpsMarker);
    if (this._gpsCircle) this.map.removeLayer(this._gpsCircle);
    this._gpsMarker = L.circleMarker(pos, { radius: 8, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.8 }).addTo(this.map);
    if (accuracy) {
      this._gpsCircle = L.circle(pos, { radius: accuracy, color: '#3b82f6', fillOpacity: 0.1 }).addTo(this.map);
    }
    this.map.setView(pos, 16);
  }

  // ---- 点位 ----
  addMarker(marker) {
    const wgs84 = L.latLng(marker.lat, marker.lng);
    const pos = this._toLayer(wgs84);
    const name = marker.name || '点位';
    const icon = L.divIcon({
      className: 'xb-marker',
      html: `<div class="xb-marker-pin"></div><div class="xb-marker-label">${esc(name)}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });
    const m = L.marker(pos, { icon }).addTo(this.map);
    m.bindPopup(`<b>${esc(marker.name)}</b><br/>${esc(marker.remark || '')}`);
    m.on('click', () => this.onMarkerClick?.(marker.id));
    m._xbData = marker;
    this.markers.set(marker.id, m);
    return m;
  }

  removeMarker(id) {
    const m = this.markers.get(id);
    if (m) { this.map.removeLayer(m); this.markers.delete(id); }
  }

  updateMarker(marker) {
    this.removeMarker(marker.id);
    this.addMarker(marker);
  }

  clearMarkers() {
    this.markers.forEach(m => this.map.removeLayer(m));
    this.markers.clear();
  }

  flyToMarker(marker) {
    const m = this.markers.get(marker.id);
    if (m) { this.map.setView(m.getLatLng(), 16); m.openPopup(); }
  }

  // ---- 线路 ----
  addTrack(track) {
    const pts = (track.points || []).map(p => this._toLayer(L.latLng(p[1], p[0])));
    if (pts.length < 1) return;
    if (pts.length === 1) {
      const dot = L.circleMarker(pts[0], { radius: 5, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.8 }).addTo(this.map);
      dot.bindPopup(`<b>${esc(track.name)}</b><br/>${esc(track.remark || '')}`);
      dot.on('click', () => this.onTrackClick?.(track.id));
      dot._xbData = track;
      this.tracks.set(track.id, dot);
      return dot;
    }
    const line = L.polyline(pts, { color: '#2563eb', weight: 3 }).addTo(this.map);
    line.bindPopup(`<b>${esc(track.name)}</b><br/>${esc(track.remark || '')}`);
    line.on('click', () => this.onTrackClick?.(track.id));
    line._xbData = track;
    this.tracks.set(track.id, line);
    return line;
  }

  removeTrack(id) {
    const t = this.tracks.get(id);
    if (t) { this.map.removeLayer(t); this.tracks.delete(id); }
  }

  clearTracks() {
    this.tracks.forEach(t => this.map.removeLayer(t));
    this.tracks.clear();
  }

  flyToTrack(track) {
    const t = this.tracks.get(track.id);
    if (t) {
      if (t.getBounds) this.map.fitBounds(t.getBounds());
      else if (t.getLatLng) this.map.setView(t.getLatLng(), 16);
    }
  }

  // ---- 坐标搜索定位 ----
  flyToCoord(lat, lng, zoom = 16) {
    // 输入坐标按当前显示CRS处理，转WGS84后再显示
    const wgs84 = this._fromDisplay(L.latLng(lat, lng));
    const pos = this._toLayer(wgs84);
    this.map.setView(pos, zoom);
    if (this._searchMarker) this.map.removeLayer(this._searchMarker);
    this._searchMarker = L.circleMarker(pos, {
      radius: 10, color: '#dc2626', fillColor: '#f87171', fillOpacity: 0.6, weight: 2,
    }).addTo(this.map);
    this._searchMarker.bindPopup(`<b>搜索定位</b><br/>${lng.toFixed(6)}, ${lat.toFixed(6)}`).openPopup();
    setTimeout(() => {
      if (this._searchMarker) { this.map.removeLayer(this._searchMarker); this._searchMarker = null; }
    }, 8000);
  }

  // ---- 绘制线路 ----
  enableDrawTrack(callback) {
    this.disableDraw();
    const handler = new L.Draw.Polyline(this.map, { shapeOptions: { color: '#16a34a', weight: 4 } });
    handler.enable();
    this._drawHandler = handler;
    this.map.once(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      // 绘制坐标在图层CRS下，转回WGS84存储
      const pts = layer.getLatLngs().map(ll => {
        const wgs84 = this._fromLayer(ll);
        return [wgs84.lng, wgs84.lat];
      });
      this._drawnItems.addLayer(layer);
      callback(pts);
    });
  }

  // ---- 测距 ----
  enableMeasureDistance(callback) {
    this.disableDraw();
    const handler = new L.Draw.Polyline(this.map, { shapeOptions: { color: '#f59e0b', weight: 3, dashArray: '8,4' } });
    handler.enable();
    this._drawHandler = handler;
    this.map.once(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      const latlngs = layer.getLatLngs();
      let dist = 0;
      for (let i = 1; i < latlngs.length; i++) {
        // 测距用图层坐标即可（偏移对距离影响极小）
        dist += latlngs[i - 1].distanceTo(latlngs[i]);
      }
      layer.bindTooltip(`总距离: ${(dist / 1000).toFixed(2)} km`, { permanent: true });
      this._drawnItems.addLayer(layer);
      callback(dist);
    });
  }

  // ---- 面积测量 ----
  enableMeasureArea(callback) {
    this.disableDraw();
    const handler = new L.Draw.Polygon(this.map, { shapeOptions: { color: '#dc2626', weight: 3, fillOpacity: 0.1 } });
    handler.enable();
    this._drawHandler = handler;
    this.map.once(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      const latlngs = layer.getLatLngs()[0];
      let area = 0;
      const R = 6371000;
      const toRad = (d) => d * Math.PI / 180;
      if (latlngs.length > 2) {
        for (let i = 0; i < latlngs.length; i++) {
          const j = (i + 1) % latlngs.length;
          const lat1 = toRad(latlngs[i].lat);
          const lat2 = toRad(latlngs[j].lat);
          const dLng = toRad(latlngs[j].lng - latlngs[i].lng);
          area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
        }
        area = Math.abs(area * R * R / 2);
      }
      layer.bindTooltip(`面积: ${(area / 1000000).toFixed(4)} km²`, { permanent: true });
      this._drawnItems.addLayer(layer);
      callback(area);
    });
  }

  disableDraw() {
    if (this._drawHandler) {
      this._drawHandler.disable();
      this._drawHandler = null;
    }
  }

  clearDrawn() {
    this._drawnItems.clearLayers();
  }

  invalidateSize() {
    if (this.map) this.map.invalidateSize();
  }
}

export { tileSources };
