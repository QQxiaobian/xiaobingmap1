// 增量双向同步引擎
// 策略：以 updateAt 时间戳做版本判断，服务端优先
// 1. 推送本地变更（upserts + 删除）到服务端
// 2. 拉取服务端最新数据（since lastSync）
// 3. 合并：服务端版本 updateAt > 本地则覆盖本地
import { api, isOnline } from './api.js';
import {
  localMarkers, localTracks,
  getLastSync, setLastSync,
  getPendingDeletes, clearPendingDeletes,
} from './storage.js';

// 收集本地有变更的实体（_dirty 标记 或 从未同步过的）
function collectDirty(store) {
  return store.list().then(items => items.filter(i => i._dirty));
}

// 推送本地变更并处理服务端返回的冲突结果
async function pushEntities(type, store, since) {
  const dirty = await collectDirty(store);
  const deletes = await getPendingDeletes(type);
  if (dirty.length === 0 && deletes.length === 0) return;
  const upserts = dirty.map(({ _dirty, ...rest }) => rest);
  const result = await api[`sync${type}`](upserts, deletes);
  // 服务端返回已接受的实体（含服务端写入的 updateAt）
  const accepted = result.accepted || [];
  for (const item of accepted) {
    await store.set({ ...item, _dirty: false });
  }
  // 标记本地为已同步
  for (const d of dirty) {
    await store.set({ ...d, _dirty: false });
  }
  await clearPendingDeletes(type);
}

// 拉取服务端数据并合并到本地
async function pullEntities(type, store, since) {
  const data = await api[`list${type}`](since);
  const items = data.items || [];
  for (const remote of items) {
    const local = await store.get(remote.id);
    if (!local || (remote.updateAt || 0) >= (local.updateAt || 0)) {
      // 服务端优先：服务端版本更新则覆盖
      await store.set({ ...remote, _dirty: false });
    }
  }
  return data.serverTime || Date.now();
}

async function syncType(type, store) {
  const since = await getLastSync(type);
  if (isOnline()) {
    await pushEntities(type, store, since);
    const newTime = await pullEntities(type, store, since);
    await setLastSync(type, newTime);
  }
}

export async function syncAll() {
  if (!isOnline()) return { synced: false, reason: 'offline' };
  try {
    await syncType('Markers', localMarkers);
    await syncType('Tracks', localTracks);
    return { synced: true };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}
