// 文件导入导出：GPX / GeoJSON / CSV / KML / SHP
// 支持点位(marker)与线路(track)双向

import { localMarkers, localTracks } from './storage.js';
import shp from 'shpjs';

const uid = () => 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();

// ===== GeoJSON =====
export function toGeoJSON(markers, tracks) {
  const features = [];
  for (const m of markers) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: { name: m.name, remark: m.remark, group: m.group, type: 'marker', id: m.id },
    });
  }
  for (const t of tracks) {
    const coords = (t.points || []).map(p => [p[0], p[1]]);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { name: t.name, remark: t.remark, group: t.group, type: 'track', id: t.id },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function parseGeoJSON(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const markers = [], tracks = [];
  for (const f of data.features || []) {
    const props = f.properties || {};
    if (f.geometry?.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      markers.push({
        id: uid(), name: props.name || '导入点位', remark: props.remark || '',
        group: props.group || '导入', lat, lng, updateAt: now(), _dirty: true,
      });
    } else if (f.geometry?.type === 'LineString') {
      tracks.push({
        id: uid(), name: props.name || '导入线路', remark: props.remark || '',
        group: props.group || '导入',
        points: f.geometry.coordinates, updateAt: now(), _dirty: true,
      });
    }
  }
  return { markers, tracks };
}

// ===== GPX =====
export function toGPX(markers, tracks) {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="xiaobingmap" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  for (const m of markers) {
    gpx += `  <wpt lat="${m.lat}" lon="${m.lng}"><name>${esc(m.name)}</name><desc>${esc(m.remark)}</desc></wpt>\n`;
  }
  for (const t of tracks) {
    gpx += `  <trk><name>${esc(t.name)}</name><trkseg>\n`;
    for (const [lng, lat] of t.points || []) {
      gpx += `    <trkpt lat="${lat}" lon="${lng}"/>\n`;
    }
    gpx += `  </trkseg></trk>\n`;
  }
  gpx += `</gpx>`;
  return gpx;
}

export function parseGPX(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const markers = [], tracks = [];
  const wpts = doc.querySelectorAll('wpt');
  wpts.forEach(w => {
    markers.push({
      id: uid(), name: w.querySelector('name')?.textContent || '导入点位',
      remark: w.querySelector('desc')?.textContent || '',
      group: '导入', lat: parseFloat(w.getAttribute('lat')), lng: parseFloat(w.getAttribute('lon')),
      updateAt: now(), _dirty: true,
    });
  });
  const trks = doc.querySelectorAll('trk');
  trks.forEach(trk => {
    const points = [];
    trk.querySelectorAll('trkpt').forEach(pt => {
      points.push([parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
    });
    if (points.length) {
      tracks.push({
        id: uid(), name: trk.querySelector('name')?.textContent || '导入线路',
        remark: '', group: '导入', points, updateAt: now(), _dirty: true,
      });
    }
  });
  return { markers, tracks };
}

// ===== CSV =====
// 格式: type,name,remark,group,lat,lng 或 type,name,remark,group,points
export function toCSV(markers, tracks) {
  let csv = 'type,name,remark,group,lat,lng,points\n';
  for (const m of markers) {
    csv += `marker,${csvEsc(m.name)},${csvEsc(m.remark)},${csvEsc(m.group)},${m.lat},${m.lng},\n`;
  }
  for (const t of tracks) {
    const pts = (t.points || []).map(p => `${p[0]},${p[1]}`).join(';');
    csv += `track,${csvEsc(t.name)},${csvEsc(t.remark)},${csvEsc(t.group)},,,${pts}\n`;
  }
  return csv;
}

export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const markers = [], tracks = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 6) continue;
    const [type, name, remark, group, lat, lng, pointsStr] = cols;
    if (type === 'marker' && lat && lng) {
      markers.push({
        id: uid(), name: name || '导入点位', remark: remark || '', group: group || '导入',
        lat: parseFloat(lat), lng: parseFloat(lng), updateAt: now(), _dirty: true,
      });
    } else if (type === 'track' && pointsStr) {
      const points = pointsStr.split(';').filter(s => s).map(s => {
        const [plng, plat] = s.split(',');
        return [parseFloat(plng), parseFloat(plat)];
      });
      if (points.length) {
        tracks.push({
          id: uid(), name: name || '导入线路', remark: remark || '', group: group || '导入',
          points, updateAt: now(), _dirty: true,
        });
      }
    }
  }
  return { markers, tracks };
}

// ---- helpers ----
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function csvEsc(s) { s = String(s || ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { result.push(cur); cur = ''; }
      else cur += c;
    }
  }
  result.push(cur);
  return result;
}

// ===== KML =====
export function parseKML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const markers = [], tracks = [];

  // Placemark 中的 Point
  doc.querySelectorAll('Placemark').forEach(pm => {
    const name = pm.querySelector('name')?.textContent || '导入点位';
    const remark = pm.querySelector('description')?.textContent || '';
    const styleUrl = pm.querySelector('styleUrl')?.textContent || '';
    const group = styleUrl ? styleUrl.replace(/^#/, '') : '导入';

    const point = pm.querySelector('Point');
    if (point) {
      const coords = point.querySelector('coordinates')?.textContent.trim();
      if (coords) {
        const [lng, lat] = coords.split(',').map(parseFloat);
        if (!isNaN(lng) && !isNaN(lat)) {
          markers.push({
            id: uid(), name, remark, group, lat, lng, updateAt: now(), _dirty: true,
          });
        }
      }
    }

    const line = pm.querySelector('LineString');
    if (line) {
      const coordsText = line.querySelector('coordinates')?.textContent.trim();
      if (coordsText) {
        const points = coordsText.split(/\s+/).filter(s => s).map(s => {
          const [lng, lat] = s.split(',').map(parseFloat);
          return [lng, lat];
        });
        if (points.length) {
          tracks.push({
            id: uid(), name, remark, group, points, updateAt: now(), _dirty: true,
          });
        }
      }
    }

    // Polygon 转为闭合线路
    const polygon = pm.querySelector('Polygon');
    if (polygon) {
      const outer = polygon.querySelector('outerBoundaryIs coordinates')?.textContent.trim();
      if (outer) {
        const points = outer.split(/\s+/).filter(s => s).map(s => {
          const [lng, lat] = s.split(',').map(parseFloat);
          return [lng, lat];
        });
        if (points.length > 2) {
          tracks.push({
            id: uid(), name, remark, group, points, updateAt: now(), _dirty: true,
          });
        }
      }
    }
  });

  // Folder/Document 中的 styleMap 名称用作分组
  return { markers, tracks };
}

export function toKML(markers, tracks) {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n`;
  for (const m of markers) {
    kml += `  <Placemark><name>${esc(m.name)}</name><description>${esc(m.remark)}</description><Point><coordinates>${m.lng},${m.lat},0</coordinates></Point></Placemark>\n`;
  }
  for (const t of tracks) {
    kml += `  <Placemark><name>${esc(t.name)}</name><description>${esc(t.remark)}</description><LineString><coordinates>`;
    kml += (t.points || []).map(p => `${p[0]},${p[1]},0`).join(' ');
    kml += `</coordinates></LineString></Placemark>\n`;
  }
  kml += `</Document>\n</kml>`;
  return kml;
}

// ===== SHP =====
// shpjs 可接受 ArrayBuffer 或 URL，返回 GeoJSON
export async function parseSHP(buffer) {
  const geojson = await shp(buffer);
  // shpjs 可能返回单个 Feature 或 FeatureCollection
  const fc = geojson.type === 'FeatureCollection' ? geojson : { type: 'FeatureCollection', features: [geojson] };
  return parseGeoJSON(fc);
}

export async function importData(text, format, fileBuffer) {
  let parsed;
  if (format === 'geojson') parsed = parseGeoJSON(text);
  else if (format === 'gpx') parsed = parseGPX(text);
  else if (format === 'csv') parsed = parseCSV(text);
  else if (format === 'kml') parsed = parseKML(text);
  else if (format === 'shp') parsed = await parseSHP(fileBuffer);
  else throw new Error('未知格式');
  for (const m of parsed.markers) await localMarkers.set(m);
  for (const t of parsed.tracks) await localTracks.set(t);
  return parsed;
}

export async function exportData(format) {
  const markers = await localMarkers.list();
  const tracks = await localTracks.list();
  if (format === 'geojson') return { content: JSON.stringify(toGeoJSON(markers, tracks), null, 2), ext: 'geojson' };
  if (format === 'gpx') return { content: toGPX(markers, tracks), ext: 'gpx' };
  if (format === 'csv') return { content: toCSV(markers, tracks), ext: 'csv' };
  if (format === 'kml') return { content: toKML(markers, tracks), ext: 'kml' };
  throw new Error('未知格式');
}

export function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
