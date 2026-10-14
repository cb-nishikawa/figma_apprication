# cb-template-palette-d1（共有カテゴリの保存先を Cloudflare D1 にする Worker）

テンプレパレットくんの共有カテゴリを Cloudflare D1 に置くための Worker です。**使う人（チーム）が自分の Cloudflare にデプロイ**します。

- D1 にはバインディングで触るので、Cloudflare の API トークンやアカウントの情報はプラグインに出てきません
- プラグインに入力するのは「Worker の URL」「アクセストークン」「スペース名」の 3 つだけです
- 同じ Worker・同じスペース名を入力した人どうしで、同じテンプレートが見えます（チームでの共有）

## API

すべて `Authorization: Bearer <ACCESS_TOKEN>` が必要です。合わなければ 401 を返します。

| メソッドとパス | 内容 |
| --- | --- |
| `GET /v1/ping` | `{ ok: true, app: "cbTemplatePalette-d1" }`。プラグインの接続テストが使う |
| `GET /v1/spaces/<space>/objects/<path>` | ファイルを読む。無ければ 404 |
| `PUT /v1/spaces/<space>/objects/<path>` | ファイルを書く（上書き、25MB まで。超えたら 413） |
| `DELETE /v1/spaces/<space>/objects/<path>` | ファイルを消す |

- `space` は英数字と `._-`（64 文字まで）、`path` の各部分は英数字と `._%-`（4 段まで）。`..` は使えない（400）
- スペースの中身はプラグインが決める（`metadata.json`、`index.json`、`tree.json`、`categories.json`、`items/<id>.json`）

## テーブル

[`migrations/0001_init.sql`](migrations/0001_init.sql) の `objects (space, path, chunk, body, updated_at)`。

- D1 の 1 行は約 2MB までなので、本文は UTF-8 で 1MB ごとの `chunk` に分けて持ちます
- 書き込みは「同じ chunk は上書き（UPSERT）→ 余った chunk だけ消す」を 1 回の `batch`（トランザクション）で行うので、途中で失敗しても古い本文が残ります。消してから入れ直すより、D1 の書き込み行数が約 3 分の 1 になります

### 2026-10-14 より前にデプロイした人へ

書き込みの方式を変えました（API は同じ）。このフォルダで `npm run deploy` し直すと、書き込み行数が減ります。再デプロイしなくても、プラグインはそのまま使えます。

## 設定手順

```sh
cd cbTemplatePalette/d1-worker
npm install
npx wrangler login
npx wrangler d1 create cb-template-palette   # 表示された database_id を wrangler.toml に書く
npm run migrate                               # テーブルを作る
openssl rand -base64 32 | npx wrangler secret put ACCESS_TOKEN
npm run deploy
```

デプロイすると `https://cb-template-palette-d1.<サブドメイン>.workers.dev` のような URL が表示されます。

`ACCESS_TOKEN` はカンマ区切りで複数入れられます（例: 人ごとに別のトークンを配り、抜けた人の分だけ消す）。合言葉が漏れたら `wrangler secret put ACCESS_TOKEN` で入れ直せば、古いものは使えなくなります。

## プラグインでの使い方

「⋯」→「設定…」で「共有カテゴリを使用する」をオンにし、「⋯」→「共有カテゴリを追加…」で URL・アクセストークン・スペース名を入れて「接続テスト」→「追加」。チームの人にも同じ 3 つを伝えれば、同じカテゴリが見えます。「未設定」と通常のカテゴリは、これまでどおり各自の端末（ローカル）に保存されます。

### 注意

- プラグインの `manifest.json` は `https://*.workers.dev` への通信だけを許可しています。独自ドメインで Worker を動かす場合は、`networkAccess.allowedDomains` にそのドメインを足してビルドし直してください
- 同じスペースに複数の人が同時に保存すると、一覧（`index.json`）は後から書いた方が残ります。もう一方の追加が一覧から消えることがあります（データ自体は `items/` に残ります）
- アクセストークンは、入力した人の Figma（clientStorage）に保存されます
- 無料プランの D1 は 1 データベース 500MB まで、Worker の 1 回の呼び出しで使えるクエリは 50 までです（25MB の本文で 26 文）

## 接続テストが失敗するとき

まず、デプロイした URL とトークンで ping を叩いて、`app` が `cbTemplatePalette-d1` になっているかを確かめます。

```sh
curl -s -H "Authorization: Bearer <ACCESS_TOKEN>" "https://cb-template-palette-d1.<サブドメイン>.workers.dev/v1/ping"
# => {"ok":true,"app":"cbTemplatePalette-d1"}
```

| ping の結果 | 原因と対処 |
| --- | --- |
| `{"ok":true,"app":"cbTemplatePalette-d1"}` | Worker は正しい。プラグインで「届いていません」と出るなら、`npm run build` してから Figma でプラグインを読み込み直す |
| `{"ok":true,"service":"figma-storage-api"}` など、`app` が違う・無い | **別の Worker の URL**。このフォルダの Worker を `npm run deploy` して、表示された URL を入れる |
| `{"ok":true,"app":"cbTemplatePalette-r2"}` | 削除した R2 用 Worker の URL。このフォルダの Worker をデプロイし直す |
| 401 / `{"error":"auth"}` | トークンが `ACCESS_TOKEN` と違う（`wrangler secret put ACCESS_TOKEN` で入れた値を使う） |
| 404・つながらない | URL の誤り、または未デプロイ。URL の末尾に `/v1/ping` やスラッシュを付けずにプラグインへ入れる |

ping は通るのに接続テストで「D1 の読み書きに失敗しました」と出るときは、`wrangler.toml` の `database_id` が実際の ID になっているか、`npm run migrate` でテーブルを作ったかを確かめてください（`npx wrangler tail` でログを見られます）。

プラグインの接続テストは、原因に近い案内（別の Worker・R2 用 Worker・トークン違い・届かない・D1 の失敗）を出し分けます。

## ローカルで動かす

`.dev.vars` に `ACCESS_TOKEN=...` を書き、`npm run migrate:local` のあと `npm run dev`（`http://localhost:8787`）。プラグインの URL 欄に `http://localhost:8787` を入れると、manifest の `devAllowedDomains` で開発中だけ通ります。
