# cbImageExport（画像一括書き出しくん）仕様たたき台

## 概要

選択したフレーム内の可視画像を一覧し、PNG / JPG / SVG / PDF で個別・一括書き出しする。

## 一覧ルール

- 表示されているノードのみ（`visible === false` の枝は除外）
- マスク付き: マスクを含む親を 1 件。マスク元・内側画像は出さない
- `clipsContent` の FRAME 内画像: その FRAME を 1 件。内側画像は出さない

## UI

- 検索（名前フィルタ）
- 一括形式セレクト + チェック書き出し
- 行: チェック / サムネ / 名前 / 形式 / 個別書き出し

## 関連

- 書き出し単位の解決: [`../ai/decisions/ADR-001-image-export-target-resolution.md`](../ai/decisions/ADR-001-image-export-target-resolution.md)
