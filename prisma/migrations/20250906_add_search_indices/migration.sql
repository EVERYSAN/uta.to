-- 任意：トライグラム拡張
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- タイトル／チャンネル名を大小無視で高速検索
CREATE INDEX IF NOT EXISTS "Video_title_trgm_idx"
  ON "Video" USING GIN (lower("title") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Video_channel_trgm_idx"
  ON "Video" USING GIN (lower("channelTitle") gin_trgm_ops);

-- 範囲絞り用
CREATE INDEX IF NOT EXISTS "Video_publishedAt_idx" ON "Video" ("publishedAt");
