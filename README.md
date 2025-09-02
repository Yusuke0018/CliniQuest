# CliniQuest

医学知識Q&A学習アプリ（PWA）。GitHub Pagesでホストし、Firebase（Auth/Firestore）を用います。

## クイックスタート（開発）

1. Firebaseプロジェクトを作成し、Webアプリを追加して `firebaseConfig` を取得。
2. `config.sample.js` を `config.js` にコピーし、値を入力。
3. ローカルで静的サーバを起動（例: `npx serve`）し、`http://localhost:3000` などで動作確認。

```
npm ci
npm run dev
```

## デプロイ（GitHub Pages）

- リポジトリ設定で Pages の公開元を `main` ブランチの `/ (root)` に設定します。
- 公開URLは `https://yusuke0018.github.io/CliniQuest/` を想定しています。
- SPAフォールバック用に `404.html` を同梱しています。

## Firebase セットアップ

- 詳細手順は `FIREBASE_SETUP.md` を参照してください。
- 認証: 匿名サインインを有効化。
- Firestore: 永続化（IndexedDB）を有効にしています（クライアント側）。
- 認可ドメインに `yusuke0018.github.io` と `localhost` を追加。

## ステータス

- 現状はMVPスケルトン：作問・学習はローカル保存のダミー。Firebase接続後に同期へ移行します。

## ライセンス

- 未定（必要に応じて追加）。
