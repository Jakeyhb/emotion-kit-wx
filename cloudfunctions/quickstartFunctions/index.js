const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const EMOTION_COLLECTION = "emotion_kit_records";
const DASH_PING_COLLECTION = "dash_ping";
/** 用户资料：与情绪记录分离，一条文档对应一个 openid（由服务端写入 openid） */
const USER_PROFILE_COLLECTION = "emotion_kit_users";
/** AI 解读异步任务文档（reflectJobStart / reflectJobRun / reflectJobStatus） */
const REFLECT_JOBS_COLLECTION = "emotion_kit_reflect_jobs";

function savedAtToNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

async function ensureEmotionCollection() {
  try {
    await db.createCollection(EMOTION_COLLECTION);
  } catch (e) {}
}

async function ensureDashPingCollection() {
  try {
    await db.createCollection(DASH_PING_COLLECTION);
  } catch (e) {}
}

async function ensureUserProfileCollection() {
  try {
    await db.createCollection(USER_PROFILE_COLLECTION);
  } catch (e) {}
}

async function ensureReflectJobsCollection() {
  try {
    await db.createCollection(REFLECT_JOBS_COLLECTION);
  } catch (e) {}
}

const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

exports.main = async (event) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();

    case "initEnv": {
      await ensureEmotionCollection();
      await ensureUserProfileCollection();
      await ensureReflectJobsCollection();
      return {
        success: true,
        collection: EMOTION_COLLECTION,
        tips: [
          "已确保集合 emotion_kit_records、emotion_kit_users、emotion_kit_reflect_jobs 存在（新环境首次调用会自动创建）。",
          "AI 解读请在云开发控制台为云函数 emotionReflectWorker、quickstartFunctions 配置相同的环境变量 DASHSCOPE_API_KEY。",
          "情绪解读：reflectJobStart 建任务后，小程序对 quickstartFunctions 调 type=reflectJobRun（slow、长 timeout）在同进程执行 AI；勿云函数互调 emotionReflectWorker（约 3s 硬限制）。默认百炼 qwen3-max，也支持切到 Node 服务（REFLECT_AI_PROVIDER=node + NODE_AI_SERVICE_URL，可选 NODE_AI_SERVICE_TOKEN）。",
          "「测试 AI 连接」：dashScopePingStart 仅建任务；请在小程序内接着调 emotionReflectWorker（slow）完成检测，再轮询 dashScopePingStatus。",
          "若已在 miniprogram/database 下放权限 JSON，请在开发者工具中上传数据库权限配置（含 emotion_kit_users、emotion_kit_reflect_jobs）。",
        ],
      };
    }

    /** 读取当前用户的云端资料（称呼、给 AI 的背景等） */
    case "getUserProfile": {
      const { openid } = await getOpenId();
      if (!openid) return { success: false, errMsg: "未登录" };
      await ensureUserProfileCollection();
      const res = await db.collection(USER_PROFILE_COLLECTION).where({ openid }).limit(1).get();
      const row = res.data && res.data[0];
      if (!row) {
        return {
          success: true,
          data: { nickName: "", aiPremise: "", updatedAt: null, createdAt: null },
        };
      }
      return {
        success: true,
        data: {
          nickName: row.nickName != null ? String(row.nickName) : "",
          aiPremise: row.aiPremise != null ? String(row.aiPremise) : "",
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
        },
      };
    }

    /** 合并写入用户资料（仅传需要更新的字段） */
    case "upsertUserProfile": {
      const { openid, appid, unionid } = await getOpenId();
      if (!openid) return { success: false, errMsg: "未登录" };
      const patch = event.data || {};
      await ensureUserProfileCollection();
      const col = db.collection(USER_PROFILE_COLLECTION);
      const existed = await col.where({ openid }).limit(1).get();
      const prev = existed.data && existed.data[0];
      const now = new Date();
      const doc = {
        openid,
        appid: appid || (prev && prev.appid) || "",
        unionid: unionid !== undefined ? unionid || "" : (prev && prev.unionid) || "",
        nickName: prev && prev.nickName != null ? String(prev.nickName) : "",
        aiPremise: prev && prev.aiPremise != null ? String(prev.aiPremise) : "",
        updatedAt: now,
      };
      if (patch.nickName !== undefined) {
        doc.nickName = String(patch.nickName || "").trim().slice(0, 64);
      }
      if (patch.aiPremise !== undefined) {
        doc.aiPremise = String(patch.aiPremise || "").trim().slice(0, 2000);
      }
      if (!prev) {
        doc.createdAt = now;
        await col.add({ data: doc });
      } else {
        await col.doc(prev._id).update({ data: doc });
      }
      return { success: true };
    }

    /** 已废弃：云函数互调 emotionReflectWorker 会触发约 3s 同步子调用限制。请用 reflectJobStart + reflectJobDispatch + 轮询 reflectJobStatus（见小程序 cloudAi）。 */
    case "emotionReflect": {
      return {
        success: false,
        errMsg:
          "emotionReflect 已停用。请使用 reflectJobStart + reflectJobRun（小程序端见 cloudAi.runReflectJobViaClient）。",
        deprecated: true,
      };
    }

    /**
     * 仅创建解读任务文档并返回 jobId。
     * 云函数 A await 调用云函数 B 时，平台对同步子调用有约 3s 硬限制（与 timeout 参数无关），
     * 故不在此处调用 emotionReflectWorker；由小程序端再调 worker（reflectJobId + slow）执行。
     */
    case "reflectJobStart": {
      const { kind, payload } = event.data || {};
      const { openid } = await getOpenId();
      if (!openid) return { success: false, errMsg: "未登录" };
      if (kind !== "dryRun" && kind !== "emotion") {
        return { success: false, errMsg: "无效 kind" };
      }
      if (!payload || typeof payload !== "object") {
        return { success: false, errMsg: "缺少 payload" };
      }
      await ensureReflectJobsCollection();
      const now = new Date();
      const addRes = await db.collection(REFLECT_JOBS_COLLECTION).add({
        data: {
          openid,
          kind,
          status: "pending",
          payload,
          createdAt: now,
          updatedAt: now,
        },
      });
      const jobId = addRes._id;
      return { success: true, async: true, jobId };
    }

    /**
     * 解读派发：与 reflectJobRun 相同在 pending 时 await processReflectJob；另处理已 done / processing / failed 短路径。
     * 小程序端约 3s 仍可能 -504003，此时依赖轮询 reflectJobStatus（云端任务会继续跑完）。
     */
    case "reflectJobDispatch": {
      const { jobId } = event.data || {};
      const { openid } = await getOpenId();
      if (!openid) return { ok: false, err: "未登录" };
      if (!jobId) return { ok: false, err: "missing jobId" };
      await ensureReflectJobsCollection();
      let row;
      try {
        row = (await db.collection(REFLECT_JOBS_COLLECTION).doc(jobId).get()).data;
      } catch (e) {
        return { ok: false, err: "job not found" };
      }
      if (!row || row.openid !== openid) {
        return { ok: false, err: "forbidden" };
      }
      if (row.status === "failed") {
        return { ok: false, err: row.error || "failed" };
      }
      if (row.status === "done") {
        const r = row.result || {};
        if (r.whatIsWrong != null || r.whatToDo != null) {
          return {
            ok: true,
            skipped: true,
            data: {
              whatIsWrong: r.whatIsWrong != null ? String(r.whatIsWrong) : "",
              whatToDo: r.whatToDo != null ? String(r.whatToDo) : "",
            },
          };
        }
      }
      if (row.status === "processing") {
        return { ok: true, skipped: true, processing: true };
      }
      if (row.status === "pending") {
        console.log(
          "[emotionReflect]",
          JSON.stringify({
            t: new Date().toISOString(),
            phase: "reflectJobDispatch_await_run",
            jobId,
            kind: row.kind,
          })
        );
        const { processReflectJob } = require("./reflectJobExecute");
        return await processReflectJob(jobId);
      }
      return { ok: false, err: "bad job status" };
    }

    /**
     * 在同一次云函数进程内执行 reflect 任务（百炼），避免「云函数 await/同步 调另一云函数」约 3s 硬限制。
     * 小程序：reflectJobStart 后对本 type 使用 wx.cloud.callFunction(..., slow: true, timeout 与 cloudAi.CLOUD_CALL_FUNCTION_MAX_MS 一致，建议 ≥120s)。
     */
    case "reflectJobRun": {
      const { jobId } = event.data || {};
      const { openid } = await getOpenId();
      if (!openid) return { ok: false, err: "未登录" };
      if (!jobId) return { ok: false, err: "missing jobId" };
      await ensureReflectJobsCollection();
      let row;
      try {
        row = (await db.collection(REFLECT_JOBS_COLLECTION).doc(jobId).get()).data;
      } catch (e) {
        return { ok: false, err: "job not found" };
      }
      if (!row || row.openid !== openid) {
        return { ok: false, err: "forbidden" };
      }
      console.log(
        "[emotionReflect]",
        JSON.stringify({
          t: new Date().toISOString(),
          phase: "reflectJobRun_enter",
          jobId,
          kind: row.kind,
        })
      );
      const { processReflectJob } = require("./reflectJobExecute");
      return await processReflectJob(jobId);
    }

    case "reflectJobStatus": {
      const { jobId } = event.data || {};
      const { openid } = await getOpenId();
      if (!jobId) return { success: false, errMsg: "缺少 jobId" };
      await ensureReflectJobsCollection();
      let row;
      try {
        const one = await db.collection(REFLECT_JOBS_COLLECTION).doc(jobId).get();
        row = one.data;
      } catch (e) {
        return { success: true, done: false, pending: true };
      }
      if (!row || row.openid !== openid) {
        return { success: false, errMsg: "无效任务" };
      }
      if (row.status === "pending" || row.status === "processing") {
        return { success: true, done: false, pending: true };
      }
      if (row.status === "failed") {
        return {
          success: true,
          done: true,
          failed: true,
          errMsg: row.error || "失败",
        };
      }
      if (row.status === "done" && row.result) {
        return {
          success: true,
          done: true,
          failed: false,
          data: {
            whatIsWrong: row.result.whatIsWrong != null ? String(row.result.whatIsWrong) : "",
            whatToDo: row.result.whatToDo != null ? String(row.result.whatToDo) : "",
          },
        };
      }
      return { success: true, done: false, pending: true };
    }

    case "getEmotionAiStatus": {
      const { id: idRaw } = event.data || {};
      const { openid } = await getOpenId();
      if (idRaw == null || idRaw === "") return { success: false, errMsg: "缺少 id" };
      await ensureEmotionCollection();
      const col = db.collection(EMOTION_COLLECTION);
      const idCandidates = [...new Set([idRaw, String(idRaw)].filter((x) => x !== "" && x != null))];
      let row = null;
      for (const qid of idCandidates) {
        const res = await col.where({ openid, id: qid }).limit(1).get();
        if (res.data && res.data[0]) {
          row = res.data[0];
          break;
        }
      }
      if (!row) return { success: true, done: false, pending: true };
      if (row.aiReflectError) {
        return { success: true, done: true, failed: true, errMsg: String(row.aiReflectError) };
      }
      const w = row.aiResult && row.aiResult.whatIsWrong;
      const t = row.aiResult && row.aiResult.whatToDo;
      const hasContent = String(w || "").trim() || String(t || "").trim();
      if (row.aiResult && hasContent) {
        return {
          success: true,
          done: true,
          failed: false,
          data: {
            whatIsWrong: w != null ? String(w) : "",
            whatToDo: t != null ? String(t) : "",
          },
        };
      }
      return { success: true, done: false, pending: true };
    }

    case "upsertEmotionRecord": {
      const { id, date, record } = event.data || {};
      const { openid } = await getOpenId();
      if (!id || !date || !record) return { success: false, errMsg: "缺少 id、date 或 record" };
      await ensureEmotionCollection();
      const col = db.collection(EMOTION_COLLECTION);
      const existed = await col.where({ openid, id }).get();
      const doc = {
        openid,
        id,
        date,
        mood: record.mood,
        moodLabel: record.moodLabel,
        tags: record.tags,
        note: record.note,
        emotions: record.emotions,
        question3: record.question3,
        savedAt: record.savedAt,
        updatedAt: new Date(),
      };
      // 未带 aiResult 时不要写入该字段，否则会覆盖/清空 worker 已写入的解读
      if (record.aiResult != null && typeof record.aiResult === "object") {
        doc.aiResult = record.aiResult;
      }
      if (existed.data && existed.data.length) {
        await col.where({ openid, id }).update({ data: doc });
      } else {
        await col.add({ data: doc });
      }
      return { success: true };
    }

    /**
     * 小程序同步 callFunction 约 3s 网关限制：百炼请求放到 emotionReflectWorker（slow）。
     * 客户端：dashScopePingStart → 轮询 dashScopePingStatus。
     */
    case "dashScopePingStart": {
      const { openid } = await getOpenId();
      if (!openid) return { success: false, errMsg: "未登录（需真机/模拟器云开发登录态）" };
      await ensureDashPingCollection();
      const addRes = await db.collection(DASH_PING_COLLECTION).add({
        data: {
          openid,
          status: "pending",
          createdAt: new Date(),
        },
      });
      const pingId = addRes._id;
      /** 百炼请求须由小程序端直接调用 emotionReflectWorker（带 slow），云函数间调用易丢失 OPENID 导致任务失败 */
      return { success: true, async: true, pingId };
    }

    case "dashScopePingStatus": {
      const { pingId } = event.data || {};
      const { openid } = await getOpenId();
      if (!pingId) return { success: false, errMsg: "缺少 pingId" };
      await ensureDashPingCollection();
      let row;
      try {
        const one = await db.collection(DASH_PING_COLLECTION).doc(pingId).get();
        row = one.data;
      } catch (e) {
        return { success: true, done: false, pending: true };
      }
      if (!row || row.openid !== openid) {
        return { success: false, errMsg: "无效任务" };
      }
      if (row.status === "pending") {
        return { success: true, done: false, pending: true };
      }
      if (row.status === "failed") {
        return {
          success: true,
          done: true,
          failed: true,
          errMsg: row.errMsg || "失败",
          ms: row.ms,
        };
      }
      if (row.status === "done") {
        return {
          success: true,
          done: true,
          failed: false,
          reply: row.reply || "",
          ms: row.ms,
          model: row.model || "qwen3-max",
        };
      }
      return { success: true, done: false, pending: true };
    }

    case "listEmotionRecords": {
      const { openid } = await getOpenId();
      await ensureEmotionCollection();
      const res = await db.collection(EMOTION_COLLECTION).where({ openid }).get();
      const rows = res.data || [];
      rows.sort((a, b) => savedAtToNumber(b.savedAt) - savedAtToNumber(a.savedAt));
      const list = rows.map((item) => {
        const { id, date, mood, moodLabel, tags, note, emotions, question3, savedAt, aiResult } = item;
        return { id, date, mood, moodLabel, tags, note, emotions, question3, savedAt, aiResult };
      });
      return { success: true, data: list };
    }

    case "deleteAllEmotionRecords": {
      const { openid } = await getOpenId();
      try {
        await db.collection(EMOTION_COLLECTION).where({ openid }).remove();
      } catch (e) {
        console.error("deleteAllEmotionRecords error", e);
        return { success: false, errMsg: e.message || "删除失败" };
      }
      return { success: true };
    }

    default:
      return { success: false, errMsg: `未知 type: ${event.type}` };
  }
};
