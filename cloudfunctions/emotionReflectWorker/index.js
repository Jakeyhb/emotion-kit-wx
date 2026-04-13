/**
 * 长耗时任务：情绪解读 + 百炼连通性检测。
 * 解读核心与 quickstartFunctions 共用同级 emotionReflectShared.js（须与另一函数目录内文件保持同步）。
 */
const cloud = require("wx-server-sdk");
const {
  processReflectJob,
  runReflectInterpretationCore,
  callDashScopePingOnce,
  LEGACY_PROJECT_EMOTION_MODEL,
} = require("./emotionReflectShared");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const EMOTION_COLLECTION = "emotion_kit_records";
const DASH_PING_COLLECTION = "dash_ping";

async function runDashScopePingJob(pingId, openid) {
  const col = db.collection(DASH_PING_COLLECTION);
  let row;
  try {
    const one = await col.doc(pingId).get();
    row = one.data;
  } catch (e) {
    console.error("dash ping doc missing", pingId, e);
    return { ok: false, err: "ping doc missing" };
  }
  if (!row || row.openid !== openid) {
    return { ok: false, err: "forbidden" };
  }
  const t0 = Date.now();
  try {
    const text = await callDashScopePingOnce({ openid });
    const msElapsed = Date.now() - t0;
    await col.doc(pingId).update({
      data: {
        status: "done",
        reply: text.slice(0, 200),
        ms: msElapsed,
        model: LEGACY_PROJECT_EMOTION_MODEL,
        updatedAt: new Date(),
      },
    });
    return {
      ok: true,
      ping: {
        reply: text.slice(0, 200),
        ms: msElapsed,
        model: LEGACY_PROJECT_EMOTION_MODEL,
      },
    };
  } catch (e) {
    console.error("dashScopePing worker", e);
    const msg = e.message || "AI 暂时不可用";
    try {
      await col.doc(pingId).update({
        data: {
          status: "failed",
          errMsg: msg,
          ms: Date.now() - t0,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      console.error("dashScopePing persist err", err);
    }
    return { ok: false, err: msg };
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (event && event.dashScopePingId) {
    return await runDashScopePingJob(event.dashScopePingId, openid);
  }

  if (event && event.reflectJobId) {
    console.log(
      "[emotionReflect]",
      JSON.stringify({
        t: new Date().toISOString(),
        phase: "worker_reflectJobId_enter",
        jobId: event.reflectJobId,
      })
    );
    return await processReflectJob(db, event.reflectJobId, { forceRun: !!event.forceRun });
  }

  if (event && event.dryRun === true) {
    if (!openid) {
      return { ok: false, err: "no openid" };
    }
    console.log(
      "[emotionReflect]",
      JSON.stringify({ t: new Date().toISOString(), phase: "worker_dryRun_enter" })
    );
    try {
      const emotions =
        Array.isArray(event.emotions) && event.emotions.length > 0
          ? event.emotions
          : [{ name: "焦虑", degree: 3 }];
      const question3 =
        event.question3 != null && String(event.question3).trim()
          ? String(event.question3).trim()
          : "（深度自检）任务偏多、连续熬夜，心里发紧。";
      const data = await runReflectInterpretationCore(db, openid, {
        emotions,
        question3,
        premise: event.premise,
        source: "origin",
        recordId: "",
      });
      return { ok: true, dryRun: true, data };
    } catch (e) {
      console.error("emotionReflectWorker dryRun", e);
      return { ok: false, err: e.message || "AI 暂时不可用" };
    }
  }

  const { recordId, emotions, question3, premise } = event || {};
  const recordKey = recordId != null ? String(recordId).trim() : "";
  if (!recordKey) {
    return { ok: false, err: "missing recordId" };
  }
  if (!openid) {
    return { ok: false, err: "no openid" };
  }

  const col = db.collection(EMOTION_COLLECTION);
  const _ = db.command;

  console.log(
    "[emotionReflect]",
    JSON.stringify({
      t: new Date().toISOString(),
      phase: "worker_direct_record_reflect_enter",
      recordKey: recordKey.slice(0, 48),
    })
  );

  try {
    let { whatIsWrong, whatToDo } = await runReflectInterpretationCore(db, openid, {
      emotions,
      question3,
      premise,
      source: "emotion",
      recordId: recordKey,
    });
    const upd = await col.where({ openid, id: recordKey }).update({
      data: {
        aiResult: { whatIsWrong, whatToDo },
        aiReflectError: _.remove(),
        updatedAt: new Date(),
      },
    });
    const updated = (upd && upd.stats && upd.stats.updated) || 0;
    if (updated < 1) {
      const msg =
        "未写入解读：云端没有匹配到本条记录。请先在当前页完成一次同步（记下后已自动上传），或检查云环境是否与小程序一致。";
      console.error("emotionReflectWorker update 0 rows", { openid: !!openid, recordKey });
      return { ok: false, err: msg };
    }
    return { ok: true, data: { whatIsWrong, whatToDo } };
  } catch (e) {
    console.error("emotionReflectWorker", e);
    const msg = e.message || "AI 暂时不可用";
    try {
      await col.where({ openid, id: recordKey }).update({
        data: {
          aiReflectError: msg,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      console.error("emotionReflectWorker persist err", err);
    }
    return { ok: false, err: msg };
  }
};
