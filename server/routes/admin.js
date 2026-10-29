// 管理员路由：用户管理、全量数据
import { Router } from 'express';
import db from '../db/init.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireAdmin);

// 用户列表
router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json(rows.map(r => ({ id: r.id, username: r.username, role: r.role, createdAt: r.created_at })));
});

// 删除用户（不能删除自己、不能删除其他管理员）
router.delete('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// 全部点位（含用户名）
router.get('/markers', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.username FROM markers m
    LEFT JOIN users u ON m.user_id = u.id
  `).all();
  res.json(rows.map(r => ({
    id: r.id, userId: r.user_id, username: r.username,
    name: r.name, remark: r.remark, group: r.group,
    lat: r.lat, lng: r.lng, updateAt: r.update_at,
  })));
});

// 全部线路
router.get('/tracks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, u.username FROM tracks t
    LEFT JOIN users u ON t.user_id = u.id
  `).all();
  res.json(rows.map(r => ({
    id: r.id, userId: r.user_id, username: r.username,
    name: r.name, remark: r.remark, group: r.group,
    points: JSON.parse(r.points), updateAt: r.update_at,
  })));
});

// 批量删除点位
router.delete('/markers', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  const stmt = db.prepare('DELETE FROM markers WHERE id = ?');
  const tx = db.transaction(() => ids.forEach(id => stmt.run(id)));
  tx();
  res.json({ ok: true, deleted: ids.length });
});

// 批量删除线路
router.delete('/tracks', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  const stmt = db.prepare('DELETE FROM tracks WHERE id = ?');
  const tx = db.transaction(() => ids.forEach(id => stmt.run(id)));
  tx();
  res.json({ ok: true, deleted: ids.length });
});

export default router;
