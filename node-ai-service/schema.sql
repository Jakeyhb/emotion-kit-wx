-- emotion-kit-node-ai-service 应用日志表（MySQL 8+）
-- 使用前请创建数据库并授权，例如：
-- CREATE DATABASE emotion_kit_ai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  phase VARCHAR(128) NOT NULL DEFAULT '',
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  meta_json JSON NULL,
  PRIMARY KEY (id),
  KEY idx_created_at (created_at),
  KEY idx_phase (phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
