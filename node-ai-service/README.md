# Node AI Service Template

This service is a bridge between your mini program cloud functions and DashScope.

## API

- `POST /ai/reflect` — chat-style inference (used by your cloud functions)
- `GET /healthz` — health check (`mysql` / `reactAdmin` flags when enabled)

## Logs

### File tail (legacy)

- `GET /admin` — redirects to `/log-admin/` when the React build exists; otherwise a simple HTML page for `logs/app.log` tail
- `GET /admin/api/logs?lines=300` — JSON tail from file (requires `Authorization: Bearer …`)

### MySQL + React admin (recommended)

1. Create a MySQL database and run `schema.sql`.
2. Set env: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.
3. Build the React UI from repo root:

```bash
cd log-admin-ui
npm install
npm run build
```

Output goes to `node-ai-service/public/log-admin/`. Restart the Node process.

4. Open `http://your-host:8787/log-admin/` (or via Nginx), paste **Bearer Token** (`SERVICE_TOKEN` or `LOG_ADMIN_TOKEN`).

REST API (same auth):

- `GET /api/logs/meta` — `{ mysql: true|false }`
- `GET /api/logs?page=1&pageSize=50&phase=...&from=ISO&to=ISO` — paginated rows from `app_logs`

Optional: `CORS_ORIGIN=http://localhost:5173` for Vite dev (`npm run dev` in `log-admin-ui`).

Optional env: `LOG_ADMIN_TOKEN` — if set, only this token can use `/admin` and `/api/logs`; `/ai/reflect` still uses `SERVICE_TOKEN`.

## 1) Install and run

```bash
cd node-ai-service
npm install
```

Environment variables (see `.env.example`):

- `PORT` default `8787`
- `DASHSCOPE_API_KEY` required
- `DASHSCOPE_API_HOST` optional, default `dashscope.aliyuncs.com`
- `DASHSCOPE_MODEL` optional, default `qwen3-max`
- `SERVICE_TOKEN` optional but recommended
- MySQL variables optional — when set, structured logs are stored in `app_logs`

Start:

```bash
npm start
```

Shortcut to build admin UI (from `node-ai-service`):

```bash
npm run build:admin
```

## 2) Test quickly

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

Chat call:

```bash
curl -X POST http://127.0.0.1:8787/ai/reflect \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token_if_configured" \
  -d "{\"task\":\"chat\",\"model\":\"qwen3-max\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"
```

## 3) Connect cloud functions to this service

In both cloud functions `quickstartFunctions` and `emotionReflectWorker`, set:

- `REFLECT_AI_PROVIDER=node`
- `NODE_AI_SERVICE_URL=https://your-domain/ai/reflect`
- `NODE_AI_SERVICE_TOKEN=your_token_if_configured`

If you keep `REFLECT_AI_PROVIDER=auto`, the cloud code uses Node service when `NODE_AI_SERVICE_URL` is set; otherwise it falls back to DashScope direct call.

## 4) Expected request/response contract

Request shape from cloud function:

```json
{
  "task": "chat",
  "model": "qwen3-max",
  "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
  "max_tokens": 960,
  "temperature": 0.55,
  "stream": false
}
```

Response shape:

```json
{
  "ok": true,
  "data": {
    "content": "...",
    "usage": {},
    "model": "qwen3-max"
  },
  "ms": 1234
}
```
