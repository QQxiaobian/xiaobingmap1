// 后端 API 客户端：统一请求封装，带 JWT 鉴权，断网降级
import { getAuth } from './storage.js';

const BASE = '/api';

let online = navigator.onLine;
window.addEventListener('online', () => { online = true; });
window.addEventListener('offline', () => { online = false; });

export function isOnline() { return online; }

async function request(path, options = {}) {
  const auth = await getAuth();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth?.token) headers['Authorization'] = `Bearer ${auth.token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- 认证 ----
export const api = {
  async register(username, password) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  async login(username, password) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  // ---- 点位 ----
  async listMarkers(since = 0) {
    return request(`/markers?since=${since}`);
  },
  async syncMarkers(upserts, deletes) {
    return request('/markers/sync', {
      method: 'POST',
      body: JSON.stringify({ upserts, deletes }),
    });
  },

  // ---- 线路 ----
  async listTracks(since = 0) {
    return request(`/tracks?since=${since}`);
  },
  async syncTracks(upserts, deletes) {
    return request('/tracks/sync', {
      method: 'POST',
      body: JSON.stringify({ upserts, deletes }),
    });
  },

  // ---- 管理员 ----
  async adminListUsers() {
    return request('/admin/users');
  },
  async adminDeleteUser(id) {
    return request(`/admin/users/${id}`, { method: 'DELETE' });
  },
  async adminListAllMarkers() {
    return request('/admin/markers');
  },
  async adminListAllTracks() {
    return request('/admin/tracks');
  },
  async adminDeleteMarkers(ids) {
    return request('/admin/markers', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  },
  async adminDeleteTracks(ids) {
    return request('/admin/tracks', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  },

  // ---- 健康 ----
  async ping() {
    try {
      await request('/health');
      return true;
    } catch { return false; }
  },
};
