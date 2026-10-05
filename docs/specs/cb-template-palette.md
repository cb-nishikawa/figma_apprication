# cbTemplatePalette（テンプレパレットくん）仕様たたき台

## 概要

Figma で選択した frame / section / group のまとまりを保存し、別のファイルでも一覧から選んで複製する。UI は [`../../_example/cbTextChecker-design.md`](../../_example/cbTextChecker-design.md) のトークン（360px 幅・12px・`#18a0fb`・28px コントロール・角丸 4px / 6px）に合わせる。

## 操作

1. Figma で frame / section / group を選択する（INSTANCE や、複数選択の中の COMPONENT はフレームとして保存）
   - COMPONENT か COMPONENT_SET を **1 つだけ** 選んだときは、コンポーネントのテンプレートとして保存する（後述）
2. プラグインの「＋ 選択中の要素を保存」を押すと、一覧の先頭に追加される
   - 複数選択していたら 1 件のテンプレートにまとめる（名前は「最初のノード名 ほか N 件」）
3. 一覧の行をクリックで選択し、「Figma に複製」かダブルクリックで、今見ている画面の中央に複製する
   - 複製した要素は選択状態になる
4. 行の「⋯」メニューから「名前を変更」「ファイルに書き出す」「削除」ができる。上部の入力欄で名前の絞り込みができる
5. 一覧の見出しの「⋯」（絞り込みの右）→「グループを追加」でグループを作れる。グループにも「⋯」メニューがあり、「名前を変更」「削除」ができる
   - 作った直後のグループは空。絞り込み中でなければ空のまま一覧に出る（入れられる状態にならないとグループを作れないため）。一覧の末尾に追加されるので、見える位置までスクロールする
   - 絞り込み中は、一致するテンプレートが 1 件もないグループを隠す
   - グループ名の左にあるシェブロンを押すと、たためる／開く。状態は保存されるので、次にプラグインを開いても同じ
   - シェブロンを押してもグループは選択されない。押しただけではドラッグも始まらない
   - 絞り込み中は、たたんでいても開いた状態で描く。一致したテンプレートが隠れると検索結果を誰も読めないため。絞り込みを消すと元の状態に戻る
6. 並べ替えは 2 通り。行またはグループをドラッグして前後に動かす／グループ本体にドロップして中に入れる。あるいは行の「⋯」→「← 移動」→ グループを選ぶ（現在いる場所は選べない）
   - ドラッグは 4px 以上動いた時点で始まる。`Escape` で取り消し
   - タッチではドラッグしない（行の「⋯」→「← 移動」を使う）
   - たためたグループにドロップすると、自動で開いて中に入れる。中身が見えないと移動できたかどうか分からないため
7. 一覧の見出しの「読み込む」「すべて書き出す」で、パソコンのファイルとやり取りできる（後述）

## 保存先

- `figma.clientStorage`（ユーザー単位・プラグイン単位。デバイス内に保存され、どのファイルからでも読める）
- 容量の上限はプラグインごとに約 5MB（Figma の固定値で引き上げられない）。フッターに使用量を表示し、上限を超える保存は拒否する
- 容量を節約するため、画像のバイト列は保存しない。ノードツリーは gzip で圧縮し、サムネイルは長辺 120px の JPG にする

| キー | 内容 |
| --- | --- |
| `cbTemplatePalette.index` | `TemplateMeta[]`（新しいものが先頭） |
| `cbTemplatePalette.item.<id>` | `TemplateItem` |
| `cbTemplatePalette.tree` | `ListNode[]`（一覧の並び順とグループ。下記） |
| `cbTemplatePalette.uiHeight` | UI の高さ |

## 一覧の並び順とグループ（[ADR-005](../ai/decisions/ADR-005-template-palette-groups.md)）

- 一覧の並び順とグループは `cbTemplatePalette.tree` に保存する。`cbTemplatePalette.index` は `TemplateMeta[]` のまま（何を保存したかだけ）
- 並び替えの処理は `src/tree.ts` の純関数。Figma API に依存しない

| 型 | 内容 |
| --- | --- |
| `TemplateListEntry` | `{ type: "item", id }`。ルートに置いたテンプレート 1 件 |
| `TemplateGroup` | `{ type: "group", id, name, items, collapsed? }`。`items` は中のテンプレート id（表示順）。`collapsed` は省略または `false` が開、`true` がたためる |
| `ListNode` | `TemplateGroup \| TemplateListEntry` の和集合。`ListNode[]` がルートの一覧 |

- **グループは 1 階層だけ**。グループの中にグループは置かない。ルートにはグループとテンプレートが混在する
- 保存・削除のたびに `tree` を index に照合する（`reconcileTree`）
  - index に無い id を落とし、`tree` が知らない id をルート先頭に足す。同じ id は最初の 1 箇所だけ残す
  - グループ機能より前に保存したテンプレートも、自動でルート先頭に出る
- グループの作成・名前変更・削除・並べ替え・開閉は、`MOVE` / `ADD_GROUP` / `RENAME_GROUP` / `DELETE_GROUP` / `TOGGLE_GROUP` メッセージでプラグインに送り、`TEMPLATES` で一覧とツリーごと受け直す
- **開閉状態（`collapsed`）は `cbTemplatePalette.tree` にだけ保存し、ファイルには書かない**。読み込んだグループは全部開いた状態で出る（書き出しは構成と並び順を持つファイル）
- 一覧の選択はテンプレートとグループのどちらでも保持する。Figma 側で選択を変えたとき（プラグイン自身が複製で選択を変えたときを除く）は両方解除する

## スキーマ（[`../../cbTemplatePalette/src/types.ts`](../../cbTemplatePalette/src/types.ts)）

- `TemplateMeta`: `id`、`name`、`width`、`height`、`createdAt`、`byteSize`（推定）、`nodeCount`、`thumbnail`、`thumbnailVersion`
  - `thumbnail`: 最初のルートの保存データを、今見ている画面の外に一時的に復元して書き出した JPG（長辺 120px の data URL）。書き出したら復元したノードはすぐ削除する。複製結果と同じく画像は単色になる
  - `thumbnailVersion`: この作り方なら `2`。`2` でないテンプレートは、起動時（UI から最初の `LIST` を受けたとき）にサムネイルを作り直す。そのとき version 1 の本体は version 2 に保存し直す（使わない画像データが消え、使用量が減る）
  - ファイルから読み込んだテンプレートも、ファイル内のサムネイルは使わず作り直す
- `TemplateItem`（保存形式）
  - version 2（現行）: `{ version: 2, data: Uint8Array }`。`data` は `{ roots: SerializedNode[], components? }` の JSON を gzip（fflate）したもの（`components` はコンポーネントのテンプレートだけ）
  - version 1（初版で保存したもの。読み込みのみ対応）: `{ version: 1, roots, images: Record<元の画像ハッシュ, Uint8Array> }`
  - `byteSize` は `data.length` とサムネイルの文字数の合計
- `SerializedNode`
  - `type`（復元時の種類）と `sourceType`（元の種類）
  - `transform`: テンプレート左上を原点とした絶対変換行列（回転を含む）。復元時に配置先の座標系へ変換する
  - `width` / `height`
  - `props`: そのまま代入できるプロパティ（塗り・線・エフェクト・角丸・クリップ・グリッド・図形・段落など）。変数の紐付け（`boundVariables`）は取り除く
  - `layout`: オートレイアウトの設定（子を入れたあとに適用）
  - `childLayout`: 親のオートレイアウト内での設定（`layoutPositioning`、`layoutSizing*`、`layoutGrow`、min / max）
  - `text`: `characters` と、区間ごとの書式（フォント・サイズ・塗り・装飾・大文字小文字・行間・字間・リンク）
  - `vectorNetwork`（読めない場合は `vectorPaths`）、`booleanOperation`、`children`
  - コンポーネントのテンプレートだけで使うもの: `componentProps`、`propertyRefs`、`instance`、`overriddenFields`（後述）

## 対応するノード

| 元の種類 | 復元 |
| --- | --- |
| FRAME / COMPONENT / COMPONENT_SET / INSTANCE / SLOT | FRAME（インスタンスは detach 相当）。コンポーネントのテンプレートでは後述 |
| GROUP | 子を作ってから `figma.group` |
| SECTION | `createSection`（page 直下か section の中） |
| RECTANGLE / ELLIPSE / POLYGON / STAR / LINE | 同じ種類 |
| VECTOR | `setVectorNetworkAsync` |
| BOOLEAN_OPERATION | 子を作ってから `figma.union`、`booleanOperation` を設定 |
| TEXT | 区間ごとの書式を復元。読めないフォントは同じファミリーの Regular、なければ Inter Regular |

- 上記以外（スライス、コネクタ、ウィジェット、埋め込みなど）と動画の塗りはスキップし、保存時にスキップ件数を通知する
- スタイル（`fillStyleId` など）と変数は別のファイルで解決できないため、値だけを残す

## 画像の塗り

- 保存するのは画像ハッシュだけ（バイト列は保存しない）
- 複製時は、同じファイルに元の画像があっても、画像の塗りを必ず単色（SOLID `#D9D9D9`、元の `opacity` / `visible` を引き継ぐ）に置き換える。ノードの形・サイズ・角丸・線・エフェクトはそのまま
- 置き換えた塗りの数を「画像 N 件を単色に置き換え」と通知する
- version 1 のテンプレートに保存してある画像データも使わない

## コンポーネントのテンプレート（[ADR-004](../ai/decisions/ADR-004-component-templates.md)）

- 対象: COMPONENT か COMPONENT_SET を 1 つだけ選んで保存したもの。`TemplateMeta.kind = "component"`。一覧の名前の横に「コンポーネント」バッジを出す
- 保存時に元のノードへ `pluginData("cbTemplatePalette.stamp")` を付け（既にあれば使い回す）、`TemplateMeta.source = { nodeId, stamp }` を残す
- 複製すると、元とはつながらない新しいコンポーネント（セット）になり、画面中央に置いて選択する
  - **同じファイル**（`getNodeByIdAsync(nodeId)` が COMPONENT / COMPONENT_SET で、stamp も一致）: 元を `clone()` する。中のインスタンス・スロット・プロパティ・オーバーライドはすべて残る。中身は保存時点ではなく今の元のもの。そのあと画像の塗りを単色に塗り替える（中のインスタンスはオーバーライドとして）
  - **別のファイル、または元が削除されていた**: 保存データから組み立て直す（下記）
- 追加のスキーマ
  - `componentProps`: `description` と `definitions`（プロパティ名（`#id` 付き）→ `type`・`defaultValue`・`variantOptions`・`preferredValues`・`description`・`slotSettings`・INSTANCE_SWAP の `defaultRef`）
  - `propertyRefs`: サブレイヤーの `componentPropertyReferences`（`visible` / `characters` / `mainComponent` / `slotContentId`）
  - `instance`: 元コンポーネントの参照（`key`・`id`・`remote`・バリアントなら `setKey`・`setId`・`variantName`）と、VARIANT / SLOT を除くプロパティの値 `properties`、INSTANCE_SWAP の差し替え先 `swapRefs`
  - `overriddenFields`: インスタンス内の子でオーバーライドされている項目（`instance.overrides` から）
  - 本体の `components`: ライブラリに公開されていない元コンポーネント（バリアントならセット全体）の定義。key → `SerializedNode`。入れ子の分も含む
- 組み立て直し
  - COMPONENT: `createComponent()`。BOOLEAN / TEXT / INSTANCE_SWAP は先に `addComponentProperty` で作り直し、新しい名前に付け替えて子の参照を当てる
  - COMPONENT_SET: 各バリアントを作ってから `combineAsVariants`。セットのプロパティはまとめたあとに作り、バリアント内の参照を当てる
  - SLOT: フレームとして作り、`addComponentProperty(name, "SLOT", "", …)` と `componentPropertyReferences = { slotContentId }` でスロットにする
  - INSTANCE: 元コンポーネントを次の順に探す
    1. ライブラリ（`remote`）: `importComponentByKeyAsync` / `importComponentSetByKeyAsync`
    2. このファイル: `getNodeByIdAsync(id)` で取り、`key` が一致すること
    3. 前に作ったもの: 今のページで `pluginData("cbTemplatePalette.sourceKey") === key`
    4. 埋め込んだ定義から新しく作る（複製したものの右に作るセクション「テンプレパレット: 部品」に並べ、`sourceKey` を付ける）
    5. それでも無ければ、そのインスタンスはフレームとして作る
  - インスタンスを作ったら、プロパティの値（作り直した元なら新しい名前で）、自身と子のオーバーライド（並び順で対応。塗り・線・エフェクト・不透明度・表示・名前・角丸・テキスト・サイズ）、中のインスタンスの差し替え（`swapComponent`）を当てる。中のスロットは中身を作り直す
- サムネイルは `mode: "flatten"`（コンポーネント系もフレームとして作る）で書き出す
- 通知: 「新しいコンポーネントとして複製」「部品コンポーネント N 件を作成」「インスタンス N 件をフレームに置き換え」「コンポーネントのプロパティ N 件を再現できず」

## ファイルへの書き出しと読み込み

- プラグインの画面では `localStorage`・IndexedDB・フォルダへの直接アクセスが使えないため、ダウンロード（`Blob` と `<a download>`）とファイル選択で受け渡す
- ファイル名
  - 1 件: `<名前>.cbtemplate.json`
  - すべて: `cbTemplatePalette-YYYYMMDD-HHmm.cbtemplate.json`
- 形式（人が読める素の JSON。画像のバイト列は含めない）

```json
{
  "format": "cbTemplatePalette",
  "version": 3,
  "tree": [{ "type": "item", "id": "…" }, { "type": "group", "id": "…", "name": "ヘッダー", "items": ["…"] }],
  "templates": [{ "meta": { "…": "TemplateMeta" }, "roots": [], "components": {} }]
}
```

- version 3 で `tree` を書き出す。`tree` の id は `templates[].meta.id` を指す
- 1 件だけ書き出すときは `tree` を平坦にする（グループを作らない）
- version 2 のファイルには `tree` が無い。読み込んだテンプレートはすべてルートに置かれる
- `components` はコンポーネントのテンプレートだけ。`meta` の `kind` と `source` もそのまま書き出し・読み込みする
- 読み込み時、テンプレートの id とグループの id はどちらも振り直す。`tree` が所述の id を網羅していない分はルート末尾に足す

- 読み込み
  - 複数ファイルを選べる。`format` と `templates` が正しくないファイルは「テンプレートのファイルではありません: ファイル名」と出す
  - テンプレートごとに新しい `id` を振って一覧の先頭に追加する（同じファイルを 2 回読み込むと別のテンプレートになる）。並び順とグループはファイルの `tree` に従い、全体として先頭に寄せる
  - 5MB を超える分は保存せず「容量の上限のため N 件は読み込めませんでした」と出す

## 関連

- 判断の記録: [`../ai/decisions/ADR-003-template-palette-serialization.md`](../ai/decisions/ADR-003-template-palette-serialization.md)、[`../ai/decisions/ADR-004-component-templates.md`](../ai/decisions/ADR-004-component-templates.md)、[`../ai/decisions/ADR-005-template-palette-groups.md`](../ai/decisions/ADR-005-template-palette-groups.md)
