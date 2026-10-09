# ADR-011: 共有カテゴリ（Cloudflare R2）を足し、保存先の設定と Google Drive をやめる

- ステータス: 採用（R2 用 Worker のデプロイ後に実機確認が必要）
- 日付: 2026-10-09
- 関連: [ADR-008](ADR-008-template-palette-categories.md)、[ADR-010](ADR-010-template-palette-google-drive.md)（廃止）

## コンテキスト

[ADR-010](ADR-010-template-palette-google-drive.md) で、設定ダイアログから保存先（ローカル / Google Drive）を 1 つ選ぶ形にした。そのあとユーザーは次を求めた。

- Google Drive のほかに Cloudflare R2 でも使えるようにする
- 「今は設定で保存先を決めているが、カテゴリーごとに保存と読み込み先を設定して、他の人とも共有できたらいい」
- いったんカテゴリごとの保存先と R2 を実装したあと、「グローバルの設定を削除」「googleDriveでの設定も削除」

ADR-010 の条件（秘密情報をプラグインに埋め込まない、API の詳しいエラーを出さない、既存のローカル利用に影響を出さない）は引き続き守る。

## 決定

### 保存先の設定ダイアログと Google Drive をやめる（ユーザーの選択）

- 「⋯」→「設定」（標準の保存先の切り替え、Supabase の仮画面を含む）を削除した。**「未設定」と通常のカテゴリは常にローカル**（`figma.clientStorage`）
- Google Drive 対応（OAuth 用 Worker、`drive.file`、Picker、`googleAuth.ts` / `googleDrive.ts` / `storageSettings.ts`）を丸ごと削除した。外部の保存先は共有カテゴリの R2 だけ
- Drive 対応はまだ公開していなかったので、データの移行は用意しない。clientStorage に残っている `cbTemplatePalette.storageSettings` / `googleSession` は読まなくなるだけで、消しはしない

### R2 は「自分で立てる Worker」経由（ユーザーの選択）

- R2 のアクセスキーはプラグインに置かない。各自（またはチーム）が [`cbTemplatePalette/r2-worker/`](../../../cbTemplatePalette/r2-worker/) をデプロイし、プラグインには **Worker の URL・アクセストークン・スペース名** だけを入れる
- Worker の API
  - すべて `Authorization: Bearer <ACCESS_TOKEN>`。`ACCESS_TOKEN` は Worker の secret（カンマ区切りで複数可）。SHA-256 にしてから `timingSafeEqual` で比べる
  - `GET /v1/ping` → `{ ok: true, app: "cbTemplatePalette-r2" }`
  - `GET` / `PUT` / `DELETE /v1/spaces/<space>/objects/<path>`
  - スペース名は `^[A-Za-z0-9._-]{1,64}$`、パスは各段 `^[A-Za-z0-9._%-]{1,200}$`・`..` 不可・4 段まで。本文は 25MB まで
- スペースには `metadata.json`・`index.json`・`tree.json`・`categories.json`・`items/<id>.json` を置く。`Uint8Array` は `{"$u8": base64}`（メインスレッドに `btoa` が無いので自前で変換）。変換は `jsonCodec.ts`
- manifest の `networkAccess` は `https://*.workers.dev` だけ。独自ドメインで Worker を公開した場合は manifest への追加が要る

### カテゴリ = 保存先（ユーザーの選択）

- 「共有カテゴリ」は、1 つのカテゴリが 1 つの R2 のスペースにそのまま対応するもの。一覧の「⋯」→「共有カテゴリを追加…」で足す
- **共有は「同じ保存先を複数の人が追加する」ことで行う。** 同じ Worker の URL・トークン・スペース名を各自が入れる
- 登録は `cbTemplatePalette.linkedCategories`（`{ id, name, source }[]`）として clientStorage に置く。R2 として読めない登録は読み飛ばす
- 共有カテゴリの中のテンプレートは、保存先に書かれた `meta.category` に関係なく、一覧ではその共有カテゴリの名前で見せる。名前は **自分の一覧での表示名** で、変えても保存先や他の人には影響しない
- 共有カテゴリの「カテゴリを削除」は「カテゴリを外す」になり、登録を消すだけ。保存先のデータは消さない（ほかの人も使っているため）
- 追加するときに保存先を確かめる（Worker に届くか、`metadata.json` が無ければ作る、別のアプリのものなら断る）。名前を空欄にしたら `metadata.json` の `name` → スペース名の順で決め、`metadata.json` に名前が無ければ書いておく

### 保存先をまたぐ処理

- ストレージに触るメッセージは **1 つずつ順に** 処理する（キュー）。処理の間だけ、そのカテゴリの保存先のアダプターに差し替える。`storage.ts` の呼び出しは変えずに済む
- 一覧は「今見ているカテゴリ」の保存先から読む。UI はカテゴリを切り替えるたびに `VIEW_CATEGORY` を送り、保存先が変わったときだけ読み直す
- 保存は、選んでいるカテゴリの保存先へ
- テンプレート・グループを別の保存先のカテゴリへ移すときは、**移動先に保存してから移動元を消す**。途中で失敗しても元のデータは残る（重複はあり得る）。移動先で id が重なったら振り直す
- 移動メニューに出るグループは、今見ている保存先のものだけ。ほかのカテゴリは見出し（ルート）だけ選べる
- 「カテゴリにして追加」の読み込みはローカルへ入れる。それ以外の読み込み・書き出しは今見ている保存先が対象

### エラー

- 種類（`auth` / `folder` / `network`）だけを UI に渡し、API の本文は出さない。黙ってローカルに戻さない
  - 届かない・認証できない: 「Cloudflare R2 に接続できませんでした。\nWorker の URL とアクセストークンを確認してください。」
  - スペースが不正: 「保存先のスペースにアクセスできません。\nスペース名を確認してください。」
- 頭に「共有カテゴリ「名前」」を付けて、一覧の上に出す（設定画面は無いので「設定を開く」は出さない）

## 結果

- 共有カテゴリを足さない限り、これまでどおりローカルだけで動く。キーも値も変わらない
- R2 を使うには Worker のデプロイが要る。手順は [`cbTemplatePalette/r2-worker/README.md`](../../../cbTemplatePalette/r2-worker/README.md)

## 未確認・既知の制約

- Figma の `networkAccess` で `https://*.workers.dev` のワイルドカードが実際に通るか
- 同じ共有カテゴリを複数の人が同時に書くと、`index.json` などは後から書いた方が残る（ロックは持たない）
- R2 のアクセストークンは clientStorage に平文で置く（端末内・プラグイン内だけで読める）。漏れたら Worker の secret を差し替える
- 共有カテゴリを見ているときに「全て入れ替える」で読み込むと、ほかの人のテンプレートも消える（確認は既存の 2 段階のまま）
