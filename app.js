/* =============================================================
 * 大学受験 学習マネジメント — SaaS版
 * -------------------------------------------------------------
 * 設計：
 *  - サイドバー + メインの SaaS スタイル
 *  - ページごとにレンダラ分割（overview / schools / subjects / today /
 *    review / weekly / settings）
 *  - 状態は SECURITY モジュール経由で暗号化保存（パスコード設定時）
 *  - 平文時は localStorage(平文) に直接保存
 *  - 外部API/CDN/外部フォントは一切使わない
 *  - DOMは textContent / createElement で構築
 * ============================================================= */
(function () {
  "use strict";

  const SEED = window.STUDENT_DATA;
  const SECURITY = window.SECURITY;

  /* ---------- 定数 ---------- */
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  const STAGE_LABELS = ["初回", "翌日", "3日後", "1週間後", "2週間後", "1ヶ月後"];
  const MAX_STAGE = INTERVALS.length - 1;
  const SUBJECTS = ["英語", "数学", "国語", "物理", "化学"];

  const PAGES = [
    { id: "overview", label: "ダッシュボード", icon: "📊", roles: ["parent", "kid"] },
    { id: "schools",  label: "志望校・目標",   icon: "🎯", roles: ["parent"] },
    { id: "subjects", label: "科目・成績",     icon: "📚", roles: ["parent", "kid"] },
    { id: "today",    label: "今日のタスク",   icon: "📅", roles: ["parent", "kid"] },
    { id: "review",   label: "解き直しキュー", icon: "🔁", roles: ["parent", "kid"] },
    { id: "weekly",   label: "週次レビュー",   icon: "📈", roles: ["parent", "kid"] },
    { id: "settings", label: "設定",           icon: "⚙️", roles: ["parent"] },
  ];

  /* =============================================================
   * 共通ユーティリティ
   * ============================================================= */

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0)) : null;
  }
  function fmtDate(d) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + mo + "-" + da;
  }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function toMin(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t));
    return m ? +m[1] * 60 + +m[2] : 0;
  }
  function today() {
    if (SEED.referenceDate) return parseDate(SEED.referenceDate);
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), 12));
  }
  function todayISO() { return fmtDate(today()); }

  // DOM ビルダー
  function el(tag, opts, children) {
    const n = document.createElement(tag);
    if (opts) {
      if (opts.class) n.className = opts.class;
      if (opts.text != null) n.textContent = opts.text;
      if (opts.html != null) n.innerHTML = opts.html; // 内部生成の安全文字列のみ
      if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { n.setAttribute(k, opts.attrs[k]); });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function card(titleHtml, bodyNodes) {
    const c = el("section", { class: "card" });
    if (titleHtml) c.appendChild(el("h3", { class: "card__title", html: titleHtml }));
    (bodyNodes || []).forEach(function (n) { if (n) c.appendChild(n); });
    return c;
  }
  function btn(label, action, dataset, cls) {
    const attrs = { type: "button", "data-action": action };
    Object.keys(dataset || {}).forEach(function (k) { attrs["data-" + k] = dataset[k]; });
    return el("button", { class: cls || "btn", text: label, attrs: attrs });
  }
  function iconBtn(label, action, dataset, title) {
    const attrs = { type: "button", "data-action": action };
    Object.keys(dataset || {}).forEach(function (k) { attrs["data-" + k] = dataset[k]; });
    if (title) attrs.title = title;
    return el("button", { class: "icon-btn", text: label, attrs: attrs });
  }
  function gauge(pct, cls) {
    const g = el("div", { class: "gauge " + (cls || "bar-brand") });
    g.appendChild(el("span", { attrs: { style: "width:" + clamp(pct, 0, 100) + "%" } }));
    return g;
  }
  function sig(status, labels) {
    const map = labels || { green: "間に合う", yellow: "やや遅れ", red: "遅れ" };
    return el("span", { class: "sig sig--" + status, text: map[status] || status });
  }
  function stageDots(stage) {
    const w = el("span", { class: "stage-dots", attrs: { title: "ステージ " + stage + "/" + MAX_STAGE } });
    for (let i = 0; i <= MAX_STAGE; i++) w.appendChild(el("i", { class: i <= stage ? "on" : "" }));
    return w;
  }

  /* =============================================================
   * 状態管理
   * ============================================================= */

  let state;
  let currentPasscode = null; // メモリ上のみ（ロック解除中だけ保持）

  function seedState() {
    const sched = deepClone(SEED.todaySchedule);
    let nextSlotId = 1;
    sched.forEach(function (s) { s.id = "s" + nextSlotId++; });
    const queue = deepClone(SEED.reviewQueue);
    const maxR = queue.reduce(function (m, r) {
      const n = parseInt(String(r.id).slice(1), 10);
      return isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return {
      schemaVersion: 5,
      profile:     deepClone(SEED.profile),
      schools:     deepClone(SEED.schools),
      examResults: deepClone(SEED.examResults),
      lifestyle:   deepClone(SEED.lifestyle),
      materials:   deepClone(SEED.materials),
      reviewQueue: queue,
      todaySchedule: sched,
      weeklyReview: deepClone(SEED.weeklyReview),
      calcConfig:  deepClone(SEED.calcConfig),
      nextSlotId: nextSlotId,
      nextProblemId: maxR + 1,
      nextSchoolId: SEED.schools.length + 1,
      nextMaterialId: SEED.materials.length + 1,
      completedToday: {},
      settings: { role: "parent" },
      lastSaved: null,
    };
  }

  async function saveState() {
    if (!state) return;
    state.lastSaved = new Date().toISOString();
    try { await SECURITY.saveState(state, currentPasscode); }
    catch (e) { console.error("save failed:", e); }
  }

  async function loadInitial() {
    try {
      const raw = await SECURITY.loadState(currentPasscode);
      if (!raw) return null;
      if (raw.schemaVersion !== 5) return null;
      return raw;
    } catch (e) { return null; }
  }

  /* =============================================================
   * 派生計算
   * ============================================================= */

  function primarySchool() {
    return state.schools.slice().sort(function (a, b) { return a.priority - b.priority; })[0];
  }
  function latestExam() {
    return state.examResults.slice()
      .sort(function (a, b) { return parseDate(a.date) - parseDate(b.date); })
      .slice(-1)[0];
  }
  function reverseCalc() {
    const school = primarySchool();
    if (!school) return null;
    const exam = latestExam();
    const cfg = state.calcConfig;
    const days = Math.max(0, daysBetween(today(), parseDate(school.examDate)));
    const gaps = SUBJECTS.map(function (s) {
      const dev = exam && exam.subjects[s] ? exam.subjects[s].deviation : 0;
      return { subject: s, deviation: dev, gap: Math.max(0, school.passLineDeviation - dev) };
    });
    const totalGap = gaps.reduce(function (a, g) { return a + g.gap; }, 0);
    const requiredHours = Math.round(totalGap * cfg.hoursPerDeviationPoint);
    const capacityHours = Math.round((days / 7) * cfg.availableHoursPerWeek);
    const fillRate = requiredHours > 0 ? capacityHours / requiredHours : 1;
    const allocations = gaps.map(function (g) {
      return {
        subject: g.subject, gap: g.gap,
        hours: totalGap > 0 ? Math.round((g.gap / totalGap) * requiredHours) : 0,
      };
    });
    return { school, days, gaps, totalGap, requiredHours, capacityHours, fillRate, allocations, exam };
  }
  function fillRateSignal(rate) {
    const p = Math.round(rate * 100);
    if (p >= 100) return "green";
    if (p >= 80) return "yellow";
    return "red";
  }
  function materialSignal(m) {
    const start = parseDate(state.calcConfig.planStart);
    const target = parseDate(m.targetDate);
    const now = today();
    const span = Math.max(1, daysBetween(start, target));
    const idealPct = clamp(daysBetween(start, now) / span, 0, 1);
    const actualPct = m.totalProblems > 0 ? m.completed / m.totalProblems : 0;
    const diff = actualPct - idealPct;
    if (actualPct >= 1) return "green";
    if (diff >= -0.03) return "green";
    if (diff >= -0.15) return "yellow";
    return "red";
  }
  function activeQueue() { return state.reviewQueue.filter(function (r) { return !r.mastered; }); }
  function dueToday() {
    const t = today();
    return activeQueue().filter(function (r) {
      const d = parseDate(r.nextDate);
      return d && daysBetween(d, t) >= 0;
    });
  }
  function reviewById(id) { return state.reviewQueue.find(function (r) { return r.id === id; }); }
  function masteredCount() { return state.reviewQueue.filter(function (r) { return r.mastered; }).length; }
  function todayProblemIds() {
    const ids = [];
    state.todaySchedule.forEach(function (s) {
      (s.problems || []).forEach(function (p) { if (ids.indexOf(p) < 0) ids.push(p); });
    });
    return ids;
  }
  function todayProgress() {
    const ids = todayProblemIds();
    const done = ids.filter(function (id) { return state.completedToday[id]; }).length;
    return { done: done, total: ids.length };
  }

  /* =============================================================
   * ミューテーション
   * ============================================================= */

  async function gradeReview(id, result) {
    const r = reviewById(id);
    if (!r || r.mastered) return;
    const base = today();
    let nextDays;
    if (result === "○") {
      if (r.intervalStage >= MAX_STAGE) {
        r.mastered = true;
        r.lastResult = "○";
        state.completedToday[id] = true;
        await saveState(); render();
        flash(r.subject + "「" + r.problem + "」を習得済みに 🎉");
        return;
      }
      r.intervalStage = Math.min(MAX_STAGE, r.intervalStage + 1);
      r.priority = r.intervalStage >= 4 ? "低" : "中";
      nextDays = INTERVALS[r.intervalStage];
    } else if (result === "△") {
      nextDays = Math.max(1, INTERVALS[r.intervalStage]);
      r.priority = "中";
    } else {
      r.intervalStage = 1;
      nextDays = INTERVALS[1];
      r.priority = "高";
    }
    r.lastResult = result;
    r.nextDate = fmtDate(addDays(base, nextDays));
    state.completedToday[id] = true;
    await saveState(); render();
    flash(r.subject + "を「" + result + "」で採点 → 次回 " + r.nextDate);
  }

  async function toggleProblem(id) {
    if (state.completedToday[id]) delete state.completedToday[id];
    else state.completedToday[id] = true;
    await saveState(); render();
  }
  async function bumpMaterial(id, delta) {
    const m = state.materials.find(function (x) { return x.id === id; });
    if (!m) return;
    m.completed = clamp(m.completed + delta, 0, m.totalProblems);
    await saveState(); render();
  }

  /* ---------- スロット CRUD ---------- */
  function slotById(id) { return state.todaySchedule.find(function (s) { return s.id === id; }); }
  function sortSchedule() {
    state.todaySchedule.sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
  }
  async function saveSlot(values, id) {
    if (!values.start || !values.end || !values.label) { flash("時間とラベルを入力してください"); return false; }
    if (toMin(values.end) <= toMin(values.start)) { flash("終了時刻は開始より後にしてください"); return false; }
    if (id) {
      const s = slotById(id); if (!s) return false;
      s.start = values.start; s.end = values.end;
      s.type = values.type; s.label = values.label;
      s.problems = values.type === "study" ? (values.problems || []) : [];
    } else {
      state.todaySchedule.push({
        id: "s" + state.nextSlotId++,
        start: values.start, end: values.end, type: values.type, label: values.label,
        problems: values.type === "study" ? (values.problems || []) : [],
      });
    }
    sortSchedule();
    await saveState(); closeModal(); render();
    flash(id ? "予定を更新しました" : "予定を追加しました");
    return true;
  }
  async function deleteSlot(id) {
    if (!window.confirm("この予定を削除しますか？")) return;
    state.todaySchedule = state.todaySchedule.filter(function (s) { return s.id !== id; });
    await saveState(); render();
    flash("予定を削除しました");
  }

  /* ---------- 問題 CRUD ---------- */
  async function addProblem(values) {
    if (!values.subject || !values.material || !values.problem) {
      flash("科目・教材・問題をすべて入力してください"); return false;
    }
    const newId = "r" + state.nextProblemId++;
    state.reviewQueue.push({
      id: newId, subject: values.subject, material: values.material, problem: values.problem,
      lastResult: "△", intervalStage: 0, nextDate: todayISO(), priority: "中", mastered: false,
    });
    await saveState(); closeModal(); render();
    flash("問題を追加：" + values.problem); return true;
  }
  async function deleteProblem(id) {
    const r = reviewById(id); if (!r) return;
    if (!window.confirm("「" + r.problem + "」を削除しますか？")) return;
    state.reviewQueue = state.reviewQueue.filter(function (x) { return x.id !== id; });
    state.todaySchedule.forEach(function (s) {
      if (s.problems) s.problems = s.problems.filter(function (p) { return p !== id; });
    });
    delete state.completedToday[id];
    await saveState(); render();
    flash("問題を削除しました");
  }
  async function toggleMastered(id) {
    const r = reviewById(id); if (!r) return;
    r.mastered = !r.mastered;
    await saveState(); render();
  }

  /* ---------- 学校 CRUD ---------- */
  async function saveSchool(values, id) {
    if (!values.name || !values.examDate) { flash("学校名と試験日は必須です"); return false; }
    const v = {
      name: values.name,
      priority: parseInt(values.priority, 10) || 99,
      examDate: values.examDate,
      commonTestDate: values.commonTestDate || null,
      passLineDeviation: parseFloat(values.passLineDeviation) || 50,
      passLineScoreRate: parseFloat(values.passLineScoreRate) || 0.6,
      commonTestTargetRate: parseFloat(values.commonTestTargetRate) || 0.7,
    };
    if (id) {
      const i = state.schools.findIndex(function (s) { return s.id === id; });
      if (i >= 0) state.schools[i] = Object.assign(state.schools[i], v);
    } else {
      v.id = "school" + state.nextSchoolId++;
      state.schools.push(v);
    }
    state.schools.sort(function (a, b) { return a.priority - b.priority; });
    await saveState(); closeModal(); render();
    flash(id ? "志望校を更新しました" : "志望校を追加しました"); return true;
  }
  async function deleteSchool(id) {
    if (!window.confirm("この志望校を削除しますか？")) return;
    state.schools = state.schools.filter(function (s) { return s.id !== id; });
    await saveState(); render();
    flash("志望校を削除しました");
  }

  /* ---------- 教材 CRUD ---------- */
  async function saveMaterial(values, id) {
    if (!values.subject || !values.name || !values.totalProblems) {
      flash("科目・教材名・問題数は必須です"); return false;
    }
    const v = {
      subject: values.subject,
      name: values.name,
      totalProblems: parseInt(values.totalProblems, 10) || 1,
      completed: parseInt(values.completed, 10) || 0,
      targetDate: values.targetDate || todayISO(),
    };
    if (id) {
      const i = state.materials.findIndex(function (m) { return m.id === id; });
      if (i >= 0) state.materials[i] = Object.assign(state.materials[i], v);
    } else {
      v.id = "mat" + state.nextMaterialId++;
      state.materials.push(v);
    }
    await saveState(); closeModal(); render();
    flash(id ? "教材を更新しました" : "教材を追加しました"); return true;
  }
  async function deleteMaterial(id) {
    if (!window.confirm("この教材を削除しますか？")) return;
    state.materials = state.materials.filter(function (m) { return m.id !== id; });
    await saveState(); render();
    flash("教材を削除しました");
  }

  /* ---------- 模試 CRUD ---------- */
  async function saveExam(values, idx) {
    if (!values.date || !values.name) { flash("日付と模試名は必須です"); return false; }
    const subjects = {};
    SUBJECTS.forEach(function (s) {
      const dev = parseFloat(values["dev_" + s]);
      if (isFinite(dev)) subjects[s] = { score: 0, max: 0, deviation: dev };
    });
    const v = {
      date: values.date,
      name: values.name,
      subjects: subjects,
      grade: values.grade || "—",
      judgement: values.judgement || "",
      passProbability: parseFloat(values.passProbability) || 0,
    };
    if (typeof idx === "number" && idx >= 0) {
      state.examResults[idx] = Object.assign(state.examResults[idx], v);
    } else {
      state.examResults.push(v);
    }
    state.examResults.sort(function (a, b) { return parseDate(a.date) - parseDate(b.date); });
    await saveState(); closeModal(); render();
    flash("模試結果を保存しました"); return true;
  }
  async function deleteExam(idx) {
    if (!window.confirm("この模試結果を削除しますか？")) return;
    state.examResults.splice(idx, 1);
    await saveState(); render();
    flash("模試結果を削除しました");
  }

  /* ---------- ライフスタイル ---------- */
  async function saveLifestyle(v) {
    state.lifestyle.wakeUp = v.wakeUp || state.lifestyle.wakeUp;
    state.lifestyle.sleep = v.sleep || state.lifestyle.sleep;
    state.lifestyle.schoolHours.start = v.schoolStart || state.lifestyle.schoolHours.start;
    state.lifestyle.schoolHours.end = v.schoolEnd || state.lifestyle.schoolHours.end;
    state.calcConfig.availableHoursPerWeek = parseFloat(v.availableHoursPerWeek) || state.calcConfig.availableHoursPerWeek;
    state.calcConfig.hoursPerDeviationPoint = parseFloat(v.hoursPerDeviationPoint) || state.calcConfig.hoursPerDeviationPoint;
    await saveState(); closeModal(); render();
    flash("生活情報を更新しました");
  }

  /* =============================================================
   * モーダル
   * ============================================================= */

  function openModal(title, bodyNodes, footNodes) {
    const m = document.getElementById("modal");
    document.getElementById("modal-title").textContent = title;
    const body = document.getElementById("modal-body");
    const foot = document.getElementById("modal-foot");
    body.textContent = ""; foot.textContent = "";
    (bodyNodes || []).forEach(function (n) { if (n) body.appendChild(n); });
    (footNodes || []).forEach(function (n) { if (n) foot.appendChild(n); });
    m.hidden = false;
  }
  function closeModal() {
    document.getElementById("modal").hidden = true;
  }
  function readForm(formEl) {
    const out = {};
    formEl.querySelectorAll("[data-field]").forEach(function (i) {
      const k = i.dataset.field;
      if (i.type === "radio") { if (i.checked) out[k] = i.value; }
      else if (i.type === "checkbox") {
        if (k === "problems") {
          if (!out.problems) out.problems = [];
          if (i.checked) out.problems.push(i.value);
        } else { out[k] = i.checked; }
      } else { out[k] = (i.value || "").trim(); }
    });
    formEl.querySelectorAll("[data-problem-id]").forEach(function (i) {
      if (!out.problems) out.problems = [];
      if (i.checked) out.problems.push(i.dataset.problemId);
    });
    return out;
  }

  /* =============================================================
   * フォームビルダー
   * ============================================================= */

  function formRow(label, inputNode) {
    return el("div", { class: "form-row" }, [
      el("label", { class: "form-label", text: label }),
      inputNode,
    ]);
  }
  function input(name, opts) {
    const o = opts || {};
    const attrs = {
      "data-field": name,
      type: o.type || "text",
      value: o.value != null ? String(o.value) : "",
    };
    if (o.placeholder) attrs.placeholder = o.placeholder;
    if (o.step) attrs.step = o.step;
    if (o.min != null) attrs.min = String(o.min);
    if (o.max != null) attrs.max = String(o.max);
    return el("input", { class: "input" + (o.cls ? " " + o.cls : ""), attrs: attrs });
  }
  function select(name, options, value) {
    const sel = el("select", { class: "input", attrs: { "data-field": name } });
    options.forEach(function (o) {
      const opt = el("option", { text: o.label, attrs: { value: o.value } });
      if (String(o.value) === String(value)) opt.setAttribute("selected", "selected");
      sel.appendChild(opt);
    });
    return sel;
  }

  /* =============================================================
   * ページ：ダッシュボード
   * ============================================================= */

  function renderOverview() {
    const root = el("div");
    const calc = reverseCalc();
    const greeting = state.settings.role === "kid" ? "おかえり、息子。" : "ようこそ、嶋田さん。";

    root.appendChild(el("section", { class: "card welcome" }, [
      el("h2", { text: greeting }),
      el("p", { text: today().getUTCFullYear() + "年" + (today().getUTCMonth() + 1) + "月" + today().getUTCDate() + "日（基準日 " + (SEED.referenceDate || "今日") + "）" }),
    ]));

    if (!calc) {
      root.appendChild(el("section", { class: "card" }, [
        el("p", { text: "志望校が登録されていません。「志望校・目標」ページから追加してください。" }),
      ]));
      return root;
    }

    // KPIタイル
    const fillSig = fillRateSignal(calc.fillRate);
    const prob = Math.round((calc.exam.passProbability || 0) * 100);
    const probSig = prob >= 60 ? "green" : prob >= 40 ? "yellow" : "red";
    const examColor = "var(--" + probSig + ")";
    const prog = todayProgress();

    const kpis = el("div", { class: "kpi-row" });
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "二次試験まで" }),
      el("div", { class: "kpi__value", text: calc.days + " 日" }),
      el("div", { class: "kpi__sub", text: calc.school.name }),
    ]));
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "総合判定" }),
      el("div", { class: "kpi__value", attrs: { style: "color:" + examColor }, text: (calc.exam.grade || "—") + "判定" }),
      el("div", { class: "kpi__sub", text: "合格可能性 " + prob + "%" }),
    ]));
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "学習時間 充足率" }),
      el("div", { class: "kpi__value", attrs: { style: "color:var(--" + fillSig + ")" }, text: Math.round(calc.fillRate * 100) + "%" }),
      el("div", { class: "kpi__sub", text: "残り " + calc.requiredHours + "h / 確保 " + calc.capacityHours + "h" }),
    ]));
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "今日のタスク" }),
      el("div", { class: "kpi__value", text: prog.done + " / " + prog.total }),
      el("div", { class: "kpi__sub", text: "問題完了" }),
    ]));
    root.appendChild(kpis);

    // 偏差値ギャップ
    const tbl = el("table", { class: "tbl" });
    tbl.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "科目" }), el("th", { text: "現在" }),
      el("th", { text: "目標" }), el("th", { text: "ギャップ" }),
      el("th", { text: "推奨配分(h)" }),
    ])]));
    const tbody = el("tbody");
    calc.gaps.forEach(function (g, i) {
      const a = calc.allocations[i];
      tbody.appendChild(el("tr", {}, [
        el("td", { text: g.subject }),
        el("td", { class: "num", text: String(g.deviation) }),
        el("td", { class: "num", text: String(calc.school.passLineDeviation) }),
        el("td", { class: "num " + (g.gap > 0 ? "gap-pos" : "gap-ok"), text: g.gap > 0 ? "-" + g.gap : "達成" }),
        el("td", { class: "num", text: a.hours > 0 ? String(a.hours) : "—" }),
      ]));
    });
    tbl.appendChild(tbody);
    root.appendChild(card("📐 合格逆算", [tbl]));

    // 教材進捗概要
    const matsCard = el("div");
    state.materials.forEach(function (m) {
      const pct = m.totalProblems > 0 ? (m.completed / m.totalProblems) * 100 : 0;
      const status = materialSignal(m);
      const wrap = el("div", { class: "material" });
      wrap.appendChild(el("div", { class: "material__head" }, [
        el("div", {}, [
          el("span", { class: "material__subj", text: m.subject + "　" }),
          el("span", { class: "material__name", text: m.name }),
        ]),
        sig(status),
      ]));
      wrap.appendChild(gauge(pct, "bar-" + status));
      wrap.appendChild(el("div", { class: "material__meta", text: m.completed + " / " + m.totalProblems + " 問　(" + Math.round(pct) + "%)" }));
      matsCard.appendChild(wrap);
    });
    root.appendChild(card("📊 科目別進捗", [matsCard]));

    return root;
  }

  /* =============================================================
   * ページ：志望校・目標
   * ============================================================= */

  function renderSchools() {
    const root = el("div");

    // 志望校リスト
    state.schools.forEach(function (s) {
      const c = el("section", { class: "card" });
      c.appendChild(el("div", { class: "list-head" }, [
        el("h4", { text: (s.priority === 1 ? "🥇 " : s.priority === 2 ? "🥈 " : "🥉 ") + s.name }),
        el("div", {}, [
          iconBtn("✏️", "edit-school", { id: s.id }, "編集"),
          iconBtn("🗑️", "delete-school", { id: s.id }, "削除"),
        ]),
      ]));
      const t = el("table", { class: "tbl" });
      const tb = el("tbody");
      tb.appendChild(el("tr", {}, [el("th", { text: "優先度" }), el("td", { text: "第" + s.priority + "志望" })]));
      tb.appendChild(el("tr", {}, [el("th", { text: "二次試験日" }), el("td", { text: s.examDate })]));
      if (s.commonTestDate) tb.appendChild(el("tr", {}, [el("th", { text: "共通テスト" }), el("td", { text: s.commonTestDate })]));
      tb.appendChild(el("tr", {}, [el("th", { text: "合格ライン偏差値" }), el("td", { text: String(s.passLineDeviation) })]));
      tb.appendChild(el("tr", {}, [el("th", { text: "得点率目標" }), el("td", { text: Math.round(s.passLineScoreRate * 100) + "%" })]));
      tb.appendChild(el("tr", {}, [el("th", { text: "共テ目標" }), el("td", { text: Math.round((s.commonTestTargetRate || 0) * 100) + "%" })]));
      t.appendChild(tb);
      c.appendChild(t);

      // カウントダウン
      const days = Math.max(0, daysBetween(today(), parseDate(s.examDate)));
      c.appendChild(el("div", { class: "muted", attrs: { style: "margin-top:8px" }, text: "試験まで " + days + " 日" }));
      root.appendChild(c);
    });

    // 追加ボタン
    root.appendChild(el("div", { class: "add-row" }, [
      btn("＋ 志望校を追加", "new-school", {}, "btn add-btn"),
    ]));

    // ライフスタイル
    root.appendChild(el("div", { class: "section-label", text: "生活情報" }));
    const ls = state.lifestyle;
    const lsCard = el("section", { class: "card" });
    lsCard.appendChild(el("div", { class: "list-head" }, [
      el("h4", { text: "🕐 ライフスタイル & 学習キャパ" }),
      btn("編集", "edit-lifestyle", {}, "btn btn--small"),
    ]));
    const lt = el("table", { class: "tbl" });
    const ltb = el("tbody");
    ltb.appendChild(el("tr", {}, [el("th", { text: "起床／就寝" }), el("td", { text: ls.wakeUp + " 〜 " + ls.sleep })]));
    ltb.appendChild(el("tr", {}, [el("th", { text: "学校" }), el("td", { text: ls.schoolHours.start + " 〜 " + ls.schoolHours.end })]));
    ltb.appendChild(el("tr", {}, [el("th", { text: "週あたり確保時間" }), el("td", { text: state.calcConfig.availableHoursPerWeek + " 時間" })]));
    ltb.appendChild(el("tr", {}, [el("th", { text: "偏差値1ポイントの想定学習時間" }), el("td", { text: state.calcConfig.hoursPerDeviationPoint + " 時間" })]));
    lt.appendChild(ltb);
    lsCard.appendChild(lt);
    root.appendChild(lsCard);

    return root;
  }

  function modalSchool(school) {
    const isNew = !school;
    const cur = school || { name: "", priority: state.schools.length + 1, examDate: "", commonTestDate: "", passLineDeviation: 60, passLineScoreRate: 0.65, commonTestTargetRate: 0.78 };
    const form = el("form", { class: "form-grid school-form", attrs: { "data-id": cur.id || "" } });
    form.appendChild(formRow("学校名", input("name", { value: cur.name, placeholder: "例：第一志望大学 工学部" })));
    form.appendChild(formRow("優先度", input("priority", { type: "number", value: cur.priority, min: 1, max: 99 })));
    form.appendChild(formRow("二次試験日", input("examDate", { type: "date", value: cur.examDate })));
    form.appendChild(formRow("共通テスト日", input("commonTestDate", { type: "date", value: cur.commonTestDate || "" })));
    form.appendChild(formRow("合格偏差値", input("passLineDeviation", { type: "number", value: cur.passLineDeviation, step: "0.5" })));
    form.appendChild(formRow("得点率(0-1)", input("passLineScoreRate", { type: "number", value: cur.passLineScoreRate, step: "0.01", min: 0, max: 1 })));
    form.appendChild(formRow("共テ目標(0-1)", input("commonTestTargetRate", { type: "number", value: cur.commonTestTargetRate || 0.78, step: "0.01", min: 0, max: 1 })));
    openModal(isNew ? "志望校を追加" : "志望校を編集", [form], [
      btn("キャンセル", "modal-close"),
      btn(isNew ? "追加" : "保存", "submit-school", { id: cur.id || "" }, "btn btn--primary"),
    ]);
  }

  function modalLifestyle() {
    const ls = state.lifestyle;
    const form = el("form", { class: "form-grid lifestyle-form" });
    form.appendChild(formRow("起床時刻", input("wakeUp", { type: "time", value: ls.wakeUp })));
    form.appendChild(formRow("就寝時刻", input("sleep", { type: "time", value: ls.sleep })));
    form.appendChild(formRow("学校開始", input("schoolStart", { type: "time", value: ls.schoolHours.start })));
    form.appendChild(formRow("学校終了", input("schoolEnd", { type: "time", value: ls.schoolHours.end })));
    form.appendChild(formRow("週あたり確保時間", input("availableHoursPerWeek", { type: "number", value: state.calcConfig.availableHoursPerWeek, step: "0.5" })));
    form.appendChild(formRow("偏差値1点あたりの想定学習(h)", input("hoursPerDeviationPoint", { type: "number", value: state.calcConfig.hoursPerDeviationPoint, step: "1" })));
    openModal("ライフスタイル & キャパを編集", [form], [
      btn("キャンセル", "modal-close"),
      btn("保存", "submit-lifestyle", {}, "btn btn--primary"),
    ]);
  }

  /* =============================================================
   * ページ：科目・成績
   * ============================================================= */

  function renderSubjects() {
    const root = el("div");

    // 模試結果
    root.appendChild(el("div", { class: "section-label", text: "模試結果（直近〜過去）" }));
    state.examResults.slice().reverse().forEach(function (e, ri) {
      const idx = state.examResults.length - 1 - ri;
      const c = el("section", { class: "card" });
      c.appendChild(el("div", { class: "list-head" }, [
        el("h4", { text: e.date + "　" + e.name + "（" + (e.grade || "—") + "判定）" }),
        el("div", {}, [
          iconBtn("✏️", "edit-exam", { idx: idx }, "編集"),
          iconBtn("🗑️", "delete-exam", { idx: idx }, "削除"),
        ]),
      ]));
      const t = el("table", { class: "tbl" });
      t.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "科目" }), el("th", { text: "偏差値" }),
      ])]));
      const tb = el("tbody");
      SUBJECTS.forEach(function (s) {
        const sub = e.subjects[s];
        if (sub) tb.appendChild(el("tr", {}, [
          el("td", { text: s }),
          el("td", { class: "num", text: String(sub.deviation) }),
        ]));
      });
      t.appendChild(tb);
      c.appendChild(t);
      if (e.judgement) c.appendChild(el("div", { class: "muted", attrs: { style: "margin-top:6px" }, text: e.judgement }));
      root.appendChild(c);
    });

    root.appendChild(el("div", { class: "add-row" }, [
      btn("＋ 模試結果を追加", "new-exam", {}, "btn add-btn"),
    ]));

    // 教材
    root.appendChild(el("div", { class: "section-label", text: "教材" }));
    const matsCard = el("section", { class: "card" });
    matsCard.appendChild(el("div", { class: "list-head" }, [
      el("h4", { text: "📚 教材一覧（周回管理）" }),
      btn("＋ 教材を追加", "new-material", {}, "btn btn--small btn--primary"),
    ]));
    state.materials.forEach(function (m) {
      const pct = m.totalProblems > 0 ? (m.completed / m.totalProblems) * 100 : 0;
      const status = materialSignal(m);
      const w = el("div", { class: "material" });
      w.appendChild(el("div", { class: "material__head" }, [
        el("div", {}, [
          el("span", { class: "material__subj", text: m.subject + "　" }),
          el("span", { class: "material__name", text: m.name }),
        ]),
        el("div", { class: "material__head" }, [
          sig(status),
          iconBtn("✏️", "edit-material", { id: m.id }, "編集"),
          iconBtn("🗑️", "delete-material", { id: m.id }, "削除"),
        ]),
      ]));
      w.appendChild(gauge(pct, "bar-" + status));
      w.appendChild(el("div", { class: "material__foot" }, [
        el("span", { class: "material__meta", text: m.completed + " / " + m.totalProblems + " 問　(" + Math.round(pct) + "%)　目標 " + m.targetDate }),
        el("span", { class: "bump" }, [
          btn("+1", "bump", { id: m.id, delta: "1" }, "btn btn--ghost btn--small"),
          btn("+10", "bump", { id: m.id, delta: "10" }, "btn btn--ghost btn--small"),
          btn("−1", "bump", { id: m.id, delta: "-1" }, "btn btn--ghost btn--small"),
        ]),
      ]));
      matsCard.appendChild(w);
    });
    root.appendChild(matsCard);

    return root;
  }

  function modalExam(idx) {
    const isNew = typeof idx !== "number" || idx < 0;
    const cur = isNew ? {
      date: todayISO(), name: "新規模試", grade: "C", judgement: "", passProbability: 0.4,
      subjects: SUBJECTS.reduce(function (a, s) { a[s] = { deviation: 50 }; return a; }, {}),
    } : state.examResults[idx];
    const form = el("form", { class: "form-grid exam-form", attrs: { "data-idx": isNew ? "" : String(idx) } });
    form.appendChild(formRow("日付", input("date", { type: "date", value: cur.date })));
    form.appendChild(formRow("模試名", input("name", { value: cur.name })));
    form.appendChild(formRow("判定", select("grade", [
      { label: "A", value: "A" }, { label: "B", value: "B" },
      { label: "C", value: "C" }, { label: "D", value: "D" }, { label: "E", value: "E" },
    ], cur.grade || "C")));
    form.appendChild(formRow("合格可能性(0-1)", input("passProbability", { type: "number", value: cur.passProbability || 0, step: "0.01", min: 0, max: 1 })));
    SUBJECTS.forEach(function (s) {
      const sub = (cur.subjects && cur.subjects[s]) || {};
      form.appendChild(formRow(s + " 偏差値", input("dev_" + s, { type: "number", value: sub.deviation || 50, step: "0.5" })));
    });
    openModal(isNew ? "模試結果を追加" : "模試結果を編集", [form], [
      btn("キャンセル", "modal-close"),
      btn(isNew ? "追加" : "保存", "submit-exam", { idx: isNew ? "" : String(idx) }, "btn btn--primary"),
    ]);
  }

  function modalMaterial(m) {
    const isNew = !m;
    const cur = m || { subject: SUBJECTS[0], name: "", totalProblems: 100, completed: 0, targetDate: "" };
    const form = el("form", { class: "form-grid material-form", attrs: { "data-id": cur.id || "" } });
    form.appendChild(formRow("科目", select("subject", SUBJECTS.map(function (s) { return { label: s, value: s }; }), cur.subject)));
    form.appendChild(formRow("教材名", input("name", { value: cur.name, placeholder: "例：青チャートIII" })));
    form.appendChild(formRow("総問題数", input("totalProblems", { type: "number", value: cur.totalProblems, min: 1 })));
    form.appendChild(formRow("済問題数", input("completed", { type: "number", value: cur.completed, min: 0 })));
    form.appendChild(formRow("目標完了日", input("targetDate", { type: "date", value: cur.targetDate })));
    openModal(isNew ? "教材を追加" : "教材を編集", [form], [
      btn("キャンセル", "modal-close"),
      btn(isNew ? "追加" : "保存", "submit-material", { id: cur.id || "" }, "btn btn--primary"),
    ]);
  }

  /* =============================================================
   * ページ：今日のタスク
   * ============================================================= */

  function renderToday() {
    const root = el("div");
    const prog = todayProgress();

    // 進捗バー
    const prgCard = el("section", { class: "card welcome" });
    prgCard.appendChild(el("h2", { text: "📅 今日のタスク" }));
    prgCard.appendChild(el("p", { text: "完了 " + prog.done + " / " + prog.total + " 問" }));
    prgCard.appendChild(gauge(prog.total ? (prog.done / prog.total) * 100 : 0, "bar-green"));
    root.appendChild(prgCard);

    // タイムテーブル
    const tl = el("div", { class: "timeline" });
    const TYPE_LABEL = { fixed: "固定", study: "学習", free: "自由" };
    const TYPE_ICON = { fixed: "📌", study: "✏️", free: "☕" };
    state.todaySchedule.forEach(function (slot) {
      const row = el("div", { class: "slot slot--" + slot.type });
      row.appendChild(el("div", { class: "slot__time", text: slot.start + "–" + slot.end }));
      const bodyChildren = [
        el("div", { class: "slot__label" }, [
          el("span", { text: TYPE_ICON[slot.type] + " " + slot.label }),
          el("span", { class: "slot__type", attrs: { style: "color:var(--ink-faint)" }, text: TYPE_LABEL[slot.type] }),
          el("span", { class: "slot__actions" }, [
            iconBtn("✏️", "edit-slot", { id: slot.id }, "編集"),
            iconBtn("🗑️", "delete-slot", { id: slot.id }, "削除"),
          ]),
        ]),
      ];
      if (slot.problems && slot.problems.length) {
        const ul = el("ul", { class: "slot__problems" });
        slot.problems.forEach(function (pid) {
          const r = reviewById(pid);
          if (!r) return;
          const done = !!state.completedToday[pid];
          ul.appendChild(el("li", {
            class: done ? "is-done" : "",
            attrs: { "data-action": "toggle", "data-id": pid, role: "button", tabindex: "0" },
          }, [
            el("span", { class: "chk" + (done ? " on" : ""), text: done ? "✓" : "" }),
            el("span", { class: "result-chip result-" + r.lastResult, text: r.lastResult }),
            el("span", { class: "p-text" }, [el("strong", { text: r.subject + "：" }), el("span", { text: r.problem })]),
          ]));
        });
        bodyChildren.push(ul);
      }
      row.appendChild(el("div", { class: "slot__body" }, bodyChildren));
      tl.appendChild(row);
    });
    root.appendChild(card("🕐 タイムテーブル", [tl, el("div", { class: "add-row" }, [
      btn("＋ 予定を追加", "new-slot", {}, "btn add-btn"),
    ])]));

    return root;
  }

  function modalSlot(slot) {
    const isNew = !slot;
    const cur = slot || { id: "", start: "08:00", end: "09:00", type: "study", label: "", problems: [] };
    const TYPE_LABEL = { fixed: "📌 固定", study: "✏️ 学習", free: "☕ 自由" };
    const form = el("form", { class: "form-grid slot-form", attrs: { "data-id": cur.id || "" } });
    form.appendChild(formRow("開始", input("start", { type: "time", value: cur.start })));
    form.appendChild(formRow("終了", input("end", { type: "time", value: cur.end })));

    // 種類
    const typeRow = el("div", { class: "form-row" }, [
      el("label", { class: "form-label", text: "種類" }),
      el("div", { class: "type-chips" }, ["fixed", "study", "free"].map(function (t) {
        const chip = el("label", { class: "type-chip" + (cur.type === t ? " is-active" : "") }, [
          el("input", { attrs: { type: "radio", name: "slot-type", value: t, "data-field": "type" } }),
          el("span", { text: TYPE_LABEL[t] }),
        ]);
        if (cur.type === t) chip.querySelector("input").checked = true;
        return chip;
      })),
    ]);
    form.appendChild(typeRow);

    form.appendChild(formRow("内容", input("label", { value: cur.label, placeholder: "例：数学 演習" })));

    // 関連問題
    const chips = el("div", { class: "problem-chips" });
    const active = state.reviewQueue.filter(function (r) { return !r.mastered; });
    if (active.length === 0) {
      chips.appendChild(el("span", { class: "tiny", text: "（解き直しキューに問題がありません）" }));
    }
    active.forEach(function (r) {
      const checked = (cur.problems || []).indexOf(r.id) >= 0;
      const chip = el("label", { class: "p-chip" + (checked ? " is-active" : "") }, [
        el("input", { attrs: { type: "checkbox", "data-problem-id": r.id } }),
        el("span", { class: "subj-pill", text: r.subject }),
        el("span", { text: " " + r.problem }),
      ]);
      if (checked) chip.querySelector("input").checked = true;
      chips.appendChild(chip);
    });
    const probsRow = el("div", { class: "form-row" }, [
      el("label", { class: "form-label", text: "関連する問題（学習タイプ時）" }),
      chips,
    ]);
    form.appendChild(probsRow);

    openModal(isNew ? "予定を追加" : "予定を編集", [form], [
      btn("キャンセル", "modal-close"),
      btn(isNew ? "追加" : "保存", "submit-slot", { id: cur.id || "" }, "btn btn--primary"),
    ]);
  }

  /* =============================================================
   * ページ：解き直しキュー
   * ============================================================= */

  let queueFilter = { subject: "all", priority: "all", mastered: false };

  function renderReview() {
    const root = el("div");

    // フィルター
    const filt = el("div", { class: "card" });
    filt.appendChild(el("div", { class: "list-head" }, [
      el("h4", { text: "🔁 解き直し問題" }),
      btn("＋ 問題を追加", "new-problem", {}, "btn btn--primary btn--small"),
    ]));
    const filtRow = el("div", { class: "form-grid", attrs: { style: "margin-bottom:12px" } });
    filtRow.appendChild(formRow("科目", select("filter-subject", [{ label: "すべて", value: "all" }].concat(SUBJECTS.map(function (s) { return { label: s, value: s }; })), queueFilter.subject)));
    filtRow.appendChild(formRow("優先度", select("filter-priority", [
      { label: "すべて", value: "all" },
      { label: "高", value: "高" }, { label: "中", value: "中" }, { label: "低", value: "低" },
    ], queueFilter.priority)));
    filtRow.appendChild(formRow("習得済み", select("filter-mastered", [
      { label: "未習得のみ", value: "active" }, { label: "習得済み", value: "mastered" }, { label: "すべて", value: "all" },
    ], queueFilter.mastered ? "mastered" : (queueFilter.subject === "all" && queueFilter.priority === "all" ? "active" : "active"))));
    filt.appendChild(filtRow);

    // 適用
    let items = state.reviewQueue.slice();
    if (queueFilter.subject !== "all") items = items.filter(function (r) { return r.subject === queueFilter.subject; });
    if (queueFilter.priority !== "all") items = items.filter(function (r) { return r.priority === queueFilter.priority; });
    if (queueFilter.mastered === false) items = items.filter(function (r) { return !r.mastered; });
    else if (queueFilter.mastered === true) items = items.filter(function (r) { return r.mastered; });
    items.sort(function (a, b) {
      if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;
      const order = { 高: 0, 中: 1, 低: 2 };
      return (order[a.priority] || 9) - (order[b.priority] || 9);
    });

    const list = el("ul", { class: "queue" });
    if (items.length === 0) {
      list.appendChild(el("li", { class: "queue-empty", text: "該当する問題はありません" }));
    }
    items.forEach(function (r) {
      const li = el("li", { class: "prio-" + r.priority + (r.mastered ? " is-done" : "") }, [
        el("span", { class: "result-chip result-" + r.lastResult, text: r.lastResult }),
        el("div", { class: "queue__main" }, [
          el("div", { class: "queue__problem" }, [
            el("span", { class: "subj-pill", text: r.subject }),
            el("span", { text: "　" + r.problem }),
            r.mastered ? el("span", { class: "sig sig--green", text: "習得済み" }) : null,
          ].filter(Boolean)),
          el("div", { class: "queue__meta" }, [
            el("span", { text: r.material + "　／　次回 " + r.nextDate + "　／　間隔: " + (STAGE_LABELS[r.intervalStage] || r.intervalStage) }),
            stageDots(r.intervalStage),
          ]),
        ]),
        r.mastered
          ? el("div", { class: "grade-row" }, [
              iconBtn("↩", "unmaster", { id: r.id }, "未習得に戻す"),
              iconBtn("🗑️", "delete-problem", { id: r.id }, "削除"),
            ])
          : el("div", { class: "grade-row" }, [
              btn("○", "grade", { id: r.id, result: "○" }, "btn btn--grade grade-o"),
              btn("△", "grade", { id: r.id, result: "△" }, "btn btn--grade grade-t"),
              btn("×", "grade", { id: r.id, result: "×" }, "btn btn--grade grade-x"),
              iconBtn("🗑️", "delete-problem", { id: r.id }, "削除"),
            ]),
      ]);
      list.appendChild(li);
    });
    filt.appendChild(list);

    filt.appendChild(el("p", { class: "tiny", attrs: { style: "margin-top:12px" }, text: "忘却曲線：初回→翌日→3日後→1週間後→2週間後→1ヶ月後。× は翌日に戻し頻度UP。表示中 " + items.length + " 件／全 " + state.reviewQueue.length + " 件／習得済み " + masteredCount() + " 件。" }));
    root.appendChild(filt);

    return root;
  }

  function modalNewProblem() {
    const form = el("form", { class: "form-grid problem-form" });
    form.appendChild(formRow("科目", select("subject", SUBJECTS.map(function (s) { return { label: s, value: s }; }), SUBJECTS[0])));
    form.appendChild(formRow("教材", input("material", { placeholder: "例：青チャートIII" })));
    form.appendChild(formRow("問題", input("problem", { placeholder: "例：微分法の応用 例題128" })));
    openModal("問題を追加", [form], [
      btn("キャンセル", "modal-close"),
      btn("追加", "submit-problem", {}, "btn btn--primary"),
    ]);
  }

  /* =============================================================
   * ページ：週次レビュー
   * ============================================================= */

  function renderWeekly() {
    const root = el("div");
    const w = state.weeklyReview;
    if (!w) {
      root.appendChild(el("section", { class: "card" }, [el("p", { text: "週次レビューデータがありません" })]));
      return root;
    }

    const probPct = Math.round((w.actual.problems / w.planned.problems) * 100);
    const hourPct = Math.round((w.actual.studyHours / w.planned.studyHours) * 100);
    const rate = Math.round(w.completionRate * 100);
    const rateSig = rate >= 90 ? "green" : rate >= 75 ? "yellow" : "red";

    // KPI
    const kpis = el("div", { class: "kpi-row" });
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "週間達成率" }),
      el("div", { class: "kpi__value", attrs: { style: "color:var(--" + rateSig + ")" }, text: rate + "%" }),
      el("div", { class: "kpi__sub", text: w.weekOf }),
    ]));
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "問題消化" }),
      el("div", { class: "kpi__value", text: w.actual.problems + " / " + w.planned.problems }),
      el("div", { class: "kpi__sub", text: probPct + "% 達成" }),
    ]));
    kpis.appendChild(el("div", { class: "kpi" }, [
      el("div", { class: "kpi__label", text: "学習時間" }),
      el("div", { class: "kpi__value", text: w.actual.studyHours + "h / " + w.planned.studyHours + "h" }),
      el("div", { class: "kpi__sub", text: hourPct + "% 達成" }),
    ]));
    root.appendChild(kpis);

    // ゲージ
    const grade = el("section", { class: "card" });
    grade.appendChild(el("h3", { class: "card__title", html: "📊 計画 vs 実績" }));
    grade.appendChild(el("div", { class: "muted", text: "問題消化" }));
    grade.appendChild(gauge(probPct, "bar-" + (probPct >= 90 ? "green" : probPct >= 75 ? "yellow" : "red")));
    grade.appendChild(el("div", { class: "muted", text: "学習時間" }));
    grade.appendChild(gauge(hourPct, "bar-" + (hourPct >= 90 ? "green" : hourPct >= 75 ? "yellow" : "red")));
    root.appendChild(grade);

    // 科目別
    const statuses = el("div", { class: "statuses" });
    SUBJECTS.forEach(function (s) {
      const st = w.subjectStatus[s] || "—";
      const sg = st === "順調" ? "green" : st === "遅れ" ? "red" : "yellow";
      statuses.appendChild(el("span", { class: "sig sig--" + sg, text: s + "：" + st }));
    });
    root.appendChild(card("🎯 科目別ステータス", [statuses]));

    // アラート
    if (w.alert) {
      root.appendChild(el("div", { class: "alert", attrs: { style: "margin-bottom:16px" } }, [
        el("span", { text: "⚠️" }), el("span", { text: w.alert }),
      ]));
    }

    // 積み残し
    const carry = el("ul", { class: "carry" });
    w.carryOver.forEach(function (c) {
      carry.appendChild(el("li", {}, [
        el("span", { class: "subj-pill", text: c.subject }),
        el("span", { text: "　" + c.problem + "　" }),
        el("span", { class: "reason", text: "[" + c.reason + "]" }),
      ]));
    });
    root.appendChild(card("📝 積み残し（翌週繰り越し）", [carry]));

    return root;
  }

  /* =============================================================
   * ページ：設定
   * ============================================================= */

  function renderSettings() {
    const root = el("div");
    const passSet = SECURITY.isPasscodeSet();

    // パスコード
    const security = el("section", { class: "card" });
    security.appendChild(el("h3", { class: "card__title", html: "🔐 セキュリティ" }));

    const passRow = el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "パスコード保護" }),
        el("div", { class: "setting-row__desc", text: passSet ? "設定済み：localStorage が AES-GCM で暗号化されています。" : "未設定：実データを入れる前に設定をおすすめします。" }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        el("span", { class: passSet ? "status-on" : "status-off", text: passSet ? "ON" : "OFF" }),
        btn(passSet ? "変更" : "設定する", "passcode-set", {}, "btn"),
        passSet ? btn("解除", "passcode-remove", {}, "btn btn--danger") : null,
      ].filter(Boolean)),
    ]);
    security.appendChild(passRow);

    security.appendChild(el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "自動ロック" }),
        el("div", { class: "setting-row__desc", text: "操作が15分なければ自動的にロック画面に戻ります。" + (passSet ? "" : "（パスコード設定時のみ機能）") }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        el("span", { class: passSet ? "status-on" : "status-off", text: passSet ? "15分" : "OFF" }),
      ]),
    ]));

    security.appendChild(el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "今すぐロック" }),
        el("div", { class: "setting-row__desc", text: "席を離れる前に。パスコード設定時のみ。" }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        btn("🔒 ロック", "lock", {}, "btn"),
      ]),
    ]));
    root.appendChild(security);

    // ロール
    const role = el("section", { class: "card" });
    role.appendChild(el("h3", { class: "card__title", html: "👤 表示モード" }));
    role.appendChild(el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "現在のロール" }),
        el("div", { class: "setting-row__desc", text: "親モード：全機能アクセス可。本人モード：管理機能は非表示。" }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        el("div", { class: "role-toggle", attrs: { style: "background:#f1ebee" } }, [
          el("button", { attrs: { type: "button", "data-action": "set-role", "data-role": "parent", "aria-pressed": state.settings.role === "parent" ? "true" : "false", style: "color:" + (state.settings.role === "parent" ? "var(--brand-darker)" : "var(--ink-soft)") + ";background:" + (state.settings.role === "parent" ? "#fff" : "transparent") }, text: "👩 親" }),
          el("button", { attrs: { type: "button", "data-action": "set-role", "data-role": "kid", "aria-pressed": state.settings.role === "kid" ? "true" : "false", style: "color:" + (state.settings.role === "kid" ? "var(--brand-darker)" : "var(--ink-soft)") + ";background:" + (state.settings.role === "kid" ? "#fff" : "transparent") }, text: "👦 本人" }),
        ]),
      ]),
    ]));
    root.appendChild(role);

    // バックアップ
    const backup = el("section", { class: "card" });
    backup.appendChild(el("h3", { class: "card__title", html: "💾 バックアップ" }));

    backup.appendChild(el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "書き出し（エクスポート）" }),
        el("div", { class: "setting-row__desc", text: "現在のデータをJSONファイルで書き出します。パスコード設定時は暗号化バックアップになります。" }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        btn("📥 ダウンロード", "export", {}, "btn"),
      ]),
    ]));

    backup.appendChild(el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "読み込み（インポート）" }),
        el("div", { class: "setting-row__desc", text: "別端末や過去のバックアップから復元します。現在のデータは上書きされます。" }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        btn("📤 ファイルを選択", "import", {}, "btn"),
      ]),
    ]));

    backup.appendChild(el("div", { class: "setting-row" }, [
      el("div", { class: "setting-row__info" }, [
        el("div", { class: "setting-row__title", text: "リセット（初期データに戻す）" }),
        el("div", { class: "setting-row__desc", text: "保存されたすべてのデータを破棄してダミーデータに戻します。" }),
      ]),
      el("div", { class: "setting-row__actions" }, [
        btn("↺ リセット", "reset", {}, "btn btn--danger"),
      ]),
    ]));
    root.appendChild(backup);

    // 情報
    const info = el("section", { class: "card" });
    info.appendChild(el("h3", { class: "card__title", html: "ℹ️ アプリ情報" }));
    info.appendChild(el("div", { class: "muted" }, [
      el("p", { text: "バージョン: 5.0" }),
      el("p", { text: "公開URL: https://rn-juken-dashboard-2026.netlify.app/" }),
      el("p", { text: "データ保存先: ブラウザ内 localStorage（外部送信なし）" }),
      el("p", { text: state.lastSaved ? "最終保存: " + new Date(state.lastSaved).toLocaleString("ja-JP") : "未保存" }),
    ]));
    root.appendChild(info);

    return root;
  }

  function modalSetPasscode() {
    const isChange = SECURITY.isPasscodeSet();
    const form = el("form", { class: "form-grid passcode-form" });
    if (isChange) {
      form.appendChild(formRow("現在のパスコード", input("current", { type: "password", placeholder: "現在のパスコード" })));
    }
    form.appendChild(formRow("新しいパスコード", input("new1", { type: "password", placeholder: "4文字以上" })));
    form.appendChild(formRow("確認用にもう一度", input("new2", { type: "password", placeholder: "もう一度" })));
    openModal(isChange ? "パスコードを変更" : "パスコードを設定", [form, el("p", { class: "tiny", attrs: { style: "margin-top:12px" }, text: "※ 忘れると復元できません。Web Crypto APIで PBKDF2(250k iter) → AES-GCM で暗号化します。" })], [
      btn("キャンセル", "modal-close"),
      btn("保存", "submit-passcode", {}, "btn btn--primary"),
    ]);
  }
  function modalRemovePasscode() {
    const form = el("form", { class: "form-grid passcode-form" });
    form.appendChild(formRow("現在のパスコード", input("current", { type: "password", placeholder: "現在のパスコード" })));
    openModal("パスコードを解除", [form, el("p", { class: "tiny", attrs: { style: "margin-top:12px" }, text: "暗号化を外して平文での保存に戻します。" })], [
      btn("キャンセル", "modal-close"),
      btn("解除", "submit-passcode-remove", {}, "btn btn--danger"),
    ]);
  }

  /* =============================================================
   * バックアップ
   * ============================================================= */

  async function exportBackup() {
    let blob;
    let filename = "juken-backup-" + todayISO();
    if (SECURITY.isPasscodeSet()) {
      const obj = await SECURITY.exportBackup(state, currentPasscode);
      blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      filename += "-encrypted.json";
    } else {
      const obj = SECURITY.exportPlain(state);
      blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      filename += "-plain.json";
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flash("バックアップを書き出しました");
  }

  async function importBackup() {
    const inp = el("input", { attrs: { type: "file", accept: "application/json" } });
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", async function () {
      const file = inp.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const obj = JSON.parse(text);
        let newState;
        if (obj.magic === "juken-dashboard-backup") {
          const pw = window.prompt("バックアップのパスワードを入力してください");
          if (!pw) return;
          newState = await SECURITY.importBackup(obj, pw);
        } else if (obj.magic === "juken-dashboard-plain") {
          newState = SECURITY.importPlain(obj);
        } else {
          throw new Error("不明な形式");
        }
        if (!newState || !newState.schemaVersion) throw new Error("データ構造が不正");
        state = newState;
        await saveState(); render();
        flash("バックアップを読み込みました");
      } catch (e) {
        flash("読み込み失敗: " + e.message);
      } finally {
        document.body.removeChild(inp);
      }
    });
    inp.click();
  }

  async function resetData() {
    if (!window.confirm("すべてのデータを破棄して初期データに戻します。よろしいですか？")) return;
    state = seedState();
    await saveState(); render();
    flash("初期データに戻しました");
  }

  /* =============================================================
   * ルーター
   * ============================================================= */

  const ui = { pageId: "overview" };

  function navigate(pageId) {
    const p = PAGES.find(function (x) { return x.id === pageId; });
    if (!p) return;
    if (p.roles.indexOf(state.settings.role) < 0) return;
    ui.pageId = pageId;
    document.body.classList.remove("sidebar-open");
    render();
  }

  function render() {
    // サイドバー
    const nav = document.getElementById("sidebar-nav");
    nav.textContent = "";
    PAGES.filter(function (p) { return p.roles.indexOf(state.settings.role) >= 0; })
      .forEach(function (p) {
        const b = el("button", {
          class: "nav-item",
          attrs: { type: "button", "data-action": "navigate", "data-page": p.id, "aria-current": p.id === ui.pageId ? "page" : "false" },
        }, [
          el("span", { class: "nav-item__icon", text: p.icon }),
          el("span", { class: "nav-item__label", text: p.label }),
        ]);
        nav.appendChild(b);
      });

    // ロール切替
    const rt = document.getElementById("role-toggle");
    rt.textContent = "";
    rt.appendChild(el("button", {
      attrs: { type: "button", "data-action": "set-role", "data-role": "parent", "aria-pressed": state.settings.role === "parent" ? "true" : "false" },
      text: "👩 親",
    }));
    rt.appendChild(el("button", {
      attrs: { type: "button", "data-action": "set-role", "data-role": "kid", "aria-pressed": state.settings.role === "kid" ? "true" : "false" },
      text: "👦 本人",
    }));

    // ロックボタン（パスコード設定時のみ）
    document.getElementById("lock-btn").hidden = !SECURITY.isPasscodeSet();

    // ページタイトル
    const cur = PAGES.find(function (p) { return p.id === ui.pageId; });
    document.getElementById("page-title").textContent = cur ? cur.label : "";
    document.getElementById("topbar-actions").textContent = "";

    // ページ本体
    const content = document.getElementById("page-content");
    content.textContent = "";
    let pageNode;
    switch (ui.pageId) {
      case "overview": pageNode = renderOverview(); break;
      case "schools":  pageNode = renderSchools(); break;
      case "subjects": pageNode = renderSubjects(); break;
      case "today":    pageNode = renderToday(); break;
      case "review":   pageNode = renderReview(); break;
      case "weekly":   pageNode = renderWeekly(); break;
      case "settings": pageNode = renderSettings(); break;
      default:         pageNode = renderOverview();
    }
    content.appendChild(pageNode);
  }

  /* =============================================================
   * イベントハンドラ
   * ============================================================= */

  let flashTimer = null;
  function flash(msg) {
    const bar = document.getElementById("flash");
    if (!bar) return;
    bar.textContent = msg;
    bar.classList.add("show");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { bar.classList.remove("show"); }, 2400);
  }

  async function handleAction(action, dataset, target) {
    if (action === "navigate") { navigate(dataset.page); return; }
    if (action === "toggle-sidebar") { document.body.classList.toggle("sidebar-open"); return; }
    if (action === "set-role") {
      state.settings.role = dataset.role;
      if (ui.pageId === "settings" && dataset.role === "kid") ui.pageId = "overview";
      await saveState(); render(); return;
    }
    if (action === "lock") { lockApp(); return; }
    if (action === "modal-close") { closeModal(); return; }

    // 採点 / トグル / 教材
    if (action === "grade")    { await gradeReview(dataset.id, dataset.result); return; }
    if (action === "unmaster") { await toggleMastered(dataset.id); return; }
    if (action === "toggle")   { await toggleProblem(dataset.id); return; }
    if (action === "bump")     { await bumpMaterial(dataset.id, parseInt(dataset.delta, 10)); return; }

    // スロット
    if (action === "edit-slot")   { modalSlot(state.todaySchedule.find(function (s) { return s.id === dataset.id; })); return; }
    if (action === "new-slot")    { modalSlot(null); return; }
    if (action === "delete-slot") { await deleteSlot(dataset.id); return; }
    if (action === "submit-slot") {
      const form = document.querySelector(".slot-form");
      const v = readForm(form);
      await saveSlot(v, dataset.id || null);
      return;
    }

    // 問題
    if (action === "new-problem")    { modalNewProblem(); return; }
    if (action === "submit-problem") {
      const form = document.querySelector(".problem-form");
      await addProblem(readForm(form)); return;
    }
    if (action === "delete-problem") { await deleteProblem(dataset.id); return; }

    // 学校
    if (action === "new-school")    { modalSchool(null); return; }
    if (action === "edit-school")   { modalSchool(state.schools.find(function (s) { return s.id === dataset.id; })); return; }
    if (action === "delete-school") { await deleteSchool(dataset.id); return; }
    if (action === "submit-school") {
      const form = document.querySelector(".school-form");
      await saveSchool(readForm(form), dataset.id || null); return;
    }

    // ライフスタイル
    if (action === "edit-lifestyle")   { modalLifestyle(); return; }
    if (action === "submit-lifestyle") {
      const form = document.querySelector(".lifestyle-form");
      await saveLifestyle(readForm(form)); return;
    }

    // 教材
    if (action === "new-material")    { modalMaterial(null); return; }
    if (action === "edit-material")   { modalMaterial(state.materials.find(function (m) { return m.id === dataset.id; })); return; }
    if (action === "delete-material") { await deleteMaterial(dataset.id); return; }
    if (action === "submit-material") {
      const form = document.querySelector(".material-form");
      await saveMaterial(readForm(form), dataset.id || null); return;
    }

    // 模試
    if (action === "new-exam")    { modalExam(-1); return; }
    if (action === "edit-exam")   { modalExam(parseInt(dataset.idx, 10)); return; }
    if (action === "delete-exam") { await deleteExam(parseInt(dataset.idx, 10)); return; }
    if (action === "submit-exam") {
      const form = document.querySelector(".exam-form");
      const idxStr = dataset.idx;
      const idx = idxStr === "" || idxStr === undefined ? -1 : parseInt(idxStr, 10);
      await saveExam(readForm(form), idx); return;
    }

    // 設定 - パスコード
    if (action === "passcode-set")    { modalSetPasscode(); return; }
    if (action === "passcode-remove") { modalRemovePasscode(); return; }
    if (action === "submit-passcode") {
      const form = document.querySelector(".passcode-form");
      const v = readForm(form);
      if (v.new1 !== v.new2) { flash("確認用パスコードが一致しません"); return; }
      if (!v.new1 || v.new1.length < 4) { flash("4文字以上にしてください"); return; }
      try {
        await SECURITY.setPasscode(v.new1, v.current);
        currentPasscode = v.new1;
        await saveState();
        closeModal(); render();
        flash("パスコードを設定しました");
      } catch (e) { flash(e.message); }
      return;
    }
    if (action === "submit-passcode-remove") {
      const form = document.querySelector(".passcode-form");
      const v = readForm(form);
      try {
        await SECURITY.removePasscode(v.current);
        currentPasscode = null;
        closeModal(); render();
        flash("パスコードを解除しました");
      } catch (e) { flash(e.message); }
      return;
    }

    // バックアップ
    if (action === "export") { await exportBackup(); return; }
    if (action === "import") { await importBackup(); return; }
    if (action === "reset")  { await resetData(); return; }
  }

  /* =============================================================
   * ロック画面
   * ============================================================= */

  function showLockScreen(mode) {
    // mode: "unlock" | "setup"
    const screen = document.getElementById("lock-screen");
    const app = document.getElementById("app");
    const title = document.getElementById("lock-title");
    const desc = document.getElementById("lock-desc");
    const input1 = document.getElementById("lock-input");
    const input2 = document.getElementById("lock-input2");
    const err = document.getElementById("lock-err");
    const submit = document.getElementById("lock-submit");
    const meta = document.getElementById("lock-meta");

    input1.value = ""; input2.value = ""; err.textContent = "";
    app.hidden = true; screen.hidden = false;

    if (mode === "setup") {
      title.textContent = "ようこそ — はじめにパスコードを設定";
      desc.textContent = "実データを入れる場合は家族専用の合言葉を設定してください（4文字以上）。スキップしても利用できます。";
      input2.hidden = false;
      input2.placeholder = "もう一度入力";
      submit.textContent = "パスコードを設定";
      meta.textContent = "";
      const skip = el("a", { text: "パスコードなしで始める", attrs: { tabindex: "0" } });
      skip.addEventListener("click", async function () { await unlockWithoutPasscode(); });
      meta.appendChild(skip);
    } else {
      title.textContent = "パスコードを入力";
      desc.textContent = "家族専用の合言葉です";
      input2.hidden = true;
      submit.textContent = "ロック解除";
      meta.textContent = "";
      const reset = el("a", { text: "パスコードを忘れた／リセット", attrs: { tabindex: "0" } });
      reset.addEventListener("click", async function () {
        if (!window.confirm("すべてのデータを破棄してリセットします。よろしいですか？\n（パスコードを思い出せない場合の最終手段です）")) return;
        SECURITY.clearAll();
        currentPasscode = null;
        await bootstrap();
      });
      meta.appendChild(reset);
    }
    setTimeout(function () { input1.focus(); }, 50);
  }

  function hideLockScreen() {
    document.getElementById("lock-screen").hidden = true;
    document.getElementById("app").hidden = false;
  }

  async function unlockWithoutPasscode() {
    state = (await loadInitial()) || seedState();
    await saveState();
    hideLockScreen();
    render();
    if (SECURITY.isPasscodeSet()) SECURITY.startIdleTimer(lockApp);
  }

  function lockApp() {
    if (!SECURITY.isPasscodeSet()) return;
    currentPasscode = null;
    SECURITY.stopIdleTimer();
    showLockScreen("unlock");
  }

  async function tryUnlock(p1, p2) {
    const err = document.getElementById("lock-err");
    if (SECURITY.isPasscodeSet()) {
      // ロック解除
      const ok = await SECURITY.verifyPasscode(p1);
      if (!ok) { err.textContent = "パスコードが違います"; return; }
      currentPasscode = p1;
      state = (await loadInitial()) || seedState();
      await saveState();
      hideLockScreen();
      render();
      SECURITY.startIdleTimer(lockApp);
    } else {
      // 新規セットアップ
      if (!p1 || p1.length < 4) { err.textContent = "4文字以上にしてください"; return; }
      if (p1 !== p2) { err.textContent = "確認用パスコードが一致しません"; return; }
      try {
        // 既存平文stateがあれば取り込み、新パスコードで暗号化
        state = (await loadInitial()) || seedState();
        await SECURITY.setPasscode(p1);
        currentPasscode = p1;
        await saveState();
        hideLockScreen();
        render();
        SECURITY.startIdleTimer(lockApp);
        flash("パスコードを設定しました");
      } catch (e) {
        err.textContent = e.message;
      }
    }
  }

  /* =============================================================
   * ブートストラップ
   * ============================================================= */

  async function bootstrap() {
    // パスコード有無で初動を変える
    if (SECURITY.isPasscodeSet()) {
      showLockScreen("unlock");
    } else {
      // 平文 state がある or なし
      const s = await loadInitial();
      if (s) {
        state = s;
        hideLockScreen();
        render();
      } else {
        // 完全な新規 → セットアップ画面
        showLockScreen("setup");
      }
    }
  }

  /* =============================================================
   * イベント委譲
   * ============================================================= */

  function bindEvents() {
    document.body.addEventListener("click", function (e) {
      const t = e.target.closest("[data-action]");
      if (!t) return;
      e.preventDefault();
      handleAction(t.dataset.action, t.dataset, t).catch(function (err) {
        console.error(err); flash("エラー: " + (err.message || err));
      });
    });

    // チップ式トグルのアクティブ表示
    document.body.addEventListener("change", function (e) {
      const radio = e.target.closest(".type-chip input[type='radio']");
      if (radio) {
        const group = radio.closest(".type-chips");
        if (group) group.querySelectorAll(".type-chip").forEach(function (c) {
          c.classList.toggle("is-active", c.contains(radio) ? radio.checked : false);
        });
        return;
      }
      const pchk = e.target.closest(".p-chip input[type='checkbox']");
      if (pchk) {
        pchk.closest(".p-chip").classList.toggle("is-active", pchk.checked);
      }
    });

    // Enter/Space で問題チェック切り替え
    document.body.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target.closest("[data-action='toggle']");
      if (!t) return;
      e.preventDefault();
      handleAction("toggle", t.dataset, t);
    });

    // Esc でモーダル閉じる
    document.body.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    // ロック画面フォーム
    const lockForm = document.getElementById("lock-form");
    lockForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      const p1 = document.getElementById("lock-input").value;
      const p2 = document.getElementById("lock-input2").value;
      await tryUnlock(p1, p2);
    });
  }

  function init() {
    if (!SEED) return;
    if (!window.crypto || !window.crypto.subtle) {
      flash("お使いのブラウザは暗号化をサポートしていません。HTTPS環境でアクセスしてください。");
    }
    bindEvents();
    bootstrap();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
