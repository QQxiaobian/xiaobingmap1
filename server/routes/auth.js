// 认证路由：注册、登录
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/init.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// 注册
router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名长度2-20' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });
  // 第一个注册的用户自动成为管理员
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const role = userCount.c === 0 ? 'admin' : 'user';
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    const user = { id: info.lastInsertRowid, username, role };
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' });
    throw e;
  }
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return res.status(401).json({ error: '用户名或密码错误' });
  if (!bcrypt.compareSync(password, row.password)) return res.status(401).json({ error: '用户名或密码错误' });
  const user = { id: row.id, username: row.username, role: row.role };
  res.json({ token: signToken(user), user });
});

// 获取当前用户
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
