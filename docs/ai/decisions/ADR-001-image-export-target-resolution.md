# ADR-001: 画像書き出し単位の解決（マスク／クリップ）

- ステータス: 採用
- 日付: 2026-09-24

## コンテキスト

フレーム内の IMAGE fill ノードをそのまま一覧すると、マスクや `clipsContent` 付き FRAME の「見た目」と一致しない。ユーザーはマスク範囲・フレーム範囲を1件として書き出したい。

## 決定

`cbImageExport` の収集では、IMAGE fill を持つ可視ノードごとに書き出し対象を次のように解決する。

1. 祖先に `isMask` 子を持つ GROUP / FRAME / COMPONENT / INSTANCE があれば、その親を書き出し単位とする（kind: `mask`）
2. それ以外で、祖先に `clipsContent` な FRAME / COMPONENT / INSTANCE があれば、直近のそれを単位とする（kind: `clip`）
3. どちらもなければ、画像ノード自身（kind: `image`）

同一 `nodeId` は重複排除する。`visible === false` の枝は走査しない。

## 結果

- 一覧・サムネ・`exportAsync` は解決後のノードに対して行う
- マスク元やクリップ内側の生画像は一覧に出ない

## 関連

- 仕様たたき台: [`../../specs/cb-image-export.md`](../../specs/cb-image-export.md)
- 実装: `cbImageExport/src/collectImages.ts`
