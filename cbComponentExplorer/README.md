# Component Explorer

Figma 上で選んだターゲット（Section / Frame / Instance / Group）内の Component / Instance 使用状況を確認するプラグインです。

## 機能

- 検索対象はターゲットだけ（cbTextChecker の検索と同じ選び方）
  - ターゲットのボタンを押すと、キャンバスで選択中の要素（無ければ近い親）をターゲットにする
  - 何も選択していないときは「最近選択したフレーム」（最大 20 件）を出し、「候補一覧から選ぶ…」で名前から選べる
  - 選択済みのボタンにホバーすると、ターゲットを緑の破線枠で示す
  - キャンバスの選択を変えても再検索しない。ターゲットを決めたときとページを変えたときに検索し直す
- 下端のハンドルをドラッグして高さを変えられる（次回も同じ高さ）
- ターゲット内のメインコンポーネントは、インスタンスが無くても一覧に出す
- レイヤー順はレイヤーパネルの上から下の順で、実際のレイヤー構造どおりに並ぶ（インスタンス・メインコンポーネントの中の Frame は見出しにしない）
  - 同じ親の直下で同じコンポーネントのインスタンスは 1 行にまとめ、件数・選択・Instance 一覧はその場所の分だけ扱う
  - メインコンポーネント（「定義」バッジ）とインスタンスの行も、中にインスタンスがあればアコーディオンで開ける
- Main Component 一覧・Instance 数・一括 select
- レイヤー順の Section / Frame はアコーディオン（最初は閉じていて、開くと中の Section / Frame と Component が並ぶ）。名前でジャンプ・ホバーで緑の破線枠
- バリアントはコンポーネントセットごとにアコーディオンでまとめる（最初は閉じていて、開くと中のバリアントが並ぶ）
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
- `src/scan.ts` — ターゲットの走査（レイヤーツリーと Main Component ごとの集計）
- `src/ui/layerItems.ts` — レイヤーツリーから表示用の項目の木を作る
- `src/ui/` — プラグイン UI
- `dist/` — ビルド成果物（`code.js` / `ui.html`）
