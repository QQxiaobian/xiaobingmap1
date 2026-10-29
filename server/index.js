// Express 服务端入口
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import authRoutes from './routes/auth.js';
import markerRoutes from './routes/markers.js';
import trackRoutes from './routes/tracks.js';
import adminRoutes from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8678;
const isProd = process.env.NODE_ENV === 'production';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/markers', markerRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api/admin', adminRoutes);

// 生产环境：托管前端静态文件
const distDir = join(__dirname, '..', 'dist');
if (isProd && existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distDir, 'index.html'));
    }
  });
}

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[xiaobingmap] 服务已启动: http://0.0.0.0:${PORT}`);
  console.log(`[xiaobingmap] 模式: ${isProd ? '生产' : '开发'}`);
});
