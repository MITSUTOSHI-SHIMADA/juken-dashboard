# 大学受験 学習マネジメント ダッシュボード（動的Webアプリ）

**🔗 公開URL：https://rn-juken-dashboard-2026.netlify.app/**
（旧 GitHub Pages版 https://mitsutoshi-shimada.github.io/juken-dashboard/ も同じ内容で公開中・上部に新URLへの案内バナーを表示）

---


「合格」というゴールに対し、計画・進捗・生活を一元管理する
**大学受験版プロジェクトマネージャー**。家庭教師アプリではなく「管理」に徹する設計。

> 問題の解き方・答えは一切扱わない。計画・進捗・生活管理のみ。

バックエンド不要の **静的ホスティングで動く動的アプリ**（操作はブラウザに保存）。

---

## 操作できること（動的）

- **解き直しキューを ○ / △ / × で採点** → 忘却曲線で次回出題日を自動再計算
  （× は翌日に戻し頻度UP、○ は次段階へ、最終段階で○なら「習得済み」）
- **今日の問題をタップでチェック** → 当日の進捗カウントに即反映
- **教材の周回を +1 / +10 / −1** → 達成率と信号（緑/黄/赤）を自動再判定
- 操作内容は **localStorage に保存**。リロードしても保持。**「↺ リセット」** で初期化。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み（インラインJS/CSSなし＝CSPを厳格化できる） |
| `styles.css` | デザイン（信号色・大きな数値・操作UI） |
| `data.js` | **初期（シード）データ。ここを差し替えれば本番値になる** |
| `app.js` | 状態管理＋ロジック（逆算・進捗・解き直し・週次レビュー） |
| `_headers` | Netlify / Cloudflare Pages 用セキュリティヘッダ |
| `netlify.toml` | Netlify 用設定 |
| `vercel.json` | Vercel 用設定 |
| `robots.txt` | 検索エンジン非インデックス |
| `.preview-server.js` / `.claude/` | ローカル確認用（デプロイ不要） |

## ビュー

- **本人ビュー**：今日のタイムテーブル＋今日解く問題（タップでチェック）。迷わない画面。
- **親ビュー**：①ヘッダー（志望校/カウントダウン/総合判定）②合格逆算 ③科目別進捗
  ④タイムテーブル ⑤解き直しキュー（採点）⑥週次レビュー。

---

## 友人に「リンク」を渡すには＝デプロイが必須

> いまアプリは **あなたのPC内（ローカル）** にあります。`file://...` や
> `localhost` のURLを送っても、友人のPCには届かず開けません。
> 友人が開ける公開URLにするには、下記いずれかで **公開（デプロイ）** します。
> （無料・数分。**いずれもセキュリティヘッダ設定を同梱済み**）

### A. Netlify（最速・ドラッグ&ドロップ）★おすすめ
1. <https://app.netlify.com/drop> を開く（無料登録）
2. **このフォルダごと** ブラウザにドラッグ&ドロップ
3. `https://○○○.netlify.app` が即発行 → そのURLを友人に共有
   （`netlify.toml` / `_headers` が自動適用）

### B. Vercel
```bash
npm i -g vercel
cd "R学習管理アプリ"
vercel        # 初回のみログイン → デプロイ
vercel --prod # 本番URL発行
```
`vercel.json` のヘッダが適用されます。

### C. Cloudflare Pages
GitHubに push → Cloudflare Pages で接続（Framework: なし／出力ディレクトリ: ルート）。
`_headers` が自動適用。Cloudflare Access でパスワード保護も容易。

### D. GitHub Pages
リポジトリ設定 → Pages → ブランチ公開。
※ GitHub Pages は **HTTPヘッダを設定できない** ため、CSP等は `index.html` の
`<meta>` 側のみ有効（XSS対策の主要部分はカバー）。`X-Frame-Options` 相当の
クリックジャッキング対策ヘッダは効きません。ヘッダ重視なら A〜C を推奨。

### ローカルで確認だけしたいとき
```bash
cd "R学習管理アプリ"
node .preview-server.js   # → http://localhost:4173
```

---

## セキュリティ対策（網羅一覧）

「一般的なWebセキュリティ」を以下で押さえています。

### アプリ側（コードで対策）
- **XSS**：DOMは `textContent` / `createElement` で構築。動的値を `innerHTML` に
  入れない。テンプレートに値を埋める箇所は `esc()` でHTMLエスケープ（多層防御）。
- **インラインJS/CSSなし**：全て外部ファイル化し、イベントは委譲方式。
  CSPで `'unsafe-inline'` を使わずに済むようにしている。
- **外部通信なし**：CDN・外部API・トラッカー・外部フォントを使わない
  （`connect-src 'self'`・サプライチェーン経路を遮断）。
- **保存データについて**：進捗操作は **localStorage** に保存しますが、保存先は
  各自の端末ブラウザのみ（サーバ送信なし）。中身は学習進捗のみで、現状は
  ダミーデータ。「↺ リセット」でいつでも消去できます。Cookie・sessionStorageは未使用。

### ヘッダ側（ホスティング設定で付与）
| ヘッダ | 目的 |
|---|---|
| `Content-Security-Policy` | XSS/インジェクション緩和。読込元を自己ドメインに限定 |
| `X-Frame-Options: DENY` / `frame-ancestors 'none'` | クリックジャッキング防止 |
| `X-Content-Type-Options: nosniff` | MIMEスニッフィング防止 |
| `Referrer-Policy: no-referrer` | リファラ経由の情報漏れ防止 |
| `Permissions-Policy` | カメラ/マイク/位置情報等の機能を全無効化 |
| `Strict-Transport-Security` | HTTPS強制（中間者攻撃対策） |
| `Cross-Origin-*-Policy` | クロスオリジン分離・情報漏えい対策 |

`index.html` の `<meta http-equiv="Content-Security-Policy">` により、
ヘッダを送れない環境でもCSPが効くようにしてあります（多層防御）。

### 運用上の注意（重要）
- 現在の表示データは **すべてダミー**。公開リンクで問題なし。
- **実成績・氏名・生活時間などの個人情報を載せる場合**、公開リンクは
  「URLを知る誰でも閲覧可能」です。実データ運用に切り替える際は、
  Cloudflare Access / Netlify のパスワード保護、または認証付きの本格構成へ
  移行してください（今回のモック範囲外）。
- `robots.txt` と `noindex` で検索インデックスは抑止していますが、
  これは秘匿の手段ではありません（URLが漏れれば閲覧可能）。

---

## 友人・協力者に編集してもらうとき

### パターンA：コラボレーター（GitHubアカウント保有者向け）
1. 嶋田さんがGitHubで Settings → Collaborators → 相手のユーザー名で招待
2. 相手は自分のClaude Codeに次のテンプレを渡すだけ：

> ```
> リポジトリ：https://github.com/MITSUTOSHI-SHIMADA/juken-dashboard
> 上記をローカルにcloneして、〔ここに依頼内容〕を実装してください。
> 完了したら commit → main にpushしてください。
> 公開URL（https://rn-juken-dashboard-2026.netlify.app/）には
> 数分で自動反映されます。
> ※ コード方針：data.js は初期データ、app.js は表示+状態管理、styles.css がデザイン。
>   インラインJS/CSSは追加せず（CSP厳格化のため）、DOMは textContent / createElement で構築してください。
> ```

### パターンB：Fork + Pull Request（権限を渡さない・推奨）
> ```
> https://github.com/MITSUTOSHI-SHIMADA/juken-dashboard をForkして、
> 自分のリポジトリで〔ここに依頼内容〕を実装してください。
> 完了したら `gh pr create` でPull Requestを作成。嶋田さんがレビューしてmergeします。
> ```

### パターンC：GitHubアカウントなし（diff渡し）
相手のClaude Codeに渡すテンプレ：
> ```
> https://rn-juken-dashboard-2026.netlify.app/ を確認して、
> 〔ここに依頼内容〕を実装したいです。
> 関係するファイル（app.js / styles.css / data.js / index.html）の
> 完成版コードを全文出してください。嶋田さんに貼ってもらいます。
> ```
相手から届いたコードを嶋田さんが自分のClaudeに渡し「これに置き換えてcommit→push」と頼めば完了。

---

## データ差し替え

`data.js` の `window.STUDENT_DATA` を編集するだけ。
学年・志望校名・試験日・模試成績・教材・解き直しキュー・タイムテーブルを
実値に変えれば本番に近づきます。`referenceDate` を `null` にすると
当日の日付でカウントダウン等が動きます。

> `data.js` の構造を変えたときは `schemaVersion` の数値を上げてください。
> 保存済みデータと構造が食い違うのを防ぐため、バージョンが変わると
> 古い保存データは自動で破棄され、新しいシードで再初期化されます。
