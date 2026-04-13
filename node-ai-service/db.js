/**
 * MySQL 连接池与日志读写（可选；未配置 MYSQL_HOST 时为空）
 */
const mysql = require("mysql2/promise");

let pool = null;

function mysqlEnabled() {
  return String(process.env.MYSQL_HOST || "").trim().length > 0;
}

function getPool() {
  if (!mysqlEnabled()) return null;
  if (pool) return pool;
  pool = mysql.createPool({
    host: String(process.env.MYSQL_HOST || "").trim(),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: String(process.env.MYSQL_USER || "").trim(),
    password: String(process.env.MYSQL_PASSWORD || ""),
    database: String(process.env.MYSQL_DATABASE || "").trim(),
    waitForConnections: true,
    connectionLimit: Math.min(Math.max(Number(process.env.MYSQL_POOL_MAX) || 10, 2), 50),
    enableKeepAlive: true,
    timezone: "Z",
  });
  return pool;
}

/**
 * 异步插入一条日志（不阻塞主流程）
 */
function insertLogRow({ phase, level, meta_json, created_at }) {
  const p = getPool();
  if (!p) return Promise.resolve();
  const ph = String(phase || "").slice(0, 128);
  const lv = String(level || "info").slice(0, 16);
  let metaStr = null;
  try {
    metaStr =
      typeof meta_json === "string"
        ? meta_json
        : JSON.stringify(meta_json != null ? meta_json : {});
  } catch (e) {
    metaStr = JSON.stringify({ err: "meta serialize fail" });
  }
  const t = created_at instanceof Date ? created_at : new Date(created_at || Date.now());
  return p.execute("INSERT INTO app_logs (phase, level, meta_json, created_at) VALUES (?, ?, ?, ?)", [
    ph,
    lv,
    metaStr,
    t,
  ])
    .catch((err) => {
      console.error("[node-ai-service] mysql insertLogRow", err && err.message ? err.message : err);
    });
}

/**
 * 分页查询
 */
async function queryLogs({
  page = 1,
  pageSize = 50,
  phase = "",
  from = null,
  to = null,
}) {
  const p = getPool();
  if (!p) {
    return { ok: false, errMsg: "mysql not configured", mysql: false, rows: [], total: 0 };
  }
  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const where = ["1=1"];
  const params = [];
  if (phase && String(phase).trim()) {
    where.push("phase LIKE ?");
    params.push(`%${String(phase).trim().slice(0, 128)}%`);
  }
  if (from) {
    where.push("created_at >= ?");
    params.push(new Date(from));
  }
  if (to) {
    where.push("created_at <= ?");
    params.push(new Date(to));
  }
  const whereSql = where.join(" AND ");
  const [countRows] = await p.execute(
    `SELECT COUNT(*) AS c FROM app_logs WHERE ${whereSql}`,
    params
  );
  const total = countRows && countRows[0] ? Number(countRows[0].c) || 0 : 0;
  const [rows] = await p.execute(
    `SELECT id, created_at, phase, level, meta_json FROM app_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const normalized = (rows || []).map((r) => {
    let meta = r.meta_json;
    if (meta != null && typeof meta === "string") {
      try {
        meta = JSON.parse(meta);
      } catch (e) {}
    }
    return {
      id: r.id,
      created_at: r.created_at,
      phase: r.phase,
      level: r.level,
      meta_json: meta,
    };
  });
  return { ok: true, mysql: true, rows: normalized, total, page, pageSize: limit };
}

module.exports = {
  mysqlEnabled,
  getPool,
  insertLogRow,
  queryLogs,
};
