# xiaobingmap

精简版奥维地图工具 — 自用网页版地图，基于 Leaflet + 原生 HTML/JS 前端 + Node Express 后端 + SQLite 持久化。

## 功能

- **图源切换**：Esri 卫星图 / OSM 街道图，在线瓦片
- **GPS 定位**：浏览器原生定位，获取 WGS84 坐标
- **坐标转换**：WGS84 ↔ GCJ02 双向转换
- **地图操作**：打点标记（名称/备注/分组）、绘制线路轨迹、多点测距、面积测量
- **文件互通**：导入/导出 GPX / GeoJSON / CSV，兼容奥维格式
- **账号系统**：注册/登录，管理员可管理全部数据，普通用户仅管理自己的数据
- **离线优先**：IndexedDB 本地缓存，断网可编辑，联网自动增量双向同步（updateAt 版本判断，服务端优先）
- **管理后台**：用户管理、批量导出/删除
- **移动端适配**：触屏优先，自带调试控制台

## 快速开始

### 本地开发

```bash
npm install
npm run dev:all
```

前端运行在 `http://localhost:5173`，后端 API 在 `http://localhost:8678`，Vite 自动代理 `/api` 到后端。

### Docker 部署（飞牛）

```bash
docker-compose up -d
```

服务监听 `8678` 端口，仅 HTTP。由飞牛 FN Connect 提供 HTTPS 反向代理，满足浏览器 GPS 定位要求。

数据持久化在 `./data` 目录。

## 默认管理员

首次启动自动创建管理员账号：

- 用户名：`admin`
- 密码：`admin`

**请登录后立即修改密码**（删除默认账号或通过数据库修改）。

## 项目结构

```
├── src/                # 前端源码
│   ├── lib/            # 核心库（坐标转换、存储、API、同步、文件IO）
│   ├── styles/         # 样式
│   └── main.js         # 应用入口
├── server/             # Express 后端
│   ├── db/             # SQLite 初始化
│   ├── routes/         # 路由（auth, markers, tracks, admin）
│   ├── middleware/     # JWT 鉴权中间件
│   └── index.js        # 服务入口
├── public/             # 静态资源（Leaflet CSS/图标）
├── data/               # SQLite 数据库（运行时生成）
├── Dockerfile          # 多阶段构建
├── docker-compose.yml  # 飞牛部署配置
└── vite.config.js      # Vite 配置
```

## 技术栈

- 前端：Leaflet + leaflet-draw + localForage + 原生 HTML/JS
- 后端：Node.js + Express + better-sqlite3 + jsonwebtoken + bcryptjs
- 部署：Docker + 飞牛 FN Connect (HTTPS)

## 端口说明

后端固定监听 `8678` 端口，不内置 SSL 证书，由飞牛 FN Connect 提供 HTTPS。

精简版奥维地图工具 — 自用网页版地图，基于 Leaflet + 原生 HTML/JS 前端 + Node Express 后端 + SQLite 持久化。

## 功能

- **图源切换**：Esri 卫星图 / OSM 街道图，在线瓦片
- **GPS 定位**：浏览器原生定位，获取 WGS84 坐标
- **坐标转换**：WGS84 ↔ GCJ02 双向转换
- **地图操作**：打点标记（名称/备注/分组）、绘制线路轨迹、多点测距、面积测量
- **文件互通**：导入/导出 GPX / GeoJSON / CSV，兼容奥维格式
- **账号系统**：注册/登录，管理员可管理全部数据，普通用户仅管理自己的数据
- **离线优先**：IndexedDB 本地缓存，断网可编辑，联网自动增量双向同步（updateAt 版本判断，服务端优先）
- **管理后台**：用户管理、批量导出/删除
- **移动端适配**：触屏优先，自带调试控制台

## 快速开始

### 本地开发

```bash
npm install
npm run dev:all
```

前端运行在 `http://localhost:5173`，后端 API 在 `http://localhost:8678`，Vite 自动代理 `/api` 到后端。

### Docker 部署（飞牛）

```bash
docker-compose up -d
```

服务监听 `8678` 端口，仅 HTTP。由飞牛 FN Connect 提供 HTTPS 反向代理，满足浏览器 GPS 定位要求。

数据持久化在 `./data` 目录。

## 默认管理员

首次启动自动创建管理员账号：

- 用户名：`admin`
- 密码：`admin`

**请登录后立即修改密码**（删除默认账号或通过数据库修改）。

## 项目结构

```
├── src/                # 前端源码
│   ├── lib/            # 核心库（坐标转换、存储、API、同步、文件IO）
│   ├── styles/         # 样式
│   └── main.js         # 应用入口
├── server/             # Express 后端
│   ├── db/             # SQLite 初始化
│   ├── routes/         # 路由（auth, markers, tracks, admin）
│   ├── middleware/     # JWT 鉴权中间件
│   └── index.js        # 服务入口
├── public/             # 静态资源（Leaflet CSS/图标）
├── data/               # SQLite 数据库（运行时生成）
├── Dockerfile          # 多阶段构建
├── docker-compose.yml  # 飞牛部署配置
└── vite.config.js      # Vite 配置
```

## 技术栈

- 前端：Leaflet + leaflet-draw + localForage + 原生 HTML/JS
- 后端：Node.js + Express + better-sqlite3 + jsonwebtoken + bcryptjs
- 部署：Docker + 飞牛 FN Connect (HTTPS)

## 端口说明

后端固定监听 `8678` 端口，不内置 SSL 证书，由飞牛 FN Connect 提供 HTTPS。

