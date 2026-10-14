# ADR-012: 共有カテゴリの保存先を Dropbox（OAuth 2.0 PKCE）にする

- ステータス: 採用（Dropbox のアプリキーを入れたあと、実機での確認が必要）
- 日付: 2026-10-14
- 関連: [ADR-011](ADR-011-template-palette-shared-categories.md)（R2 の部分をこの ADR で置き換える）、[ADR-013](ADR-013-template-palette-d1.md)

> 2026-10-14 追記: 共有カテゴリの保存先として、Dropbox と並べて Cloudflare D1（自分で立てる Worker 経由）も選べるようになった（[ADR-013](ADR-013-template-palette-d1.md)）。Dropbox の決定はそのまま有効。

## コンテキスト

[ADR-011](ADR-011-template-palette-shared-categories.md) では、共有カテゴリの保存先を「各自がデプロイする Cloudflare Worker 経由の R2」にした。ユーザーは「cloudfrareではなく Dropbox API + OAuth 2.0 PKCEによる外部ストレージ機能 の方法に変更したい」と求めた。

守る条件（ADR-010・ADR-011 から引き継ぐ）

- Google / Dropbox のパスワードを取得・保存しない。client_secret（App secret）をプラグインに埋め込まない
- 必要最小限の権限だけを求める。API の詳しいエラーを UI にそのまま出さない
- 切り替えで既存データを勝手に消さない。既存のローカル利用に影響を出さないことを最優先にする

## 決定

### Cloudflare をやめる

- `cbTemplatePalette/r2-worker/` と `src/r2Storage.ts` を削除した。サーバーは置かない
- R2 はまだ公開していなかったので移行は用意しない。clientStorage に残っている R2 の登録（`provider: "r2"`）は読み飛ばすだけで、消しはしない

### 認証は OAuth 2.0 PKCE（コードを貼り付ける。ユーザーの選択）

- Figma のプラグインはリダイレクトを受けられないので、`redirect_uri` を付けずに認可する。Dropbox がブラウザに出したコードを UI に貼ってもらう
- PKCE の `code_verifier`（32 バイトの乱数を base64url）は **UI のメモリにだけ** 持つ。`code_challenge` は SHA-256（`crypto.subtle` が無い場合に備えて `src/pkce.ts` に自前で実装。RFC 7636 の例で確認）
- コードの交換・トークンの更新・取り消しはメインスレッド（`src/dropboxAuth.ts`）。App secret は使わない。アプリキー（`DROPBOX_APP_KEY`）は公開してよい値として定数に置く
- `token_access_type=offline` で refresh_token をもらい、clientStorage の `cbTemplatePalette.dropboxSession`（`{ refreshToken, accountId, email? }`）に置く。**アクセストークンはメモリにだけ** 持ち、期限の 60 秒前に取り直す
- 「接続を解除」で Dropbox 側のトークンを取り消し（届かなくても続ける）、セッションを消す。共有カテゴリの登録と Dropbox のデータはそのまま

### 権限は Full Dropbox、スコープは 4 つだけ（ユーザーの選択）

- 共有フォルダを使うため、App folder ではなく Full Dropbox のアプリにする（App folder は共有できない）
- スコープは `account_info.read`・`files.metadata.read`・`files.content.read`・`files.content.write` だけ。共有の設定（`sharing.*`）は求めない
- 読み書きするのは、自分で選んだフォルダの中のファイルだけ。フォルダ選びのときだけ、開いたフォルダの一覧（フォルダだけ）を読む

### 共有カテゴリ = Dropbox のフォルダ

- 共有は Dropbox の機能で行う。フォルダを共有し、受け取った人は自分の Dropbox に追加してから、プラグインで同じフォルダを選ぶ
- 保存先は `{ provider: "dropbox", path, label, namespaceId? }`。共有フォルダの根（`sharing_info.shared_folder_id` があるフォルダ）を選んだときは `ns:<namespaceId>` で指す。持ち主が名前を変えたり、各自が別の場所に置いたりしても同じフォルダを指せる
- フォルダの中身は R2 のスペースと同じ（`metadata.json`・`index.json`・`tree.json`・`categories.json`・`items/<id>.json`、`jsonCodec.ts`）
- 使う前に `files/get_metadata` でフォルダがあるか確かめる。消えたフォルダを upload で黙って作り直さないため
- 「未設定」と通常のカテゴリはローカルのまま

### API の呼び方（`src/dropboxStorage.ts`）

- 読む: `files/download`、書く: `files/upload`（`mode: overwrite`・`mute: true`）、消す: `files/delete_v2`
- `Dropbox-API-Arg` ヘッダーは ASCII しか通らないので、ASCII 以外は `\uXXXX` にする
- 401 は 1 回だけトークンを取り直してやり直す。429 は `Retry-After`（最大 10 秒）待って 2 回までやり直す
- エラーの種類: 401 / 403・更新の失敗は `auth`、409（見つからない以外）と 400 は `folder`、それ以外は `network`
  - `auth`・`network`: 「Dropbox に接続できませんでした。\n接続し直してください。」。`auth` のときは一覧の上に「Dropbox の接続を確認」ボタンを出す
  - `folder`: 「保存先フォルダにアクセスできません。\nフォルダを選び直してください。」

## 結果

- 共有カテゴリを足さない限り、これまでどおりローカルだけで動く。キーも値も変わらない
- 使うには Dropbox App Console でアプリを作り、`DROPBOX_APP_KEY` を入れてビルドする必要がある（手順は spec）
- manifest の `networkAccess` は `https://api.dropboxapi.com` と `https://content.dropboxapi.com` だけ。認可画面は `figma.openExternal` でブラウザに開く

## 未確認・既知の制約

- Figma のメインスレッド（origin が `null`）から Dropbox API への `fetch` が CORS で通るか、実機で確かめていない
- Dropbox Business のチームスペース（`Dropbox-API-Path-Root` が要る構成）は対象外
- 同じ共有カテゴリを複数の人が同時に書くと、`index.json` などは後から書いた方が残る（ロックは持たない）
- refresh_token は解除するまで clientStorage に平文で残る（端末内・プラグイン内だけで読める）。Dropbox の「設定 → 接続済みアプリ」からも取り消せる
- 開発中（Development）のアプリは、接続できるユーザーが 500 人までで、それを超えるには Dropbox の審査（Production）が要る
