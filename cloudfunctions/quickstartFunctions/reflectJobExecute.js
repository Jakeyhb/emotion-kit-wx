/**
 * 解读任务执行入口：逻辑在同级 emotionReflectShared.js（随云函数包上传）。
 * 由 quickstartFunctions.reflectJobRun 在同进程 require，避免云函数互调约 3s 限制。
 */
const cloud = require("wx-server-sdk");
const { processReflectJob } = require("./emotionReflectShared");

module.exports = {
  /** 在 quickstartFunctions 已 cloud.init 之后调用 */
  processReflectJob: (jobId) => processReflectJob(cloud.database(), jobId),
};
