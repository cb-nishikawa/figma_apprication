# cb-template-palette-r2（共有カテゴリの保存先を Cloudflare R2 にする Worker）

テンプレパレットくんの共有カテゴリを Cloudflare R2 に置くための Worker です。**使う人（チーム）が自分の Cloudflare にデプロイ**します。

- R2 にはバインディングで触るので、R2 の Access Key / Secret Access Key はどこにも出てきません
- プラグインに入力するのは「Worker の URL」「アクセストークン」「スペース名」の 3 つだけです
- 同じ Worker・同じスペース名を入力した人どうしで、同じテンプレートが見えます（チームでの共有）

## API

すべて `Authorization: Bearer <ACCESS_TOKEN>` が必要です。合わなければ 401 を返します。

| メソッドとパス | 内容 |
| --- | --- |
| `GET /v1/ping` | `{ ok: true, app: "cbTemplatePalette-r2" }`。プラグインの接続テストが使う |
| `GET /v1/spaces/<space>/objects/<path>` | オブジェクトを読む。無ければ 404 |
| `PUT /v1/spaces/<space>/objects/<path>` | オブジェクトを書く（上書き、25MB まで） |
| `DELETE /v1/spaces/<space>/objects/<path>` | オブジェクトを消す |

- R2 のキーは `<space>/<path>`。`space` は英数字と `._-`（64 文字まで）、`path` の各部分は英数字と `._%-`。`..` は使えない
- スペースの中身はプラグインが決める（`metadata.json`、`index.json`、`tree.json`、`categories.json`、`items/<id>.json`）

## 設定手順

```sh
cd cbTemplatePalette/r2-worker
npm install
npx wrangler login
npx wrangler r2 bucket create cb-template-palette   # 名前を変えたら wrangler.toml の bucket_name も変える
openssl rand -base64 32 | npx wrangler secret put ACCESS_TOKEN
npm run deploy
```

デプロイすると `https://cb-template-palette-r2.<サブドメイン>.workers.dev` のような URL が表示されます。

`ACCESS_TOKEN` はカンマ区切りで複数入れられます（例: 人ごとに別のトークンを配り、抜けた人の分だけ消す）。合言葉が漏れたら `wrangler secret put ACCESS_TOKEN` で入れ直せば、古いものは使えなくなります。

## プラグインでの使い方

「⋯」→「共有カテゴリを追加…」で URL・アクセストークン・スペース名を入れて「接続テスト」→「追加」。チームの人にも同じ 3 つを伝えれば、同じカテゴリが見えます。「未設定」と通常のカテゴリは、これまでどおり各自の端末（ローカル）に保存されます。

### 注意

- プラグインの `manifest.json` は `https://*.workers.dev` への通信だけを許可しています。独自ドメインで Worker を動かす場合は、`networkAccess.allowedDomains` にそのドメインを足してビルドし直してください
- 同じスペースに複数の人が同時に保存すると、一覧（`index.json`）は後から書いた方が残ります。もう一方の追加が一覧から消えることがあります（データ自体は `items/` に残ります）
- アクセストークンは、入力した人の Figma（clientStorage）に保存されます

## ローカルで動かす

`.dev.vars` に `ACCESS_TOKEN=...` を書いて `npm run dev`（`http://localhost:8787`）。プラグインの URL 欄に `http://localhost:8787` を入れると、manifest の `devAllowedDomains` で開発中だけ通ります。
