// 点位路由：列表查询、增量同步
import { Router } from 'express';
import db from '../db/init.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// 查询：普通用户看自己的，管理员看全部，支持 since 增量
router.get('/', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare('SELECT id, user_id, name, remark, "group", lat, lng, update_at FROM markers WHERE update_at > ?').all(since);
  } else {
    rows = db.prepare('SELECT id, user_id, name, remark, "group", lat, lng, update_at FROM markers WHERE user_id = ? AND update_at > ?').all(req.user.id, since);
  }
  const items = rows.map(r => ({
    id: r.id, userId: r.user_id, name: r.name, remark: r.remark, group: r.group,
    lat: r.lat, lng: r.lng, updateAt: r.update_at,
  }));
  res.json({ items, serverTime: Date.now() });
});

// 同步：批量 upsert + delete
router.post('/sync', (req, res) => {
  const { upserts = [], deletes = [] } = req.body;
  const now = Date.now();
  const accepted = [];
  const upsertStmt = db.prepare(`
    INSERT INTO markers (id, user_id, name, remark, "group", lat, lng, update_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, remark=excluded.remark, "group"=excluded."group",
      lat=excluded.lat, lng=excluded.lng, update_at=excluded.update_at
    WHERE markers.user_id = ? AND markers.update_at <= excluded.update_at
  `);
  const checkStmt = db.prepare('SELECT user_id, update_at FROM markers WHERE id = ?');

  const tx = db.transaction(() => {
    for (const item of upserts) {
      const existing = checkStmt.get(item.id);
      // 权限检查：新记录无所有者限制（user_id 由 token 决定），已有记录必须属于本人
      if (existing && existing.user_id !== req.user.id && req.user.role !== 'admin') continue;
      const updateAt = item.updateAt || now;
      // 冲突处理：服务端优先 — 如果服务端版本更新则跳过
      if (existing && existing.update_at > updateAt) continue;
      const result = upsertStmt.run(
        item.id, req.user.id, item.name || '', item.remark || '',
        item.group || '', item.lat, item.lng, updateAt,
        req.user.id
      );
      accepted.push({ ...item, userId: req.user.id, updateAt });
    }
    // 处理删除
    const delStmt = db.prepare('DELETE FROM markers WHERE id = ? AND user_id = ?');
    const delStmtAdmin = db.prepare('DELETE FROM markers WHERE id = ?');
    for (const id of deletes) {
      if (req.user.role === 'admin') delStmtAdmin.run(id);
      else delStmt.run(id, req.user.id);
    }
  });
  tx();
  res.json({ accepted, serverTime: now });
});

export default router;
