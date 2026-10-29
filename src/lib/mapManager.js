// 地图管理器：Leaflet 实例、图源切换、GPS定位、打点、绘制、测量
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

const tileSources = {
  esri: {
    name: 'Esri 卫星图',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Imagery',
    maxZoom: 19,
  },
  osm: {
    name: 'OSM 街道图',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: 'OpenStreetMap',
    maxZoom: 19,
  },
  // --- 云南常用图源 ---
  ghyx: {
    name: '高德卫星图',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    attribution: '高德地图 AutoNavi',
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    crs: CRS.GCJ02,
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
    url: 'https://p{s}.map.gtimg.com/sateTiles/{z}/{x}/{int y/16}/{y}/{x}_{y}.jpg',
    attribution: '腾讯地图 Tencent',
    maxZoom: 18,
    subdomains: ['0', '1', '2', '3'],
    crs: CRS.GCJ02,
  },
  txmap: {
    name: '腾讯街道图',
    url: 'https://p{s}.map.gtimg.com/realtimerender/{z}/{x}/{int y/16}/{y}/{x}_{y}.png',
    attribution: '腾讯地图 Tencent',
    maxZoom: 18,
    subdomains: ['0', '1', '2', '3'],
    crs: CRS.GCJ02,
  },
  ynsurvey: {
    name: '云南测绘地形',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri Topo · 云南地形',
    maxZoom: 17,
  },
  ynterrain: {
    name: '云南地形图',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri Terrain · 云南',
    maxZoom: 13,
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
  esrihybrid: {
    name: 'Esri卫星+地名',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri Imagery + Boundaries',
    maxZoom: 19,
    isHybrid: true,
  },
};

export class MapManager {
  constructor(container) {
    this.container = container;
    this.markers = new Map(); // id -> L.marker
    this.tracks = new Map(); // id -> L.polyline
    this.onMarkerClick = null;
    this.onTrackClick = null;
    this.onMapClick = null;
    this._drawnItems = null;
    this._drawHandler = null;
    this._measureLayer = null;
    this._gpsMarker = null;
    this._gpsCircle = null;
    this.currentCRS = CRS.WGS84;
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

      if (key.startsWith('tx')) {
        // 腾讯地图：自定义 URL 构造，瓦片分块目录 {int y/16}
        const TxBayer = L.TileLayer.extend({
          getTileUrl(coords) {
            const z = coords.z;
            const x = coords.x;
            const y = (1 << z) - 1 - coords.y; // 腾讯 Y 轴翻转
            const group = Math.floor(y / 16);
            const subs = ['0', '1', '2', '3'];
            const s = subs[Math.abs(x + y) % subs.length];
            const ext = src.url.endsWith('.jpg') ? '.jpg' : '.png';
            return `https://p${s}.map.gtimg.com/${src.url.includes('sateTiles') ? 'sateTiles' : 'realtimerender'}/${z}/${Math.floor(x / 16)}/${x}/${group}/${y}/${x}_${y}${ext}`;
          },
        });
        baseLayers[src.name] = new TxBayer('', opts);
      } else if (src.isHybrid) {
        // 混合图源：卫星底图 + 地名标注叠加
        const satLayer = L.tileLayer(src.url, opts);
        const labelOpts = { ...opts, maxZoom: src.maxZoom };
        if (src.subdomains) labelOpts.subdomains = src.subdomains;
        const labelLayer = L.tileLayer(src.labelUrl, { ...labelOpts, className: 'hybrid-labels' });
        const hybridGroup = L.layerGroup([satLayer, labelLayer]);
        baseLayers[src.name] = hybridGroup;
      } else {
        baseLayers[src.name] = L.tileLayer(src.url, opts);
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

    // 可绘制图层
    this._drawnItems = new L.FeatureGroup();
    this.map.addLayer(this._drawnItems);

    this.map.on('click', (e) => {
      if (this.onMapClick) this.onMapClick(this._toDisplay(e.latlng));
    });
  }

  // 坐标显示转换：Leaflet 内部始终用 WGS84，显示时按需转 GCJ02
  _toDisplay(latlng) {
    if (this.currentCRS === CRS.GCJ02) {
      const [lng, lat] = wgs84ToGcj02(latlng.lng, latlng.lat);
      return L.latLng(lat, lng);
    }
    return latlng;
  }

  // 从显示坐标转回 WGS84（用于存储）
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

  // ---- GPS 定位 ----
  locateGPS() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('浏览器不支持定位'));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
          this._showGPS(latlng, pos.coords.accuracy);
          resolve({ latlng, accuracy: pos.coords.accuracy });
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  _showGPS(latlng, accuracy) {
    if (this._gpsMarker) this.map.removeLayer(this._gpsMarker);
    if (this._gpsCircle) this.map.removeLayer(this._gpsCircle);
    this._gpsMarker = L.circleMarker(latlng, { radius: 8, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.8 }).addTo(this.map);
    if (accuracy) {
      this._gpsCircle = L.circle(latlng, { radius: accuracy, color: '#3b82f6', fillOpacity: 0.1 }).addTo(this.map);
    }
    this.map.setView(latlng, 16);
  }

  // ---- 点位 ----
  addMarker(marker) {
    const latlng = L.latLng(marker.lat, marker.lng);
    // 图标上显示点位名称（截断到4字符）
    const label = (marker.name || '').slice(0, 4) || '点';
    const icon = L.divIcon({
      className: 'xb-marker',
      html: `<div class="xb-marker-pin"><span>${esc(label)}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
    });
    const m = L.marker(latlng, { icon }).addTo(this.map);
    m.bindPopup(`<b>${esc(marker.name)}</b><br/>${esc(marker.remark || '')}<br/><small>${esc(marker.group || '')}</small>`);
    m.on('click', () => this.onMarkerClick?.(marker.id));
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
    const pts = (track.points || []).map(p => L.latLng(p[1], p[0]));
    if (pts.length < 2) return;
    const line = L.polyline(pts, { color: '#2563eb', weight: 3 }).addTo(this.map);
    line.bindPopup(`<b>${track.name}</b><br/>${track.remark || ''}`);
    line.on('click', () => this.onTrackClick?.(track.id));
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
    if (t) this.map.fitBounds(t.getBounds());
  }

  // ---- 绘制线路 ----
  enableDrawTrack(callback) {
    this.disableDraw();
    const handler = new L.Draw.Polyline(this.map, { shapeOptions: { color: '#16a34a', weight: 4 } });
    handler.enable();
    this._drawHandler = handler;
    this.map.once(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      const pts = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
      this._drawnItems.addLayer(layer);
      callback(pts);
    });
  }

  // ---- 多点测距 ----
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
      // Shoelace on projected coords using simple equirectangular approx
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
