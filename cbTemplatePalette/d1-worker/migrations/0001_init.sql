-- 1 つのファイル（metadata.json・index.json・items/<id>.json など）を (space, path) の行で持つ。
-- D1 の 1 行は約 2MB までなので、本文は 1MB ごとの chunk に分ける（0 から順に）。
CREATE TABLE IF NOT EXISTS objects (
  space TEXT NOT NULL,
  path TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space, path, chunk)
);
