# ADR-021: cbSitemapMaker 生成サイトマップの再編集

- Date: 2026-10-26
- Status: Accepted

## Context

生成したサイトマップをキャンバス上で再編集したい。再生成のたびに新しいフレームが増えると整理が難しい。

## Decision

- 生成した一番外の `サイトマップ` フレームに `setPluginData('sitemap', JSON.stringify({ version: 1, roots }))` を保存する。
- 選択ノードまたはその祖先に pluginData があれば読み込み、UI にツリーを反映する。
- `更新` は同じ親・同じ重なり順・同じ位置で作り直して元を削除する。
- `新規に生成` は `figma.viewport.center` を中心に配置する。
- 生成・更新後は作ったフレームを選択し、pluginData を保存する。

## Consequences

- ファイルに保存されるため複製しても追従する。壊れたデータはサイトマップとして扱わない。
- Figma 実機未確認。