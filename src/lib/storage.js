// 本地离线缓存，基于 localForage + IndexedDB
import localforage from 'localforage';

const stores = {
  markers: localforage.createInstance({ name: 'xiaobingmap', storeName: 'markers' }),
  tracks: localforage.createInstance({ name: 'xiaobingmap', storeName: 'tracks' }),
  meta: localforage.createInstance({ name: 'xiaobingmap', storeName: 'meta' }),
};

// 通用 CRUD for an entity store
function makeStore(store) {
  return {
    async list() {
      const items = [];
      await store.iterate((v) => { items.push(v); });
      return items;
    },
    async get(id) { return store.getItem(id); },
    async set(item) { return store.setItem(item.id, item); },
    async remove(id) { return store.removeItem(id); },
    async clear() { return store.clear(); },
  };
}

export const localMarkers = makeStore(stores.markers);
export const localTracks = makeStore(stores.tracks);

// 同步元信息
export async function getLastSync(key) {
  return (await stores.meta.getItem(`lastSync_${key}`)) || 0;
}
export async function setLastSync(key, ts) {
  await stores.meta.setItem(`lastSync_${key}`, ts);
}

// 本地待同步队列（记录已本地删除但需通知服务端的ID）
export async function getPendingDeletes(type) {
  return (await stores.meta.getItem(`pendingDel_${type}`)) || [];
}
export async function addPendingDelete(type, id) {
  const arr = await getPendingDeletes(type);
  if (!arr.includes(id)) arr.push(id);
  await stores.meta.setItem(`pendingDel_${type}`, arr);
}
export async function clearPendingDeletes(type) {
  await stores.meta.removeItem(`pendingDel_${type}`);
}

// 认证信息缓存
export async function saveAuth(auth) {
  await stores.meta.setItem('auth', auth);
}
export async function getAuth() {
  return await stores.meta.getItem('auth');
}
export async function clearAuth() {
  await stores.meta.removeItem('auth');
}

// 用户配置
export async function saveSettings(settings) {
  const cur = (await stores.meta.getItem('settings')) || {};
  await stores.meta.setItem('settings', { ...cur, ...settings });
}
export async function getSettings() {
  return (await stores.meta.getItem('settings')) || { coordDisplay: 'WGS84', defaultLayer: 'esri' };
}
