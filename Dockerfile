# 小兵地图 - Docker 镜像
# 多阶段构建：先构建前端，再打包后端

# ---- 阶段1: 构建前端 ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 阶段2: 运行时 ----
FROM node:20-alpine AS runtime
WORKDIR /app

# 安装 better-sqlite3 编译依赖
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# 复制后端代码
COPY server/ ./server/

# 复制前端构建产物
COPY --from=builder /app/dist ./dist

# 复制 vite 配置（生产环境不需要但保留结构）
COPY vite.config.js ./

# 数据目录
RUN mkdir -p /app/data
VOLUME /app/data

# 环境变量
ENV NODE_ENV=production
ENV PORT=8678
ENV DB_PATH=/app/data/xiaobingmap.db

EXPOSE 8678

CMD ["node", "server/index.js"]
