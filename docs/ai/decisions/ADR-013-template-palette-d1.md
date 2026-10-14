# ADR-013: 共有カテゴリの保存先に Cloudflare D1（Worker 経由）を足す

- ステータス: 採用（Worker のデプロイ後に Figma の実機で確認が必要）
- 日付: 2026-10-14
- 関連: [ADR-011](ADR-011-template-palette-shared-categories.md)、[ADR-012](ADR-012-template-palette-dropbox.md)

## コンテキスト

[ADR-012](ADR-012-template-palette-dropbox.md) で共有カテゴリの保存先を Dropbox にした。そのあとユーザーは「Cloudflare WorkersとCloudflare D1を使用してデータを保持する方法も追加して」と求めた。

- Dropbox と並べて選べるようにする（ユーザーの選択）
- 認証は、以前の R2 と同じ「Worker の URL・アクセストークン・スペース名」の形にする（ユーザーの選択）

ADR-010〜012 の条件（秘密情報をプラグインに埋め込まない、API の詳しいエラーを UI に出さない、既存のローカル利用に影響を出さない）は引き続き守る。

## 決定

### Dropbox と並べる

- 「共有カテゴリを追加」ダイアログの上で「Dropbox」か「Cloudflare D1」を選ぶ。保存先は `SourceConfig = DropboxSource | D1Source`
- D1 の保存先は `{ provider: "d1", endpoint, token, space }`。同じ Worker・同じスペース名を入れた人どうしで同じデータになる
- カテゴリメニューの印は「D1」、フッターは「Cloudflare D1 に保存 3.2MB」、読み込み中は「Cloudflare D1 から読み込んでいます…」
- 「未設定」と通常のカテゴリはローカルのまま

### 自分で立てる Worker と共有トークン

- 各自（またはチーム）が [`cbTemplatePalette/d1-worker/`](../../../cbTemplatePalette/d1-worker/) をデプロイする。D1 にはバインディングで触るので、Cloudflare の API トークンやアカウントの情報はプラグインに出てこない
- プラグインが送るのは `Authorization: Bearer <ACCESS_TOKEN>` だけ。`ACCESS_TOKEN` は Worker の secret（カンマ区切りで複数可）で、SHA-256 にしてから `timingSafeEqual` で比べる
- API は削除前の R2 Worker と同じ: `GET /v1/ping`（`app: "cbTemplatePalette-d1"`）、`GET` / `PUT` / `DELETE /v1/spaces/<space>/objects/<path>`。スペース名は `^[A-Za-z0-9._-]{1,64}$`、パスは各段 `^[A-Za-z0-9._%-]{1,200}$`・`..` 不可・4 段まで
- ユーザーごとのトークン管理（D1 にトークンを持つ）は、作業が大きくなるので入れない
- manifest の `allowedDomains` に `https://*.workers.dev` を足した。開発用に `devAllowedDomains: ["http://localhost:8787"]`

### D1 のテーブルと分割

- `objects (space, path, chunk, body, updated_at)`、主キーは `(space, path, chunk)`（[`migrations/0001_init.sql`](../../../cbTemplatePalette/d1-worker/migrations/0001_init.sql)）
- D1 の 1 行は約 2MB までなので、本文は UTF-8 で 1MB ごとに分ける（文字の途中では切らない）。1 件 25MB まで（超えたら 413）なので、1 回の書き込みは最大 26 文で、無料プランの 1 回あたり 50 クエリに収まる
- 書き込みは「古い行を消す → 新しい行を入れる」を 1 回の `batch`（トランザクション）にする。途中で失敗しても古い本文が残る
- スペースの中身は Dropbox と同じ（`metadata.json`・`index.json`・`tree.json`・`categories.json`・`items/<id>.json`、`jsonCodec.ts`）。プラグイン側は `src/d1Storage.ts`（削除前の `r2Storage.ts` とほぼ同じ）

### エラー

- 種類（`auth` / `folder` / `network`）だけを UI に渡す。`StorageAccessError.provider` で文言を分ける
  - 届かない・トークンが違う: 「Cloudflare D1 に接続できませんでした。\nWorker の URL とアクセストークンを確認してください。」
  - スペース名が不正: 「保存先のスペースにアクセスできません。\nスペース名を確認してください。」
- 「Dropbox の接続を確認」ボタンは Dropbox の `auth` のときだけ出す（`STORAGE_ERROR` に `provider` を足した）

## 結果

- 共有カテゴリを足さない限り、これまでどおりローカルだけで動く。Dropbox の共有カテゴリにも影響しない
- D1 を使うには Worker のデプロイが要る。手順は [`cbTemplatePalette/d1-worker/README.md`](../../../cbTemplatePalette/d1-worker/README.md)
- `wrangler dev --local` で、ping・401・400・404・413、7.2MB（日本語と絵文字入り）の本文が 8 つに分かれて同じバイト列で戻ること、上書き・削除、プラグインの `D1StorageAdapter` からの読み書きを確かめた

## 未確認・既知の制約

- Figma の `networkAccess` で `https://*.workers.dev` のワイルドカードが実際に通るか。独自ドメインで Worker を公開した場合は manifest への追加が要る
- 同じスペースを複数の人が同時に書くと、`index.json` などは後から書いた方が残る（ロックは持たない）
- アクセストークンは共有カテゴリの登録として clientStorage に平文で置く（端末内・プラグイン内だけで読める）。漏れたら Worker の secret を差し替える。トークン 1 つで、その Worker のすべてのスペースを読み書きできる
- 無料プランの D1 は 1 データベース 500MB まで
