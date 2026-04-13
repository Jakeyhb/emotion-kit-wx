# Node AI Service Template

This service is a bridge between your mini program cloud functions and DashScope.

It exposes one endpoint:

- `POST /ai/reflect` for chat-style inference (used by your cloud functions)

And one health endpoint:

- `GET /healthz`

Log viewer (same Bearer token as API, default `SERVICE_TOKEN`):

- `GET /admin` — simple HTML page to browse `logs/app.log` tail
- `GET /admin/api/logs?lines=300` — JSON tail lines (requires `Authorization: Bearer …`)

Optional env: `LOG_ADMIN_TOKEN` (if set, only this token can open `/admin`; API `/ai/reflect` still uses `SERVICE_TOKEN`).

## 1) Install and run

```bash
cd node-ai-service
npm install
```

Set environment variables (or use your deployment platform's secret config):

- `PORT` default `8787`
- `DASHSCOPE_API_KEY` required
- `DASHSCOPE_API_HOST` optional, default `dashscope.aliyuncs.com`
- `DASHSCOPE_MODEL` optional, default `qwen3-max`
- `SERVICE_TOKEN` optional but recommended

Start:

```bash
npm start
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
