# cbTemplatePalette（テンプレパレットくん）仕様たたき台

## 概要

Figma で選択した frame / section / group や基本シェイプのまとまりを保存し、別のファイルでも一覧から選んで複製する。UI は [`../../_example/cbTextChecker-design.md`](../../_example/cbTextChecker-design.md) のトークン（360px 幅・12px・`#18a0fb`・28px コントロール・角丸 4px / 6px）に合わせる。

## 操作

1. Figma で保存できる要素を選ぶ（frame / section / group / component のほか、矩形・テキスト・ベクターなどの基本シェイプも 1 つだけ、または複数）
   - ルートにできるのは「対応するノード」の表のうち保存できる型。INSTANCE や、複数選択の中の COMPONENT はフレームとして保存
   - COMPONENT か COMPONENT_SET を **1 つだけ** 選んだときは、コンポーネントのテンプレートとして保存する（後述）
   - スライスなど保存できない型が 1 つでも混ざると、保存ボタンを出さない。混ざった件数をヒントに出す
2. プラグインの「＋ 選択中の要素を保存」を押すと、一覧の先頭に追加される
   - 複数選択していたら 1 件のテンプレートにまとめる（名前は「最初のノード名 ほか N 件」）
   - 選択の中に画像があるときだけ「画像を一緒に保存しますか？」を聞き、答えによって中の画像を残すか枠線に変える（後述「画像の塗り」）
3. 一覧の行をクリックで選択し、「Figma に複製」かダブルクリックで、今見ている画面の中央に複製する
   - 複製した要素は選択状態になる
   - 複製は名前以外の部分（サムネイル・情報行・バッジ）をダブルクリックしたとき。名前のテキストをダブルクリックすると複製ではなく、名前変更の入力欄が開く
4. 行の「⋯」メニューから「名前を変更」「ファイルに書き出す」「削除」ができる。名前のテキストをダブルクリックしても同じ入力欄が開く。上部の入力欄で名前の絞り込みができる
   - 「名前を変更」は一覧の名前だけじゃなく、保存データの中の要素名も一緒に書き換える。あとサムネイルも描き直す（描けなかったときは前のまま）。キャンバス上の元要素には触れない
   - ルートが複数のテンプレートは、要素名がそれぞれ違うので名前を変えない（一律に同じ名にすると中身の区別がなくなる）
5. 一覧の表示は「詳細」「一覧」「サムネイル」の 3 つに切り替える。絞り込みアイコンの左のボタンを押すとポップアップで選ぶ（後述）
   - 詳細 = 今の見た目。48px のサムネイルと名前、そして情報行（大きさ / 要素数 / 容量）
   - 一覧 = サムネイル（32px）と名前のみ。1 カラム。行の高さは 44px になり、詳細モード（60px）より詰まる
   - サムネイル = サムネイルと名前のみ。2 カラム。サムネイルを大きくし、画像を上・名前を下に置く
   - ボタンの絵は現在のモード。選択中のモードには印が付く。`Escape` とポップアップの外側クリックで閉じる
   - サムネイルモードは 360px 幅でセルが 162px。保存済みのサムネイル（長辺 120px）を約 1.25 倍に拡大しているので少しぼける
   - 折りり返さない長い名前でも 2 カラムを保つ（列は `minmax(0, 1fr)`。名前とグループ名は省略線）
   - サムネイルモードでも行のドラッグは使う。行の左右の半分で前後を決め、ヒントは左右の縦線
   - グループの見出しは 2 セルを使い切って 1 行。中身も同じモードで 2 カラム
   - モードは一覧の見え方だけを変える。絞り込みの候補も並び替えも変わらない
6. 一覧の見出しの「⋯」（絞り込みの右）→「グループを追加」でグループを作れる。グループにも「⋯」メニューがあり、「名前を変更」「ファイルに書き出す」「削除」ができる
   - グループ名のテキストをダブルクリックしても同じ入力欄が開く
   - 作った直後のグループは空。絞り込み中でなければ空のまま一覧に出る（入れられる状態にならないとグループを作れないため）。一覧の末尾に追加されるので、見える位置までスクロールする
   - 絞り込み中は、一致するテンプレートが 1 件もないグループを隠す
   - グループ名の左にあるシェブロンを押すと、たためる／開く。状態は保存されるので、次にプラグインを開いても同じ
   - シェブロンを押してもグループは選択されない。押しただけではドラッグも始まらない
   - 「削除」は中のテンプレートも一緒に消す。戻せないので「⋯」の中に「「グループ名」と中の N 件を削除します（元に戻せません。残すなら先に「ファイルに書き出す」で保存）」と「キャンセル」「削除」を出す。取り消す方はメニューに戻る
   - メニューを開き直したときは「削除」から入り、確認の画面は毎回リセットされる
   - 「ファイルに書き出す」はそのグループだけを 1 ファイルにする。ファイル名はグループ名で、読み込んでも同じグループとして戻る
   - 中身がないグループは書き出せない（「グループ「〜」には書き出すテンプレートがありません」と出す）
   - 絞り込み中は、たたんでいても開いた状態で描く。一致したテンプレートが隠れると検索結果を誰も読めないため。絞り込みを消すと元の状態に戻る
7. 並べ替えは 2 通り。行またはグループをドラッグして前後に動かす／グループ本体にドロップして中に入れる。あるいは行の「⋯」→「← 移動」→ グループを選ぶ（現在いる場所は選べない）
   - ドラッグは 4px 以上動いた時点で始まる。`Escape` で取り消し
   - 落とし先は、行同士なら上・下の半分（グリッドは左・右）で前後。グループを見出しに載せるとその前後に入れ替え、グループの中の行に載せても親グループの前後として受け付ける。グループは入れ込めない
   - 落とし先のスロット番号は DOM の並びではなく `tree` から引く。絞り込み中は見えている並びと実際の並びが違うため、DOM で数えると 1 つ分ずれて別の位置へ落ちる
   - タッチではドラッグしない（行の「⋯」→「← 移動」を使う）
   - たためたグループにドロップすると、自動で開いて中に入れる。中身が見えないと移動できたかどうか分からないため
8. 一覧の見出しの「読み込む」「すべて書き出す」で、パソコンのファイルとやり取りできる（後述）

## 保存先

- `figma.clientStorage`（ユーザー単位・プラグイン単位。デバイス内に保存され、どのファイルからでも読める）
- 容量の上限はプラグインごとに約 5MB（Figma の固定値で引き上げられない）。上限を超える保存は拒否する
- 使用量はフッターに出し、選択中の件数（`◯件を選択中`）より下の行に置く。`使用量 3.2MB / 5.0MB` の下に高さ 2px の細いバーを添える
  - 80% 以上のときはバーの塗りだけを `#b00020`（`.error` と同じ危険色）に変える。文言は変えない
  - 上限を超えたときは 100.0% に留める（超過したことは別のエラーで知らせる）
  - 処理中（`保存しています…` など）は同じ行がメッセージに置き換わり、バーも一緒に隠す。進捗用の行は別に増やさない
  - 使用量は `TEMPLATES` メッセージの `usedBytes` / `quotaBytes` で受け取る。保存・削除・読み込み・並べ替えのたびに送り返されるので、そのつど反映される
- ノードツリーは gzip で圧縮し、サムネイルは長辺 120px の JPG にする
- 画像のバイト列は「画像を含める」を選んだときだけ、item の中へ JSON と別に持つ（`StoredTemplateV3.images`）。これがあると保存体積とサムネイル作成の時間が増える

| キー | 内容 |
| --- | --- |
| `cbTemplatePalette.index` | `TemplateMeta[]`（新しいものが先頭） |
| `cbTemplatePalette.item.<id>` | `TemplateItem` |
| `cbTemplatePalette.tree` | `ListNode[]`（一覧の並び順とグループ。下記） |
| `cbTemplatePalette.uiHeight` | UI の高さ |
| `cbTemplatePalette.viewMode` | 一覧の表示モード（`detail` / `list` / `grid`。既定は `detail`） |

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

## 一覧の表示モード（[ADR-006](../ai/decisions/ADR-006-template-palette-view-modes.md)）

| 型 | 内容 |
| --- | --- |
| `ViewMode` | `"detail"` / `"list"` / `"grid"` の和集合 |

- 3 つのモードは排他的。`<ul class="template-list">` に `is-list` / `is-grid` を付けるだけで切り替える（入れ子の `<ul>` も同じクラス）
- モードは 1 つのボタン（絞り込みの左）からのポップアップで選ぶ。`SET_VIEW_MODE { mode }` で保存し、`TEMPLATES` に載せて起動時に復元する。未知の値は `detail` に戻す
- **モードは `cbTemplatePalette.viewMode` にだけ保存し、`tree` にもファイルにも書かない**。`tree` は構成と並び順で端末によらないもの、モードは見た目の好みで端末ごとに違うため
- 行の HTML はモードで作り直さない。選択・名前変更・複製・削除・グループの開閉はモードに関係なく動く
- サムネイルモードの「⋯」はセルの右上に置き、セルにカーソルがあるあいだだけ出す
- サムネイルを掴んで行をドラッグするときはブラウザの画像ドラッグを止める（`img.draggable = false` と `dragstart` の `preventDefault`）。止めないと `pointercancel` でポインタのドラッグが途中から効かなくなる

## スキーマ（[`../../cbTemplatePalette/src/types.ts`](../../cbTemplatePalette/src/types.ts)）

- `TemplateMeta`: `id`、`name`、`width`、`height`、`createdAt`、`byteSize`（推定）、`nodeCount`、`thumbnail`、`thumbnailVersion`
  - `thumbnail`: 保存した全ルートのデータを、今見ている画面の外に一時的に復元して書き出した JPG（長辺 120px の data URL）。ルートが複数なら一時グループにまとめて書き出す（section はグループにできないため、その場合は先頭のルートだけ）。書き出したら復元したノードはすぐ削除する。画像は「含める」を選んだときはそのまま、選ばなかったときは枠線（`frame("image")`）になる
  - `thumbnailVersion`: この作り方なら `2`。`2` でないテンプレートは、起動時（UI から最初の `LIST` を受けたとき）にサムネイルを作り直す。画像を含めてファイルにしたテンプレートは、`imageMode` に合わせて再保存する（不要な画像データが消え、使用量が減る）
  - ファイルから読み込んだテンプレートも、ファイル内のサムネイルは使わず作り直す
- `TemplateItem`（保存形式）
  - version 3（現行）: `{ version: 3, data: Uint8Array, images?: Record<画像ハッシュ, Uint8Array> }`。`data` は `{ roots: SerializedNode[], components? }` の JSON を gzip（fflate）したもの（`components` はコンポーネントのテンプレートだけ）。`images` は「画像を含める」を選んだときだけ入り、JSON には混ぜない
  - version 2: `{ version: 2, data: Uint8Array }`。読み込むと `images` は無い（画像は単色／枠線に戻る）
  - version 1（初版で保存したもの）: `{ version: 1, roots, images: Record<元の画像ハッシュ, Uint8Array> }`。残っていた `images` は今回から復元に使う
  - `byteSize` は `data.length` と画像のバイト数の合計、サムネイルの文字数
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

- 上記の型はどれでもルート（選択そのもの）にできる。ただし 上記以外（スライス、コネクタ、ウィジェット、埋め込みなど）はルートにすると保存できないため、保存ボタンを出さずにエラーにする
- 上記以外の型を **子** に持つ場合はスキップし、保存時にスキップ件数を通知する
- 動画の塗りは子を含めてスキップ
- スタイル（`fillStyleId` など）と変数は別のファイルで解決できないため、値だけを残す

## 画像の塗り

- 保存は「保存」のたびに確認する。選択の中に画像（`imageHash` を持つ塗り・線）があるときだけ、ダイアログを出す
  - 文言: 「この選択には画像が N 個あります。画像を一緒に保存しますか？」
  - `画像を含める` / `画像を含めない` / `キャンセル` の 3 つのボタン。Esc とカードの外を押すのは `キャンセル` と同じで、保存自体をやめる
  - 画像が同じハッシュなら 1 件として数える（塗った回数ではなく種類数）
- `含める`: バイト列を `figma.getImageByHash(hash).getBytesAsync()` で取得して保存する
  - 復元時は `figma.createImage(bytes)` を作り、同じハッシュの塗りに貼る
  - 取得できないハッシュ、4096px 超、PNG / JPEG / GIF 以外、読めないバイト列は、保存できた範囲だけ貼り、できなかった分は単色の枠線にする（同じ扱い）
  - component.json には入れず、`StoredTemplateV3.images` として JSON と並べる
  - 容量が足りないときは `含める` を無効にする。残量 −（画像の合計 + サムネイル余力 64KB）が 0 未満なら、`ASK_IMAGES.tooLarge` で「画像を入れると容量が足りません」
  - 取得済みのバイト列はハッシュで 8MB まで保持する。同じ画像を 2 つ選んでも 1 回しか取得しない
- `含めない`: バイト列は取らない。次のプレースホルダに置き換える
  - 中身が無い図形（図形・グループ）は `FRAME(name="image")` を作り、塗りを `0` の単色線（`#C4C4C4`）だけにし、`text("image")`（`#D9D9D9`、中央、サイズ 12）を中央に置く
  - 中身があるノード（子を持つ、または TEXT）は `FRAME(name="image")` の中に元のノードを置き、**枠線だけ**を足す
    - 元のノードの型・子・文字・サイズ・角丸・自動レイアウトはそのまま
    - 元のノードが持っていた画像塗りは外す（`fills` から `type: "IMAGE"` を除く）
    - 枠線の中で元のノードの位置は (0, 0)（元の絶対位置から枠線の左上を引いた値）
  - 形の一部である「線」「ベクター領域」「文字の途中」の画像は、枠線にせず単色 `SOLID #D9D9D9` に置き換える（元の `opacity` / `visible` を引き継ぐ）
  - 置き換えた画像の数を「画像 N 個を枠線に置き換え」と通知する
  - この置き換えは保存時に行う。`roots` と `components` の両方にあてはめる（コンポーネントの定義の中身も含めてプレースホルダにする）
- コンポーネントのテンプレートでは、どちらを選んだかを `TemplateMeta.imageMode`（`"keep"` / `"placeholder"`）に残す
  - 同じファイルの元から複製するとき、`keep` は `clone()` したものをそのまま、`placeholder` は複製後に枠線へ置き換える
  - 別のファイルへ書き出して読み込んだ場合も `imageMode` に戻す（読み込んだファイル内の `meta.imageMode` を使う）
- version 1 のテンプレートに残っていた `images` も今回から復元に使う

## コンポーネントのテンプレート（[ADR-004](../ai/decisions/ADR-004-component-templates.md)）

- 対象: COMPONENT か COMPONENT_SET を 1 つだけ選んで保存したもの。`TemplateMeta.kind = "component"`。一覧の名前の横に「コンポーネント」バッジを出す
- 保存時に元のノードへ `pluginData("cbTemplatePalette.stamp")` を付け（既にあれば使い回す）、`TemplateMeta.source = { nodeId, stamp }` を残す
- 複製すると、元とはつながらない新しいコンポーネント（セット）になり、画面中央に置いて選択する
  - **同じファイル**（`getNodeByIdAsync(nodeId)` が COMPONENT / COMPONENT_SET で、stamp も一致）: 元を `clone()` する。中のインスタンス・スロット・プロパティ・オーバーライドはすべて残る。中身は保存時点ではなく今の元のもの。そのあと `meta.imageMode` が `"placeholder"` のときだけ、複製したものを枠線へ置き換える（`"keep"` ならそのまま置く）
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
  - グループ 1 つ: `<グループ名>.cbtemplate.json`
  - すべて: `cbTemplatePalette-YYYYMMDD-HHmm.cbtemplate.json`
- 形式（人が読める素の JSON）

```json
{
  "format": "cbTemplatePalette",
  "version": 4,
  "tree": [{ "type": "item", "id": "…" }, { "type": "group", "id": "…", "name": "ヘッダー", "items": ["…"] }],
  "templates": [
    {
      "meta": { "…": "TemplateMeta" },
      "roots": [],
      "components": {},
      "images": { "3a1b…": "data:image/png;base64,iVBORw0KGgo…" }
    }
  ]
}
```

- version 4 は「画像を含める」で保存したテンプレートにだけ使う。画像が 1 つも無いときは version 3 のまま（version は `tree` と無関係に画像の有無だけで上がる）
- `templates[].images` はハッシュ → `data:<mime>;base64,<bytes>`。`<mime>` は先頭バイトから PNG / JPEG / GIF / WebP / SVG を当てる（読めない場合は PNG）。値は 1 行の JSON に畳んでよい
- version 3 で `tree` を書き出す。`tree` の id は `templates[].meta.id` を指す
- 1 件だけ書き出すときは `tree` を平坦にする（グループを作らない）
- グループだけ書き出すときは `tree` にそのグループ 1 つだけ入れる。読み込んでも同じグループとして戻る
- version 2 のファイルには `tree` が無い。読み込んだテンプレートはすべてルートに置かれる
- `components` はコンポーネントのテンプレートだけ。`meta` の `kind` と `source`、`imageMode` もそのまま書き出し・読み込みする
- 読み込み時、テンプレートの id とグループの id はどちらも振り直す。`tree` が所述の id を網羅していない分はルート末尾に足す

- 読み込み
  - 複数ファイルを選べる。`format` と `templates` が正しくないファイルは「テンプレートのファイルではありません: ファイル名」と出す
  - テンプレートごとに新しい `id` を振って一覧の先頭に追加する（同じファイルを 2 回読み込むと別のテンプレートになる）。並び順とグループはファイルの `tree` に従い、全体として先頭に寄せる
  - 一覧の名前は 1. ファイルの `meta.name` → 2. 保存データの中の要素名 → 3.「テンプレート」の順で決める。「読み込んだ〜」のような言い回しは使わない
  - 5MB を超える分は保存せず「容量の上限のため N 件は読み込めませんでした」と出す

## 関連

- 判断の記録: [`../ai/decisions/ADR-003-template-palette-serialization.md`](../ai/decisions/ADR-003-template-palette-serialization.md)、[`../ai/decisions/ADR-004-component-templates.md`](../ai/decisions/ADR-004-component-templates.md)、[`../ai/decisions/ADR-005-template-palette-groups.md`](../ai/decisions/ADR-005-template-palette-groups.md)、[`../ai/decisions/ADR-006-template-palette-view-modes.md`](../ai/decisions/ADR-006-template-palette-view-modes.md)、[`../ai/decisions/ADR-007-template-palette-images.md`](../ai/decisions/ADR-007-template-palette-images.md)
