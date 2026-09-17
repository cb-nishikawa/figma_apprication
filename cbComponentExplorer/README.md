# Component Explorer

Figma上で選択範囲（または現在のページ）内の Component / Instance 使用状況を確認するプラグインです。

## 機能

- デフォルトは **選択** モード。Selection 変更時に自動再検索
- **ページ** モードはユーザーが切り替えたときだけ現在ページ全体を検索
- Main Component 一覧・Instance 数・一括 select
- Instance 一覧（名前 / ページ名 / 親 Section）
- Main Component / Instance へのジャンプ

## 開発

```bash
npm install
npm run build
# または
npm run watch
```

Figma デスクトップアプリで:

1. Plugins → Development → Import plugin from manifest…
2. このリポジトリの `manifest.json` を選択

## 構成

- `src/code.ts` — メインスレッド（走査・選択・viewport）
- `src/scan.ts` — Instance 収集と Main Component へのグループ化
- `src/ui/` — プラグイン UI
- `dist/` — ビルド成果物（`code.js` / `ui.html`）
