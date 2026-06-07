/* =============================================================
 * 大学受験 学習マネジメント ダッシュボード — 技術仕様書
 * Word(.docx) 生成スクリプト（BizteX ブランドカラー）
 * ============================================================= */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageBreak, ExternalHyperlink,
  TableOfContents, PageNumber, Header, Footer,
  TabStopType, TabStopPosition,
} = require("docx");

/* ---------- BizteX ブランドカラー ---------- */
const BRAND = {
  navy:   "003366",  // ダーク（H1・カバー）
  blue:   "0068B7",  // プライマリ（H2・リンク・テーブルヘッダ）
  cyan:   "00A0E9",  // アクセント（H3）
  bgSoft: "E6F4FB",  // 行交互シェード
  inkSoft:"3F3F3F",  // 本文
  ngRed:  "C53030",  // NG
  okGreen:"1F7A52",  // OK
};

const FONT = "Meiryo"; // 日本語フォント（Windows/macOS両対応）

/* ---------- ヘルパー ---------- */
const P = (text, opts = {}) =>
  new Paragraph({
    spacing: opts.spacing || { after: 100 },
    alignment: opts.alignment,
    children: [
      new TextRun({
        text: text,
        font: FONT,
        size: opts.size || 22, // 11pt
        bold: opts.bold,
        color: opts.color || BRAND.inkSoft,
        italics: opts.italics,
      }),
    ],
  });

// 複数のTextRunで構成された段落（部分的に色や太字を変えたいときに使う）
const Pmix = (runs, opts = {}) =>
  new Paragraph({
    spacing: opts.spacing || { after: 100 },
    alignment: opts.alignment,
    children: runs.map(r =>
      new TextRun({
        text: r.text,
        font: FONT,
        size: r.size || opts.size || 22,
        bold: r.bold,
        italics: r.italics,
        color: r.color || BRAND.inkSoft,
      })
    ),
  });

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 200 },
  children: [new TextRun({ text, font: FONT, size: 36, bold: true, color: BRAND.navy })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 160 },
  children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: BRAND.blue })],
});

const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 200, after: 120 },
  children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: BRAND.cyan })],
});

const bullet = (text, opts = {}) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { after: 60 },
  children: [
    new TextRun({ text: text, font: FONT, size: 22, color: opts.color || BRAND.inkSoft, bold: opts.bold }),
  ],
});

// インラインで一部だけ色を変えたい箇条書き
const bulletMix = (runs) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { after: 60 },
  children: runs.map(r => new TextRun({
    text: r.text, font: FONT, size: 22, bold: r.bold, color: r.color || BRAND.inkSoft, italics: r.italics,
  })),
});

const numbered = (text) => new Paragraph({
  numbering: { reference: "numbers", level: 0 },
  spacing: { after: 60 },
  children: [new TextRun({ text, font: FONT, size: 22, color: BRAND.inkSoft })],
});

const code = (text) => new Paragraph({
  spacing: { after: 60 },
  shading: { type: ShadingType.CLEAR, fill: "F4F6F8" },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: BRAND.cyan, space: 6 } },
  children: [new TextRun({ text, font: "Consolas", size: 20, color: BRAND.navy })],
});

// 1個の場合は Paragraph を返す（children配列にそのまま入れられる）
// 複数の場合は ...spacers(n) でスプレッドする
const spacer = () => new Paragraph({ children: [new TextRun({ text: "", font: FONT })] });
const spacers = (n) => Array.from({ length: n }, () => spacer());

// セル
const td = (text, opts = {}) => new TableCell({
  width: { size: opts.width, type: WidthType.DXA },
  borders: {
    top:    { style: BorderStyle.SINGLE, size: 6, color: BRAND.blue },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.blue },
    left:   { style: BorderStyle.SINGLE, size: 6, color: BRAND.blue },
    right:  { style: BorderStyle.SINGLE, size: 6, color: BRAND.blue },
  },
  shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
  margins: { top: 100, bottom: 100, left: 140, right: 140 },
  verticalAlign: VerticalAlign.CENTER,
  children: [new Paragraph({
    spacing: { after: 0 },
    children: [new TextRun({
      text: text,
      font: FONT,
      size: opts.size || 20,
      bold: opts.bold,
      color: opts.color || BRAND.inkSoft,
    })],
  })],
});

// 1〜N列のヘッダ行を作るヘルパー
const headerRow = (cells, widths) => new TableRow({
  tableHeader: true,
  children: cells.map((t, i) => td(t, { width: widths[i], fill: BRAND.navy, color: "FFFFFF", bold: true })),
});

// 通常行
const dataRow = (cells, widths, isAlt = false) => new TableRow({
  children: cells.map((t, i) => td(t, {
    width: widths[i],
    fill: isAlt ? BRAND.bgSoft : undefined,
  })),
});

// 横棒線（区切り）
const hr = () => new Paragraph({
  spacing: { before: 40, after: 80 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.cyan, space: 6 } },
  children: [new TextRun({ text: "", font: FONT })],
});

// 外部リンク
const linkPara = (label, url) => new Paragraph({
  spacing: { after: 80 },
  children: [
    new TextRun({ text: label + " ", font: FONT, size: 22, color: BRAND.inkSoft }),
    new ExternalHyperlink({
      link: url,
      children: [new TextRun({ text: url, font: FONT, size: 22, color: BRAND.blue, underline: { color: BRAND.blue } })],
    }),
  ],
});

/* =============================================================
 * ドキュメント本体
 * ============================================================= */

const CONTENT_WIDTH = 11906 - 1417 - 1417; // A4幅 - 左右余白 ≈ 9072 DXA

const cover = [
  ...spacers(6),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "技術仕様書", font: FONT, size: 28, bold: true, color: BRAND.cyan })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "大学受験 学習マネジメント", font: FONT, size: 56, bold: true, color: BRAND.navy })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text: "ダッシュボード", font: FONT, size: 56, bold: true, color: BRAND.navy })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    border: { top: { style: BorderStyle.SINGLE, size: 12, color: BRAND.blue, space: 12 },
              bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND.blue, space: 12 } },
    children: [new TextRun({ text: " Claude 協力者向け  /  Edition 1.0 ", font: FONT, size: 22, color: BRAND.blue, bold: true })],
  }),
  ...spacers(10),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "BizteX 株式会社", font: FONT, size: 22, bold: true, color: BRAND.navy })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "嶋田 光敏 / m.shimada@biztex.co.jp", font: FONT, size: 20, color: BRAND.inkSoft })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

const tocSection = [
  H1("目次"),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 1. アプリ概要 ---------- */
const section1 = [
  H1("1. アプリ概要"),
  P("「合格」というゴールに対し、計画・進捗・生活を一元管理する受験版プロジェクトマネージャー。家庭教師アプリではなく『管理』に徹する設計思想。"),

  H2("1.1 アプリ情報"),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2500, CONTENT_WIDTH - 2500],
    rows: [
      headerRow(["項目", "内容"], [2500, CONTENT_WIDTH - 2500]),
      dataRow(["名前", "大学受験 学習マネジメント ダッシュボード"], [2500, CONTENT_WIDTH - 2500]),
      dataRow(["公開URL", "https://rn-juken-dashboard-2026.netlify.app/"], [2500, CONTENT_WIDTH - 2500], true),
      dataRow(["リポジトリ", "https://github.com/MITSUTOSHI-SHIMADA/juken-dashboard"], [2500, CONTENT_WIDTH - 2500]),
      dataRow(["目的", "高3受験生の合格マネジメント。解き方や答えは扱わない"], [2500, CONTENT_WIDTH - 2500], true),
      dataRow(["想定ユーザー", "親（45歳女性）と本人（高3）。タブで2ビュー切替"], [2500, CONTENT_WIDTH - 2500]),
      dataRow(["ホスティング", "Netlify（メイン） / GitHub Pages（バックアップ）"], [2500, CONTENT_WIDTH - 2500], true),
    ],
  }),
  spacer(),

  H2("1.2 最新コードの取得URL（協力者のClaudeが読みに行く）"),
  P("依頼者のClaudeが最新コードを読むために、下記の raw URL から取得します。"),
  linkPara("HTML:", "https://raw.githubusercontent.com/MITSUTOSHI-SHIMADA/juken-dashboard/main/index.html"),
  linkPara("ロジック:", "https://raw.githubusercontent.com/MITSUTOSHI-SHIMADA/juken-dashboard/main/app.js"),
  linkPara("データ:", "https://raw.githubusercontent.com/MITSUTOSHI-SHIMADA/juken-dashboard/main/data.js"),
  linkPara("スタイル:", "https://raw.githubusercontent.com/MITSUTOSHI-SHIMADA/juken-dashboard/main/styles.css"),
  linkPara("README:", "https://raw.githubusercontent.com/MITSUTOSHI-SHIMADA/juken-dashboard/main/README.md"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 2. ファイル構成 ---------- */
const section2 = [
  H1("2. ファイル構成と責務"),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [3000, CONTENT_WIDTH - 3000],
    rows: [
      headerRow(["ファイル", "役割"], [3000, CONTENT_WIDTH - 3000]),
      dataRow(["index.html", "画面の骨組み（タブ、ヘッダー、ビュー領域）。インライン属性禁止"], [3000, CONTENT_WIDTH - 3000]),
      dataRow(["styles.css", "全スタイル。CSS変数でデザイントークン管理"], [3000, CONTENT_WIDTH - 3000], true),
      dataRow(["data.js", "初期データ（window.STUDENT_DATA）。schemaVersionで互換判定"], [3000, CONTENT_WIDTH - 3000]),
      dataRow(["app.js", "表示ロジック・状態管理・イベント委譲"], [3000, CONTENT_WIDTH - 3000], true),
      dataRow(["_headers / netlify.toml / vercel.json", "セキュリティヘッダ設定（CSP・X-Frame等）"], [3000, CONTENT_WIDTH - 3000]),
      dataRow(["robots.txt", "検索エンジンnoindex"], [3000, CONTENT_WIDTH - 3000], true),
      dataRow(["docs/FOR-FRIEND.md", "協力者本人向けの人間用ガイド"], [3000, CONTENT_WIDTH - 3000]),
      dataRow(["docs/CLAUDE-SPEC.md", "協力者のClaudeに渡す技術仕様（本書のMarkdown版）"], [3000, CONTENT_WIDTH - 3000], true),
    ],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 3. 設計思想 ---------- */
const section3 = [
  H1("3. 設計思想（最重要）"),
  P("このアプリは下記5つの設計思想で貫かれています。修正時もこの思想を維持してください。"),
  numbered("「管理」に徹する：問題の解き方・答え・解説は一切扱わない。受験版プロジェクトマネージャー"),
  numbered("2ビュー構成：親ビュー（マネジメント視点）と本人ビュー（フォーカス視点）"),
  numbered("動的・永続化：操作内容はブラウザのlocalStorageに保存"),
  numbered("同じ関数を両ビューで再利用：データの食い違いが構造的に起きない作り"),
  numbered("データ駆動：data.jsを差し替えれば本番値に近づく"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 4. デザイントークン ---------- */
const section4 = [
  H1("4. デザイントークン（45歳女性向け）"),
  P("styles.css の :root に定義されているCSS変数。色を変える依頼ではこれらを調整します。"),

  H2("4.1 ブランド色"),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2400, 2000, CONTENT_WIDTH - 4400],
    rows: [
      headerRow(["トークン", "値", "用途"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--brand", "#a8527f", "プラム×ローズ。上品で落ち着いた印象"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--brand-dark", "#813c63", "ヘッダー・強調"], [2400, 2000, CONTENT_WIDTH - 4400], true),
      dataRow(["--brand-soft", "#f8ecf3", "アクティブ状態の薄い背景"], [2400, 2000, CONTENT_WIDTH - 4400]),
    ],
  }),
  spacer(),

  H2("4.2 信号色（状態識別）"),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2400, 2000, CONTENT_WIDTH - 4400],
    rows: [
      headerRow(["トークン", "値", "用途"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--green", "#3a9b73", "間に合う・順調"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--yellow", "#cf8a2e", "やや遅れ・要管理"], [2400, 2000, CONTENT_WIDTH - 4400], true),
      dataRow(["--red", "#d6596c", "遅れ・要対応"], [2400, 2000, CONTENT_WIDTH - 4400]),
    ],
  }),
  P("注意：明度差は必ず保つこと（状態識別のため）。", { italics: true, color: BRAND.ngRed }),
  spacer(),

  H2("4.3 文字・背景"),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [2400, 2000, CONTENT_WIDTH - 4400],
    rows: [
      headerRow(["トークン", "値", "用途"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--ink", "#3b2d36", "本文文字（温かみダークブラウン）"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--ink-soft", "#6f5f68", "副次的文字"], [2400, 2000, CONTENT_WIDTH - 4400], true),
      dataRow(["--ink-faint", "#ab9ba4", "薄い文字"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--bg", "#f8f2f5", "背景（blushグレー）"], [2400, 2000, CONTENT_WIDTH - 4400], true),
      dataRow(["--card", "#ffffff", "カード背景"], [2400, 2000, CONTENT_WIDTH - 4400]),
      dataRow(["--line", "#ecdfe6", "罫線"], [2400, 2000, CONTENT_WIDTH - 4400], true),
    ],
  }),
  spacer(),

  H2("4.4 色を変える依頼への方針"),
  bullet("「ピンクっぽくしたい」→ 派手なピンクは避け、ローズ寄りで明度を上げる"),
  bullet("「暗くしたい/明るくしたい」→ --brand と --brand-dark の明度を調整"),
  bullet("子どもっぽい色（蛍光・ビビッド・パステル系）は避ける"),
  bullet("信号色の緑/黄/赤の明度差は必ず保つ（状態判別のため）"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 5. 状態管理 ---------- */
const section5 = [
  H1("5. 状態管理"),
  bullet("鍵：localStorage の \"uni-exam-pm-state\""),
  bullet("構造：data.js の STUDENT_DATA から派生"),
  bullet("schemaVersion で古いデータの自動破棄判定"),
  Pmix([
    { text: "重要：", bold: true, color: BRAND.ngRed },
    { text: "データ構造を変更したら必ず schemaVersion をバンプしてください。", color: BRAND.ngRed },
  ]),
  P("バンプしないと古い保存データと新構造が混在してバグの温床になります。"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 6. 主要機能 ---------- */
const section6 = [
  H1("6. 主要機能（既存）"),

  H2("6.1 親ビュー"),
  numbered("ヘッダーサマリー：第一志望／二次試験までのカウントダウン／総合判定（D→C→C推移）"),
  numbered("合格逆算パネル：偏差値ギャップ／必要学習時間／確保可能時間／充足率"),
  numbered("科目別進捗：教材ごとの周回率と信号（緑/黄/赤）。+1/+10/-1 で更新可能"),
  numbered("今日のタイムテーブル：固定/学習/自由の3タイプ。✏️編集・🗑️削除・＋追加が可能"),
  numbered("解き直しキュー：○△×で採点（忘却曲線で次回出題日が変わる）。＋追加・🗑️削除可"),
  numbered("週次レビュー：計画vs実績／科目別ステータス／積み残し／アラート"),

  H2("6.2 本人ビュー"),
  bullet("親ビューの主要パネル（ヘッダー・合格逆算・科目別進捗）を再利用"),
  bullet("「今日のタスク」進捗ゲージ"),
  bullet("今日のタイムテーブル（閲覧専用）"),
  bullet("今日解く問題リスト（タップでチェック可能）"),

  H2("6.3 共通機能"),
  bullet("↺リセットボタン（confirmで初期データに戻す）"),
  bullet("フラッシュメッセージ（操作のフィードバック）"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 7. 編集時の絶対ルール ---------- */
const section7 = [
  H1("7. 編集時の絶対ルール"),
  Pmix([
    { text: "これを破ると本番が壊れます。", bold: true, color: BRAND.ngRed },
  ]),

  H2("7.1 絶対NG"),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [3200, CONTENT_WIDTH - 3200],
    rows: [
      headerRow(["禁止事項", "理由・対処"], [3200, CONTENT_WIDTH - 3200]),
      dataRow(["インライン JS/CSS を書かない", "<script>...</script>、onclick=、style= はCSP違反。app.js / styles.css に外出し"], [3200, CONTENT_WIDTH - 3200]),
      dataRow(["外部CDN・外部API・外部フォントを使わない", "Google Fonts / jQuery / React 等 ❌。connect-src 'self' で遮断"], [3200, CONTENT_WIDTH - 3200], true),
      dataRow(["innerHTML に動的な値を入れない", "XSS防止。textContent / createElement / el() ヘルパーを使う"], [3200, CONTENT_WIDTH - 3200]),
      dataRow(["localStorage 以外のストレージを使わない", "cookie / sessionStorage / IndexedDB は不可。キーは uni-exam-pm-state のみ"], [3200, CONTENT_WIDTH - 3200], true),
      dataRow(["問題の解き方・答え・解説を実装しない", "設計思想に反する。代替（解き直し管理・励まし）で提案"], [3200, CONTENT_WIDTH - 3200]),
    ],
  }),
  spacer(),

  H2("7.2 推奨パターン"),
  bullet("DOM構築は el(tag, opts, children) ヘルパーで行う"),
  bullet('イベントは data-action="..." 属性 + body委譲（既存パターンに合わせる）'),
  bullet("状態を変えたら必ず save() → renderAll() の順で呼ぶ"),
  bullet("大きい数字は .bignum クラス、信号は .sig.sig--green/yellow/red"),
  bullet("ゲージは gauge(pct, \"bar-green\") などの既存ヘルパー"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 8. 出力フォーマット ---------- */
const section8 = [
  H1("8. 出力フォーマット（依頼者への返答）"),
  P("修正版を返すときは、必ず下記の形式で返答してください："),
  code("## 変更した内容"),
  code("〔1〜2文の日本語要約〕"),
  code(""),
  code("## 変更したファイル"),
  code("- 〔ファイル名〕（理由：〇〇）"),
  code(""),
  code("## 修正版コード"),
  code(""),
  code("### 〔ファイル名〕"),
  code("```"),
  code("（全文を貼る。部分差分ではダメ）"),
  code("```"),
  code(""),
  code("## 嶋田さんへのメッセージ"),
  code("〔嶋田さんが自分のClaudeにそのまま渡せる指示文〕"),

  spacer(),
  Pmix([
    { text: "理由：", bold: true, color: BRAND.blue },
    { text: "受け取った嶋田さんが、自分のClaudeに『これに置き換えてpush』と頼むだけで反映できる必要があります。" },
  ]),
  Pmix([
    { text: "部分的なdiff・抜粋ではダメ", bold: true, color: BRAND.ngRed },
    { text: "（コピペで反映できないため）。" },
  ]),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 9. よくある依頼パターン ---------- */
const section9 = [
  H1("9. よくある依頼パターンと対応例"),

  H3("例1：ヘッダーの色をもう少し優しい雰囲気に"),
  P("→ styles.css の --brand / --brand-dark / .app-header のグラデーションを調整。ピンク方向ではなく、ローズ→ピーチ寄りに明度を上げるのが上品。"),

  H3("例2：タイムテーブルにメモ欄を追加したい"),
  P("→ data.js の todaySchedule の各スロットに memo フィールド追加。app.js の renderTimetable() 内でメモ表示。schemaVersion をバンプ。"),

  H3("例3：教材を1冊追加したい"),
  P("→ data.js の materials 配列に1要素追加。schemaVersion をバンプ。依頼者が data.js の中身を知らない場合は、サンプルのまま追加して「実値はあとで嶋田さんが差し替える前提」と添える。"),

  H3("例4：スマホで見にくい"),
  P("→ styles.css のレスポンシブ調整。@media (max-width: 820px) の既存ブレークポイントを活用。"),

  H3("例5：アラート機能を追加して（通知API使用）"),
  P("→ Web Notifications API は CSP と相性が悪いため避ける。代替で「今が学習時間です」表示・色変化・フラッシュメッセージで対応提案。"),

  H3("例6：データを暗号化して保存して"),
  P("→ localStorage に保存する内容は学習進捗のみ・PIIなし。過剰実装になるため不要と説明。本気で必要なら別途相談を促す。"),

  H3("例7：この問題の解き方を表示する機能を"),
  Pmix([
    { text: "→ 設計思想に反します。", bold: true, color: BRAND.ngRed },
    { text: "丁寧に断り、代替（解き直しタイマー、ヒント教材へのリンク等）を提案。" },
  ]),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 10. 困ったとき & 最初の応答 ---------- */
const section10 = [
  H1("10. 困ったとき & 依頼者への最初の応答"),

  H2("10.1 困ったときのルール"),
  bullet("不明点があったら推測でコードを書かない。依頼者にやさしく質問する"),
  bullet("ルール違反の依頼は、理由を丁寧に説明し代替案を1〜2個提示する"),
  bullet("依頼者は専門用語が分からない。「CSP」「DOM」「innerHTML」等を使わず、「セキュリティ上の理由で」「画面の作り方の決まりで」と言い換える"),

  H2("10.2 最初の確認メッセージ（テンプレート）"),
  P("依頼者から本書を受け取ったら、最初に下記のような返答をしてください："),
  code("了解しました！どこを直したいですか？"),
  code("自然な日本語で教えてください 😊"),
  new Paragraph({ children: [new PageBreak()] }),
];

/* ---------- 付録：URL集 ---------- */
const appendix = [
  H1("付録：URL集"),

  H2("公開URL"),
  linkPara("正式公開URL：", "https://rn-juken-dashboard-2026.netlify.app/"),
  linkPara("バックアップ：", "https://mitsutoshi-shimada.github.io/juken-dashboard/"),

  H2("ソースコード"),
  linkPara("リポジトリ：", "https://github.com/MITSUTOSHI-SHIMADA/juken-dashboard"),

  H2("ドキュメント"),
  linkPara("協力者本人向け：", "https://github.com/MITSUTOSHI-SHIMADA/juken-dashboard/blob/main/docs/FOR-FRIEND.md"),
  linkPara("本書（MD版）：", "https://raw.githubusercontent.com/MITSUTOSHI-SHIMADA/juken-dashboard/main/docs/CLAUDE-SPEC.md"),

  H2("お問い合わせ"),
  P("BizteX 株式会社 / 嶋田 光敏"),
  P("Email: m.shimada@biztex.co.jp"),

  ...spacers(2),
  hr(),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "© BizteX Inc. 2026", font: FONT, size: 18, color: BRAND.inkSoft })],
  }),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22, color: BRAND.inkSoft } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: FONT, color: BRAND.navy },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: BRAND.blue },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: BRAND.cyan },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1417, right: 1417, bottom: 1417, left: 1417 }, // 約25mm
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.blue, space: 4 } },
          children: [new TextRun({
            text: "受験ダッシュボード 技術仕様書",
            font: FONT, size: 18, color: BRAND.blue, bold: true,
          })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "BizteX Inc.  /  ", font: FONT, size: 18, color: BRAND.inkSoft }),
            new TextRun({ text: "Page ", font: FONT, size: 18, color: BRAND.inkSoft }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: BRAND.inkSoft }),
            new TextRun({ text: " / ", font: FONT, size: 18, color: BRAND.inkSoft }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: BRAND.inkSoft }),
          ],
        })],
      }),
    },
    children: [
      ...cover,
      ...tocSection,
      ...section1,
      ...section2,
      ...section3,
      ...section4,
      ...section5,
      ...section6,
      ...section7,
      ...section8,
      ...section9,
      ...section10,
      ...appendix,
    ],
  }],
});

const outPath = path.join(__dirname, "..", "docs", "受験ダッシュボード_技術仕様書.docx");
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log("✓ Created:", outPath);
  console.log("  Size:", (buffer.length / 1024).toFixed(1), "KB");
});
