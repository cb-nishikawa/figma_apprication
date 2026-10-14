# ADR-017: D1 の呼び出しをまとめる（一括 API）

- ステータス: 採用（Worker の再デプロイが必須）
- 日付: 2026-10-14
- 関連: [ADR-013](ADR-013-template-palette-d1.md)、[ADR-016](ADR-016-template-palette-d1-io.md)

## コンテキスト

ユーザーは「2つ追加したところワーカー呼び出しが20になったけど正常？」と尋ねた。

調べた結果、これは今の作りでは正常な回数だった。

- `Authorization` ヘッダーを付けた fetch は、ブラウザ（Figma のプラグイン）が本番の前に CORS の事前確認（OPTIONS）を送る。Worker の呼び出しは実際の約 2 倍に数えられる
- 保存 1 回は、item の書き込み、index の読み込み・書き込み、tree の読み込み・書き込みを 1 つずつ別に送っていた。キャッシュが切れていると読み込みも増える
- 2 件の保存で、OPTIONS も含めて約 20 回になる

ユーザーは、まとめて送る API にすることを選んだ。

## 決定

### 一括 API `POST /v1/spaces/<space>/batch`

- 本文は `{ token, get?: string[], put?: { path, body }[], delete?: string[] }`
- 応答は `{ ok: true, app: "cbTemplatePalette-d1", api: 2, objects: { <path>: 本文 | null } }`。無い path は `null`
- 処理の順は「削除 → 上書き（UPSERT と余った chunk の削除）」を 1 つの `DB.batch`（トランザクション）で行い、そのあと `get` を 1 文の `SELECT … path IN (…)` で読む。書いた値を同じ呼び出しで読み返せる
- 何も指定しなければ ping として扱い、`app` と `api` だけを返す
- エラーの応答にも `api: 2` を付ける（プラグインが古い Worker と見分けるため）

### 事前確認（OPTIONS）を起こさない

- `POST` で `Content-Type: text/plain`、独自ヘッダーなしにすると、CORS の「単純リクエスト」になり事前確認が出ない
- そのため、アクセストークンは `Authorization` ヘッダーではなく本文の `token` に入れる。URL のクエリにはしない（Cloudflare のログやブラウザの履歴に残るため）
- トークンの照合は今までと同じ（SHA-256 にしてから定数時間で比べる。カンマ区切りで複数可）

### 上限

- 無料プランの D1 は、Worker の 1 回の呼び出しで使えるクエリが 50 まで。余裕を見て、1 回の一括 API は 45 文（読み込みの SELECT を含む）までにし、超えたら 413 `too_many`
- D1 は 1 文の bind が 100 個まで。`IN (…)` に入れる path は 1 文 90 個まで。`get` は 90 個まで（超えたら 400）、`delete` は 90 個ごとに文を分ける
- 本文全体は 30MB まで、1 つの `put` は今までどおり 25MB まで（超えたら 413 `too_large`）
- プラグインの 1 回の保存は item・index・tree の 3 つ。画像入りの item（最大で 20MB 前後）でも 45 文には収まる

### プラグイン側

- `D1StorageAdapter` はすべて一括 API で読み書きする
  - 保存先の確認（`verify`）は 1 回の呼び出しで `metadata.json`・`index.json`・`tree.json`・`categories.json` を読み、ping も兼ねる。スペースが新しいときだけ `metadata.json` の書き込みでもう 1 回
  - 一番上のキー（index・tree・categories）の読み込みは 3 つまとめて取る。無いファイル（`null`）も覚えて、使い回しの間は読み直さない
  - `StorageAdapter` に任意の `setMany(entries)` を足した。`storage.ts` の `saveTemplate` / `deleteTemplates` / `updateTemplate` / `renameCategory` は、`setMany` があれば 1 回の書き込みにする。ローカル（clientStorage）は今までどおり 1 つずつ
- 401・403 の応答に `api: 2` が無ければ古い Worker と判断し、接続テストで「Worker が古い版です。…npm run deploy を実行して更新してください。」と出す

### 旧 API は残す

- `GET /v1/ping`、`GET` / `PUT` / `DELETE /v1/spaces/<space>/objects/<path>`（`Authorization: Bearer`）はそのまま使える。curl での確認や、古いプラグインのため
- 新しいプラグインは一括 API だけを使うので、Worker の再デプロイが必須になる

## 結果

`wrangler dev --local` の Worker に、fetch を差し替えたプラグインから送って数えた（OPTIONS は出ない）。

- 共有カテゴリを開く: 1 回（新しいスペースは `metadata.json` の作成で 2 回）
- 保存 1 回: 1 回（10 秒の使い回しが切れたあとは、読み込みを足して 2 回）
- 2 件の削除: 1 回

2 件の保存で約 20 回だった呼び出しが、2〜4 回になる。

- 古い Worker のままだと、新しいプラグインの共有カテゴリは読み書きできない（接続テストで更新を案内する）
- アクセストークンは本文で送る。HTTPS なので通信の途中では見えない
