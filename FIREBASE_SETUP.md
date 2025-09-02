## Firebase セットアップ手順（CliniQuest）

### 1) プロジェクト作成とWebアプリ登録

1. https://console.firebase.google.com で新規プロジェクトを作成します。
2. 「アプリを追加」> 「Web」を選択し、アプリ登録後に表示される `firebaseConfig` を控えます。
3. リポジトリの `config.sample.js` を `config.js` にコピーし、控えた値を記入します。

### 2) Authentication

- サイドバー「Authentication」>「はじめる」> サインイン方法で「匿名」を有効化します。
- 後でメール/パスワードも有効化可能です（任意）。

### 3) Firestore

1. 「Firestore Database」>「データベースの作成」> 本番モードで開始。
2. セキュリティルール（例、オーナー一致のみ許可）:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwnerExisting() {
      // 既存ドキュメントに対する参照（read/update/delete）
      return request.auth != null && resource.data.uid == request.auth.uid;
    }
    function isOwnerCreating() {
      // 新規作成時（create）は request.resource を参照
      return request.auth != null && request.resource.data.uid == request.auth.uid;
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /qas/{id} {
      allow create: if isOwnerCreating();
      allow read, update, delete: if isOwnerExisting();
    }
    match /achievements/{id} {
      allow create: if isOwnerCreating();
      allow read, update, delete: if isOwnerExisting();
    }
    match /sessions/{id} {
      allow create: if isOwnerCreating();
      allow read, update, delete: if isOwnerExisting();
    }
    match /logs_daily/{docId} {
      allow create: if isOwnerCreating();
      allow read, update, delete: if isOwnerExisting();
    }
  }
}
```

3. 「設定」>「認可済みドメイン」に `yusuke0018.github.io` と `localhost` を追加します。

### 4) ローカル開発

```
npm ci
npm run dev
```

`http://localhost:3000` などでアクセスして確認します（ポートは環境により異なります）。

### 5) デプロイ（GitHub Pages）

- リポジトリの Settings > Pages で Source を `main` ブランチ `/ (root)` に設定します。
- 公開URL: `https://yusuke0018.github.io/CliniQuest/`
- 404は `404.html` が自動で index にフォールバックします。
