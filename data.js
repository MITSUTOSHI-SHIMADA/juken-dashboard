/* =============================================================
 * 大学受験 学習マネジメントアプリ — シード（初期）データ
 * -------------------------------------------------------------
 * 「管理」に徹する受験版プロジェクトマネージャー。
 * 問題の解き方・答えは一切扱わない。
 *
 * このデータは初期値（シード）。アプリ起動後はユーザー操作で
 * 状態が変化し、ブラウザ（localStorage）に保存される。
 * 「リセット」でこのシードに戻る。すべてダミー値。
 * ============================================================= */
window.STUDENT_DATA = {
  // スキーマのバージョン（保存データの互換判定に使用）
  schemaVersion: 4,

  // ===== 基本情報 =====
  profile: {
    name: "息子",
    grade: "高3",
    examType: "大学受験（国公立・理系）",
  },

  // モックを「いつ開いても同じ起点」にする基準日。null で当日。
  referenceDate: "2026-06-06",

  // ===== 志望校 =====
  schools: [
    {
      name: "第一志望大学 工学部",
      priority: 1,
      examDate: "2027-02-25", // 個別（二次）試験
      commonTestDate: "2027-01-16", // 共通テスト
      passLineDeviation: 62,
      passLineScoreRate: 0.68, // 二次得点率の合格ライン目安
      commonTestTargetRate: 0.78, // 共通テスト得点率の目標
    },
    {
      name: "第二志望大学 理工学部",
      priority: 2,
      examDate: "2027-02-10",
      commonTestDate: "2027-01-16",
      passLineDeviation: 57,
      passLineScoreRate: 0.62,
      commonTestTargetRate: 0.72,
    },
  ],

  // ===== 成績・模試（直近3回：河合塾 全統記述模試 想定） =====
  examResults: [
    {
      date: "2026-04-19",
      name: "第1回 全統記述模試",
      subjects: {
        英語: { score: 118, max: 200, deviation: 58 },
        数学: { score: 92, max: 200, deviation: 52 },
        国語: { score: 102, max: 200, deviation: 56 },
        物理: { score: 41, max: 100, deviation: 50 },
        化学: { score: 48, max: 100, deviation: 53 },
      },
      grade: "D",
      judgement: "第一志望: D判定（合格可能性 25%）",
      passProbability: 0.25,
    },
    {
      date: "2026-05-24",
      name: "第2回 全統記述模試",
      subjects: {
        英語: { score: 126, max: 200, deviation: 59 },
        数学: { score: 101, max: 200, deviation: 54 },
        国語: { score: 108, max: 200, deviation: 57 },
        物理: { score: 48, max: 100, deviation: 52 },
        化学: { score: 53, max: 100, deviation: 55 },
      },
      grade: "C",
      judgement: "第一志望: C判定（合格可能性 35%）",
      passProbability: 0.35,
    },
    {
      date: "2026-06-28",
      name: "第3回 全統記述模試",
      subjects: {
        英語: { score: 132, max: 200, deviation: 60 },
        数学: { score: 108, max: 200, deviation: 55 },
        国語: { score: 113, max: 200, deviation: 58 },
        物理: { score: 52, max: 100, deviation: 53 },
        化学: { score: 57, max: 100, deviation: 56 },
      },
      grade: "C",
      judgement: "第一志望: C判定（合格可能性 42%）",
      passProbability: 0.42,
    },
  ],
  // → 弱点は物理・数学。英語は安定。志望校偏差値62に対し全科目ギャップあり

  // ===== ライフスタイル =====
  lifestyle: {
    wakeUp: "06:30",
    sleep: "23:30",
    commute: { toSchool: 35, fromSchool: 35 },
    schoolHours: { start: "08:40", end: "15:30" },
    cram: [
      // 予備校
      { day: "火", subject: "数学（ハイレベル理系）", start: "18:30", end: "21:00" },
      { day: "木", subject: "物理・化学", start: "18:30", end: "21:00" },
      { day: "土", subject: "英語・共通テスト演習", start: "16:00", end: "21:00" },
    ],
    lessons: [],
    meals: { breakfast: "07:00", dinner: "18:30" },
  },

  // ===== 教材リスト =====
  // status は起動時に「予定ペース vs 実績」から自動算出される（seed値は初期表示用）
  materials: [
    { id: "m1", subject: "英語", name: "システム英単語", totalProblems: 200, completed: 150, targetDate: "2026-09-30", status: "green" },
    { id: "m2", subject: "英語", name: "Vintage 英文法・語法", totalProblems: 1400, completed: 700, targetDate: "2026-10-31", status: "green" },
    { id: "m3", subject: "数学", name: "青チャート 数学III", totalProblems: 250, completed: 55, targetDate: "2026-11-30", status: "yellow" },
    { id: "m4", subject: "物理", name: "名問の森 物理（力学・電磁気）", totalProblems: 280, completed: 28, targetDate: "2026-12-15", status: "red" },
    { id: "m5", subject: "化学", name: "化学 重要問題集", totalProblems: 250, completed: 50, targetDate: "2026-12-20", status: "yellow" },
    { id: "m6", subject: "国語", name: "古文単語・古典文法", totalProblems: 330, completed: 240, targetDate: "2027-01-10", status: "green" },
  ],

  // ===== 解き直しキュー（間隔反復／忘却曲線ベース） =====
  // intervalStage: 0=初回,1=翌日,2=3日後,3=1週間後,4=2週間後,5=1ヶ月後
  reviewQueue: [
    { id: "r1", subject: "数学", material: "青チャートIII", problem: "微分法の応用 例題128（最大最小）", lastResult: "×", intervalStage: 1, nextDate: "2026-06-06", priority: "高", mastered: false },
    { id: "r2", subject: "物理", material: "名問の森", problem: "力学 問15（斜面と摩擦・運動方程式）", lastResult: "×", intervalStage: 1, nextDate: "2026-06-06", priority: "高", mastered: false },
    { id: "r3", subject: "物理", material: "名問の森", problem: "電磁気 問42（コンデンサー回路）", lastResult: "△", intervalStage: 2, nextDate: "2026-06-06", priority: "高", mastered: false },
    { id: "r4", subject: "化学", material: "重要問題集", problem: "化学平衡 問142（平衡定数の計算）", lastResult: "△", intervalStage: 2, nextDate: "2026-06-06", priority: "中", mastered: false },
    { id: "r5", subject: "数学", material: "青チャートIII", problem: "数列の極限 例題95", lastResult: "○", intervalStage: 3, nextDate: "2026-06-06", priority: "中", mastered: false },
    { id: "r6", subject: "英語", material: "英語長文ポラリス3", problem: "Unit7 設問4（語彙推測）", lastResult: "○", intervalStage: 4, nextDate: "2026-06-06", priority: "低", mastered: false },
    { id: "r7", subject: "国語", material: "古典文法", problem: "助動詞「べし」の識別 P.58", lastResult: "○", intervalStage: 4, nextDate: "2026-06-06", priority: "低", mastered: false },
  ],

  // ===== 今日のタイムテーブル（例: 平日・予備校なし日） =====
  // type: fixed=固定予定, study=学習ブロック, free=自由
  todaySchedule: [
    { start: "06:30", end: "07:00", type: "fixed", label: "起床・身支度" },
    { start: "07:00", end: "07:30", type: "fixed", label: "朝食" },
    { start: "07:30", end: "07:55", type: "study", label: "朝学習: 英単語・古文単語", problems: ["r6", "r7"] },
    { start: "08:40", end: "15:30", type: "fixed", label: "学校" },
    { start: "16:15", end: "17:15", type: "study", label: "解き直し（最優先・数学／物理）", problems: ["r1", "r2"] },
    { start: "17:15", end: "17:30", type: "free", label: "休憩" },
    { start: "17:30", end: "18:30", type: "study", label: "物理 弱点補強", problems: ["r3"] },
    { start: "18:30", end: "19:15", type: "fixed", label: "夕食" },
    { start: "19:15", end: "20:45", type: "study", label: "化学 演習", problems: ["r4"] },
    { start: "20:45", end: "21:00", type: "free", label: "休憩" },
    { start: "21:00", end: "22:15", type: "study", label: "数学 演習（青チャートIII）", problems: ["r5"] },
    { start: "22:15", end: "23:00", type: "free", label: "自由時間" },
    { start: "23:00", end: "23:30", type: "fixed", label: "入浴・就寝準備" },
  ],

  // ===== 週次レビュー（先週分・日曜夜生成） =====
  weeklyReview: {
    weekOf: "2026-05-30〜2026-06-05",
    planned: { problems: 110, studyHours: 28 },
    actual: { problems: 86, studyHours: 22 },
    completionRate: 0.78,
    carryOver: [
      { subject: "物理", problem: "名問の森 電磁気 問45（電磁誘導）", reason: "未着手" },
      { subject: "数学", problem: "青チャートIII 積分法 例題150-153", reason: "時間切れ" },
      { subject: "化学", problem: "重要問題集 反応速度 問128", reason: "未着手" },
    ],
    alert: "物理の遅れが2週連続。来週は物理の配分を+45分/日に。共テまで残り約7ヶ月、基礎固めは夏が最終リミット。",
    subjectStatus: { 英語: "順調", 数学: "やや遅れ", 国語: "順調", 物理: "遅れ", 化学: "やや遅れ" },
  },

  // ===== 逆算ロジックの調整パラメータ（モデル試算用） =====
  calcConfig: {
    // 偏差値ギャップ1ポイントを埋める想定学習時間（科目あたり/時間）
    hoursPerDeviationPoint: 46,
    // 1週間あたりの確保可能学習時間（ライフスタイルから概算）
    availableHoursPerWeek: 31,
    // 教材ペース判定の起点（この日から targetDate までを直線計画とみなす）
    planStart: "2026-04-01",
  },
};
