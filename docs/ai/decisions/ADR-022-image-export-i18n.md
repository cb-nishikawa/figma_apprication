# ADR-022: 画像一括書き出しくんの英語対応（i18n）と英語名

- 日付: 2026-11-02
- 対象: `cbImageExport/`

## 背景

アプリメニューの Language（日本語 / English）は UI の枠だけあり、English は準備中だった。英語名「Mr. Bulk Image Exporter」を追加し、英語で使えるようにしたい。

## 決定

- **辞書は `src/i18n.ts` に 1 つだけ置く**。`ja` を正として `MessageKey = keyof typeof ja`、`en` も同じキーを持つ（型で欠けを検出）。`t(key, params)` は `{name}` の置換のみで、外部ライブラリは使わない
- **code（main）と UI の両方が同じ辞書を import** する。プラグイン側から UI へ送るエラーや状態メッセージも `t()` で翻訳してから送る
- **静的 HTML** は `data-i18n` / `data-i18n-title` / `data-i18n-aria-label` / `data-i18n-placeholder` にキーを書き、`applyStaticI18n()` でまとめて差し替える。JS で 1 回だけ作るメニューの要素も `setI18n()` で同じ属性を付ける
- **言語の保存**: `figma.clientStorage` の `cbImageExport.locale`（ユーザー単位・既定 `ja`）。ファイル（プラグインデータ）には保存しない
- **切替の流れ**: UI がその場で再描画し、`SET_LOCALE` を送る。プラグインは保存した後、`LOCALE` を返し、フレーム候補と画像一覧を再送する（プラグイン側の文言も新しい言語にするため）
- **名前**: manifest の `name` は 1 つの文字列なので「画像一括書き出しくん / Mr. Bulk Image Exporter」と併記する。プラグイン内（ウィンドウタイトル・`<title>`）は言語に合わせて切り替える

## 制約・トレードオフ

- `figma.showUI` の `title` は起動時にしか設定できない。そのため、ウィンドウタイトルが変わるのは次回起動時から
- Figma のメニューに出るプラグイン名（manifest）は言語で切り替えられないので、両方の名前を併記する
- 「日本語」「English」「Language」は、どちらの言語でも同じ表記のままにする
