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
function insertLogRow({ phase, level, meta_json, created_at, openid, source, record_id }) {
  const p = getPool();
  if (!p) return Promise.resolve();
  const ph = String(phase || "").slice(0, 128);
  const lv = String(level || "info").slice(0, 16);
  const oid = String(openid || "").slice(0, 64);
  const src = String(source || "").slice(0, 32);
  const rid = String(record_id != null ? record_id : "").slice(0, 128);
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
  return p.execute(
    "INSERT INTO app_logs (openid, source, record_id, created_at, phase, level, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [oid, src, rid, t, ph, lv, metaStr]
  )
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
  openid = "",
  source = "",
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
  if (openid && String(openid).trim()) {
    where.push("openid = ?");
    params.push(String(openid).trim().slice(0, 64));
  }
  if (source && String(source).trim()) {
    where.push("source = ?");
    params.push(String(source).trim().slice(0, 32));
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
    `SELECT id, openid, source, record_id, created_at, phase, level, meta_json FROM app_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
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
      openid: r.openid != null ? String(r.openid) : "",
      source: r.source != null ? String(r.source) : "",
      record_id: r.record_id != null ? String(r.record_id) : "",
      created_at: r.created_at,
      phase: r.phase,
      level: r.level,
      meta_json: meta,
    };
  });
  return { ok: true, mysql: true, rows: normalized, total, page, pageSize: limit };
}

async function countAdmins() {
  const p = getPool();
  if (!p) return 0;
  const [rows] = await p.execute("SELECT COUNT(*) AS c FROM admin_users");
  return rows && rows[0] ? Number(rows[0].c) || 0 : 0;
}

async function findAdminByUsername(username) {
  const p = getPool();
  if (!p) return null;
  const u = String(username || "").trim().slice(0, 64);
  if (!u) return null;
  const [rows] = await p.execute(
    "SELECT id, username, password_hash, role FROM admin_users WHERE username = ? LIMIT 1",
    [u]
  );
  return rows && rows[0] ? rows[0] : null;
}

async function insertAdmin({ username, password_hash, role }) {
  const p = getPool();
  if (!p) throw new Error("mysql not configured");
  const u = String(username || "").trim().slice(0, 64);
  const h = String(password_hash || "");
  const r = String(role || "super_admin").slice(0, 32);
  await p.execute("INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)", [u, h, r]);
}

module.exports = {
  mysqlEnabled,
  getPool,
  insertLogRow,
  queryLogs,
  countAdmins,
  findAdminByUsername,
  insertAdmin,
};
