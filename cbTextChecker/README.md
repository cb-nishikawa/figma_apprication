# CbTextChecker（Figma Plugin）

Figma ファイル内の TEXT ノードを検索し、指定した複数の文字列の使用箇所を検出するプラグインです。

## 概要

- 複数文字列をリアルタイムにチェック（見出しの `＋` / 行の `−` で増減）
- 部分一致検索
- 行ごとの **br** トグルで改行無視の ON/OFF（ON 時は改行・空白を無視。TEXT の内容自体は変更しません）
- 検索範囲：**選択 / ページ / 固定**（Component Explorer と同じモデル）
- 結果はキーワード単位のアコーディオン。展開すると一致した TEXT を個別に確認できる
- 結果行ホバーでページ直下に一時オーバーレイ（完全一致＝紫 / 部分一致＝緑、TEXT 自体は変更しない）

## 開発環境

- Node.js 18 以上推奨
- npm
- Figma Desktop（Development プラグインの読み込み用）

## セットアップ

```bash
cd figma-text-checker
npm install
```

## ビルド

```bash
npm run build
```

成果物:

- `dist/code.js` … プラグイン本体
- `dist/ui.html` … UI（JS/CSS インライン済み）

型チェック:

```bash
npm run typecheck
```

単体テスト（検索ロジック）:

```bash
npm test
```

開発時のウォッチビルド:

```bash
npm run dev
```

## 共有（Node 不要）

受け手に Node.js / npm がなくても使える配布一式を作れます。

```bash
npm run pack:share
```

成果物:

- `share/CbTextChecker/` … Import 用フォルダ（`manifest.json` / `code.js` / `ui.html` / `README.txt`）
- `share/CbTextChecker.zip` … 上記の zip

zip を渡す側の手順は不要です。受け手は:

1. zip を解凍する
2. Figma Desktop → **Plugins → Development → Import plugin from manifest…**
3. 解凍したフォルダ内の `manifest.json` を選択する
4. **Plugins → Development → CbTextChecker** で起動する

## Figma への読み込み方法（開発時）

1. Figma Desktop を開く
2. メニューから **Plugins → Development → Import plugin from manifest…**
3. このプロジェクトの [`manifest.json`](manifest.json) を選択する
4. **Plugins → Development → CbTextChecker** で起動する

`npm run build` 後に変更を反映するには、プラグインを閉じて再度開いてください。

## 使い方

1. **検索範囲**を選ぶ
   - **選択** … キャンバス上の現在の選択配下の TEXT（選択変更で自動再検索）
   - **ページ** … 現在ページ全体の TEXT
   - **固定** … Section / Frame を1つ指定してその配下を検索
   - **選択 → 固定** に切り替えると、現在の選択（またはその祖先の Section/Frame）が固定先になる
2. **チェックする文字列**を入力する（各欄は 1 行起点・縦リサイズ可）。見出し右の `＋` で項目を増やし、行の `−` で削除する。行のクリアでその欄だけ空に、見出しの「クリア」で全行を空の 1 行に戻す
3. 必要に応じて各行の **br** トグルで改行無視を切り替える（初期は ON）
4. 入力後、約 0.3 秒で自動検索され、結果に件数が表示される
5. 結果の操作
   - **▾ / ▸** でキーワードごとの一致一覧を開閉
   - キーワード名または件数をクリックすると、該当 TEXT へジャンプ
   - 展開した各行をクリックすると、その TEXT へジャンプ
   - 見出し・個別行ホバーで一時ハイライト（完全一致＝紫、部分一致＝緑）

### エラーメッセージ

| 状況 | メッセージ |
|------|------------|
| 選択モードで未選択 | 選択がありません |
| 固定モードで未選択 | 固定先が未選択です |
| 対象 TEXT が無い | 検索対象のテキストがありません。 |

キーワードがすべて空のときは結果をクリアし、エラーは出しません。

## 機能説明

### 改行を無視した検索

各キーワード行の **br** が ON のとき、Figma 上で改行されていてもその行の検索文字列と一致します（初期状態は ON。行ごとに独立）。

例: TEXT が `お問い合わせは\nこちら` でも、検索 `お問い合わせはこちら` で検出します。  
検索用に正規化した文字列と、元 TEXT の文字 index のマッピングを使います。TEXT の内容は変更しません。

OFF のときは原文のまま部分一致し、改行位置も一致条件に含まれます。

### リアルタイム検索

「チェック」ボタンはありません。キーワード入力・検索範囲・各行の br トグルの変更後、300ms の debounce で検索します。選択モードではキャンバス選択の変更でも再検索します。

### ハイライト

一致した TEXT の `absoluteBoundingBox` に合わせて、ページ直下にロック済み RECTANGLE（`__CB_TC_HIGHLIGHT__`）を重ねます。ホバー中のみ表示し、TEXT の塗りや下線は変更しません。色と破線は Component Explorer と同じです。

- **完全一致** … 紫（component）。TEXT 全体がキーワードと一致（その行の br ON 時は改行・空白を除いた全文一致）
- **部分一致** … 緑（instance）。キーワードが TEXT の一部に含まれる場合
- 破線: `dashPattern [10, 10]`、strokeWeight 1、fill opacity 0.4

検索のやり直し・プラグイン終了時にクリアします。

### 結果アコーディオン

キーワードごとに件数を表示し、一致がある項目は展開してノード名・テキストプレビューを個別確認できます。再検索後も、同じキーワード文字列の展開状態は可能な範囲で維持されます。

## Figma 上の確認テスト（手動）

- **選択** Frame A を選択 → A 内のみ検出。選択を変えると結果が更新されること
- **ページ** → ページ全体が対象になること
- **選択 → 固定** Frame A を選んだ状態で固定に切替 → 固定先が A になり、A 内のみ検出
- 固定先を combobox から変更できること
- キーワード入力中に結果が自動更新されること
- 結果展開後、個別行クリックでその TEXT だけが選択されること
- 結果ホバーで、完全一致は紫・部分一致は緑のハイライトが出ること（プラグイン終了後に残らないこと）

## プロジェクト構成

```text
figma-text-checker/
├─ manifest.json
├─ package.json
├─ tsconfig.json / tsconfig.ui.json
├─ vite.config.ts          # UI ビルド
├─ vite.code.config.ts     # main ビルド
├─ src/
│  ├─ code.ts              # プラグイン本体
│  ├─ highlight.ts         # ページ直下ハイライト
│  ├─ pinTargets.ts        # 固定候補の収集
│  ├─ search.ts            # 検索ロジック（純関数）
│  ├─ types.ts / messages.ts
│  ├─ ui.html / ui.ts / ui.css
│  └─ global.d.ts
├─ tests/search.test.ts
└─ README.md
```
