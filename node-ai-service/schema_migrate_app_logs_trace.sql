-- 已有库升级：为 app_logs 增加 openid / source / record_id（与小程序情绪记录、来源关联）
-- 执行一次即可；若列或索引已存在会报错，请按实际库结构调整或跳过已执行部分。

ALTER TABLE app_logs
  ADD COLUMN openid VARCHAR(64) NOT NULL DEFAULT '' AFTER id,
  ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT '' AFTER openid,
  ADD COLUMN record_id VARCHAR(128) NOT NULL DEFAULT '' AFTER source,
  ADD KEY idx_openid (openid),
  ADD KEY idx_source (source);
