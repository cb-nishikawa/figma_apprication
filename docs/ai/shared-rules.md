# 共有ルール（補足）

本書は [`AGENTS.md`](../../AGENTS.md) の補足である。矛盾がある場合は **AGENTS.md を優先**する。

## コードスタイル

- TypeScript: 既存プラグイン（特に `cbTextChecker`）の型・メッセージ分割・命名に合わせる
- UI: `ui.html` / `ui.css` / `ui.ts`。汎用ダッシュボード化や過剰なカード UI を避ける
- Figma API: `exportAsync`・selection・`findAll` 等は既存の `code.ts` パターンを踏襲する

## ドキュメント

- 作業ログはリポジトリ直下 [`changelog/`](../../changelog/)（`docs/ai/changelog/` ではない）
- 仕様のたたき台は [`docs/specs/`](../specs/)
- 「なぜそうしたか」は [`docs/ai/decisions/`](decisions/) の ADR に残す

## テスト・確認

- 大きな変更後は、対象プラグインを Figma Desktop の Development から再読み込みし、主要操作を目視確認する旨を changelog に書いてよい
