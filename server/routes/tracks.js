// 线路路由：列表查询、增量同步
import { Router } from 'express';
import db from '../db/init.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare('SELECT id, user_id, name, remark, "group", points, update_at FROM tracks WHERE update_at > ?').all(since);
  } else {
    rows = db.prepare('SELECT id, user_id, name, remark, "group", points, update_at FROM tracks WHERE user_id = ? AND update_at > ?').all(req.user.id, since);
  }
  const items = rows.map(r => ({
    id: r.id, userId: r.user_id, name: r.name, remark: r.remark, group: r.group,
    points: JSON.parse(r.points), updateAt: r.update_at,
  }));
  res.json({ items, serverTime: Date.now() });
});

router.post('/sync', (req, res) => {
  const { upserts = [], deletes = [] } = req.body;
  const now = Date.now();
  const accepted = [];
  const upsertStmt = db.prepare(`
    INSERT INTO tracks (id, user_id, name, remark, "group", points, update_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, remark=excluded.remark, "group"=excluded."group",
      points=excluded.points, update_at=excluded.update_at
    WHERE tracks.user_id = ? AND tracks.update_at <= excluded.update_at
  `);
  const checkStmt = db.prepare('SELECT user_id, update_at FROM tracks WHERE id = ?');

  const tx = db.transaction(() => {
    for (const item of upserts) {
      const existing = checkStmt.get(item.id);
      if (existing && existing.user_id !== req.user.id && req.user.role !== 'admin') continue;
      const updateAt = item.updateAt || now;
      if (existing && existing.update_at > updateAt) continue;
      upsertStmt.run(
        item.id, req.user.id, item.name || '', item.remark || '',
        item.group || '', JSON.stringify(item.points || []), updateAt,
        req.user.id
      );
      accepted.push({ ...item, userId: req.user.id, updateAt });
    }
    const delStmt = db.prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?');
    const delStmtAdmin = db.prepare('DELETE FROM tracks WHERE id = ?');
    for (const id of deletes) {
      if (req.user.role === 'admin') delStmtAdmin.run(id);
      else delStmt.run(id, req.user.id);
    }
  });
  tx();
  res.json({ accepted, serverTime: now });
});

export default router;
