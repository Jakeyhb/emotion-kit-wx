# log-admin-ui

React + TypeScript + Vite 管理后台，查询 `node-ai-service` 写入 MySQL 的 `app_logs`。

## 开发

```bash
cd log-admin-ui
npm install
npm run dev
```

默认代理到 `http://127.0.0.1:8787`（见 `vite.config.ts`），请先本地启动 `node-ai-service`。

## 生产构建

输出到 `../node-ai-service/public/log-admin`，由 Express 在 `/log-admin/` 提供静态资源：

```bash
npm run build
```

或在 `node-ai-service` 目录执行：`npm run build:admin`。
