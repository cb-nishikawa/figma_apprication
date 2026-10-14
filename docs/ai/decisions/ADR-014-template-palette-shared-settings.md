# ADR-014: Dropbox を削除し、共有カテゴリを設定でオンにしたときだけ使う

- ステータス: 採用
- 日付: 2026-10-14
- 関連: [ADR-012](ADR-012-template-palette-dropbox.md)（これで廃止）、[ADR-013](ADR-013-template-palette-d1.md)

## コンテキスト

共有カテゴリの保存先は Dropbox（[ADR-012](ADR-012-template-palette-dropbox.md)）と Cloudflare D1（[ADR-013](ADR-013-template-palette-d1.md)）から選べた。ユーザーは次を求めた。

- 「dropboxでの接続方法を削除して」
- 「カテゴリを追加に、設定を追加」
- 設定に「共有カテゴリを使用する」のチェックボックスを置き、「チェックが入っていないと共有カテゴリを一覧に出ないようにする」
- 初期値はオフ。隠す範囲は全部（カテゴリメニュー・移動先・「共有カテゴリを追加…」）（ユーザーの選択）

「切り替え時に既存データを勝手に削除しない」「既存のローカル Storage 利用に影響を出さない」は引き続き守る。

## 決定

### Dropbox を丸ごと削除する

- `src/dropboxAuth.ts`・`dropboxSession.ts`・`dropboxStorage.ts`・`pkce.ts` と、Dropbox のメッセージ・UI（保存先の切り替え・接続・フォルダ選び・「Dropbox の接続を確認」）を削除した
- 保存先は `SourceConfig = D1Source`、`StorageType = "local" | "d1"`。`STORAGE_ERROR` の `provider` も外した
- manifest の `networkAccess.allowedDomains` は `https://*.workers.dev` だけ
- clientStorage に残った Dropbox の登録と `cbTemplatePalette.dropboxSession` は、読まず・消さない。`saveLinkedCategories` は読めない登録をそのまま残して保存する（共有カテゴリを足したり外したりしても消えない）

### 設定「共有カテゴリを使用する」

- 一覧の「⋯」の最後に「設定…」。ダイアログはチェックボックス 1 つと「閉じる」。変えたらすぐ反映する
- 値は clientStorage の `cbTemplatePalette.useSharedCategories`（`src/settings.ts`）。保存されていなければオフ
- オフのときは、`stores.ts` の `linkedCategories()`・`linkedCategoryInfo()`・`linkByName()` が共有カテゴリを返さず、保存先も作らない。これで一覧・カテゴリメニュー・移動先・保存先の振り分けから一度に消える
- 登録そのものは `registeredLinkedCategories()` で持ち続け、名前の重なりの確認と、登録の追加・外す・名前の変更ではこちらを使う（隠れている共有カテゴリと同じ名前の通常カテゴリを作らせない。オンに戻したときにぶつかるため）
- オフにした時点で共有カテゴリを見ていたら「未設定」に戻す。オフのときに届いた `ADD_LINKED_CATEGORY` は断る
- 設定は `TEMPLATES` の `useSharedCategories` で UI に返し、UI は「共有カテゴリを追加…」の表示とチェックボックスを合わせる

## 結果

- 初めて使う人と、共有カテゴリを使わない人は、これまでどおりローカルだけで動く
- すでに D1 の共有カテゴリを足していた人は、設定をオンにするまで共有カテゴリが見えない（登録と D1 のデータは残っている）
- Dropbox の共有カテゴリを足していた人は、その登録が一覧に出なくなる（Dropbox のフォルダのデータには触れない）
