# ADR-010: 外部ストレージに Google Drive を足す（Cloudflare Worker で OAuth、drive.file と Picker）

- ステータス: 廃止（2026-10-09、[ADR-011](ADR-011-template-palette-shared-categories.md) へ）
- 日付: 2026-10-07
- 関連: [ADR-003](ADR-003-template-palette-serialization.md)、[ADR-007](ADR-007-template-palette-images.md)

> 2026-10-09: ユーザーの依頼で、設定ダイアログ（保存先の切り替え）と Google Drive 対応を公開前に丸ごと削除した（`googleAuth.ts` / `googleDrive.ts` / `storageSettings.ts` / `cbTemplatePalette/worker/`）。「未設定」と通常のカテゴリは常にローカルで、外部の保存先は Cloudflare R2 の共有カテゴリだけ。以下は当時の判断の記録として残す。`StorageAdapter` による保存先の抽象化と、エラーを種類だけ渡す方針は ADR-011 に引き継いでいる。

## コンテキスト

`cbTemplatePalette` はテンプレートを `figma.clientStorage` に置いている。端末ごと・プラグインごとに約 5MB までで、別の端末とは共有できない。ユーザーは、自分の Google アカウントで OAuth 認証し、自分の Google Drive のフォルダに保存したいと求めた。

ユーザーが挙げた条件:

- Google のパスワードを取得・保存しない。`client_secret` などの秘密情報をプラグインに埋め込まない
- アクセストークンをプラグインのデータとして無制限に保存しない。Drive 全体を不要に読まない（必要最小限の権限）
- API の詳しいエラーを画面にそのまま出さない
- 既定はローカル。既存ユーザーのデータはそのまま。切り替えでデータを勝手に消さない。既存の `localStorage`（= `clientStorage`）の利用に影響を出さないことが最優先
- 保存フォルダは名前ではなく `folderId` で覚え、Figma ファイルではなくユーザーの設定として持つ（どのファイルからでも同じフォルダ）

## 決定

### 保存先の抽象化

- `storageAdapter.ts` に `get` / `set` / `remove` だけの `StorageAdapter` を置き、`storage.ts` の `clientStorage` 呼び出し 12 か所をここ経由にした。`LocalStorageAdapter` は `clientStorage` をそのまま呼ぶだけで、ローカルの挙動は変えていない
- `GoogleDriveStorageAdapter` を足し、設定の `storageType`（`"local"` / `"google-drive"`）で切り替える。容量の上限は Drive では持たない（`quotaBytes: null`。上限チェックとバーを出さない）
- 保存先の設定（`cbTemplatePalette.storageSettings`）と Google のセッション（`cbTemplatePalette.googleSession`）は、どちらを使っていても **常に `clientStorage`** に置く。UI の高さ・表示モードも `clientStorage` のまま

### 認証は Cloudflare Worker（ユーザーの選択）

- Figma のプラグインの画面は null origin で、Google の OAuth をプラグインの中では完結できない。`client_secret` も置けない。そこで `cbTemplatePalette/worker/` の Worker が OAuth（PKCE、`access_type=offline`）を受け持つ
- リフレッシュトークンは Worker の KV に AES-GCM で暗号化して置く。キーはセッショントークンの SHA-256
- プラグインが持つのは、Worker が発行する **取り消し可能なランダムな `sessionToken`** とメールアドレスだけ。アクセストークン（1 時間）は **メモリにだけ** 持ち、期限の 1 分前に Worker の `/token` で取り直す
- 接続はブラウザで行う: `/auth/start` → `figma.openExternal` → `/auth/poll` を 2 秒ごと、5 分まで。パスワードはブラウザで Google に直接入力され、プラグインには来ない
- 「接続を解除」で Worker のセッションを消し、Google 側のトークンも取り消す

### 権限は `drive.file` だけ、フォルダは Google Picker（ユーザーの選択）

- スコープは `openid` `email` `drive.file`。同意画面で Drive の項目を外された場合は Worker が受け付けない
- `drive.file` ではフォルダの一覧をプラグインで出せないので、フォルダ選択は Worker の Google Picker のページで行う（1 回だけ開けるページにアクセストークンを埋め込む）。選んだフォルダの `id` / `name` と、読めた範囲の親フォルダ名を `/picker/poll` で受け取る。読めない親は「…」
- 保存するのは `{ provider: "google-drive", folderId, folderName, folderPath? }`

### Drive のファイル構成

- 保存フォルダに `metadata.json`、`index.json`、`tree.json`、`categories.json`、`items/<id>.json` を置く（キー 1 つにつき 1 ファイル）
- `Uint8Array`（gzip 済みのノードツリーと画像）は `{"$u8": base64}` にして JSON にする。メインスレッドには `btoa` が無いので自前で変換する。本文は ASCII だけにする
- ファイル ID は一覧を 1 回取って覚える。同じキーへの書き込みは順番に流す（同名ファイルが 2 つできないように）。index などの小さい値は 5 秒だけ覚えて、1 回の操作で何度も取りに行かない

### エラーと切り替え

- エラーは種類（`auth` / `folder` / `network`）だけを UI に渡し、API の本文は出さない
  - 保存フォルダが無い・ゴミ箱・書き込めない: 「保存フォルダにアクセスできません。保存先フォルダを再選択してください。」と「設定を開く」
  - それ以外: 「Google Driveに接続できませんでした。認証状態と保存フォルダの権限を確認してください。」
- **Drive に届かないときに黙ってローカルへ戻さない**（別の保存先のデータを見せたり、そこへ書いたりしないため）
- 切り替えはアダプターを差し替えて一覧を読み直すだけ。**コピーも削除もしない**。前の保存先のデータはそのまま残る（移行は今後の課題）
- Google Drive へ切り替えるときは、保存フォルダを確かめてから切り替える。Drive を使っている間に「接続を解除」したら、保存先をローカルに戻して通知する
- 接続テストは「認証 → Drive API（`about.get`）→ 保存フォルダの権限（`canAddChildren`）→ テスト用ファイルの作成・読み込み・削除」の順

## 結果

- ローカルの読み書きは `LocalStorageAdapter` 経由になっただけで、キーも値も変わらない。既存ユーザーは設定が無いのでローカルのまま
- `manifest.json` の `networkAccess` に `https://www.googleapis.com` と Worker のドメインを足した（以前は `none`）
- 使うには、Google Cloud（Drive API・Picker API・OAuth クライアント・API キー）と Cloudflare（KV・secret）の設定が必要。手順は [`cbTemplatePalette/worker/README.md`](../../../cbTemplatePalette/worker/README.md)
- Worker の URL は仮に `https://cb-template-palette-auth.cb-nishikawa.workers.dev` にしてある。違えば `src/googleAuth.ts` の `AUTH_BASE_URL` と manifest を書き換える

## 未確認のこと

- Picker で選んだフォルダの中に、`drive.file` でファイルを作れること（Google の説明ではできる）
- プラグインのメインスレッドの `fetch`（null origin）から `www.googleapis.com` を呼べること。CORS で通らなければ、Drive の呼び出しも Worker を経由させる
- Google の OAuth アプリが「テスト」のままだと、リフレッシュトークンは 7 日で切れる。本番では「本番環境」に公開する（`drive.file` は審査の要らない範囲）
- 同じフォルダを複数の Figma ウィンドウ・端末から同時に書くと、後から書いた方が残る（`clientStorage` のときと同じ）
