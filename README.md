# 競走馬DB

パドック画像とレース結果を記録し、好走条件を検討するための個人用Webアプリです。iPad mini（Safari／ホーム画面に追加）での利用を想定しています。

- データ：Googleスプレッドシート（Googleドライブの「競走馬DB」フォルダに自動作成）
- 画像：同じフォルダの「画像」フォルダ
- 文字認識：Google Cloud Vision API（APIキーはアプリの設定画面で入力。コードには含めません）

## 公開手順（GitHub Pages）

1. このフォルダの中身をすべてリポジトリの直下に置く（`.nojekyll` も含む）
2. Settings → Pages → Deploy from a branch → `main` / `(root)`
3. `config.js` の `clientId` に OAuth クライアントIDを入れてコミットする
4. Google Cloud の OAuth クライアントに次を登録する
   - 承認済みの JavaScript 生成元：`https://ユーザー名.github.io`
   - 承認済みのリダイレクト URI：`https://ユーザー名.github.io/horse-db/`（末尾の `/` まで正確に）

`clientId` が空のときは、Googleにつながない「デモモード」で動きます（データはブラウザ内に保存）。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `index.html` | 画面の土台 |
| `config.js` | OAuthクライアントID（公開して問題ない値） |
| `style.css` | 見た目 |
| `store.js` | ログイン、スプレッドシート・ドライブの読み書き、デモ用保存 |
| `ocr.js` | パドック画像の読み取りルール、馬名の名寄せ |
| `sketch.js` | Apple Pencil での書き込みと比率計算 |
| `app.js` | 各画面 |

## 秘密にする値

- Vision API の APIキー（アプリの設定画面でのみ入力）
- Google アカウントのパスワード、Client secret（このアプリでは使いません）

パドック画像や競走馬のデータは、このリポジトリに入れないでください。
