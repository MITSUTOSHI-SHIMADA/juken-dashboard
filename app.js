/* =============================================================
 * 大学受験 学習マネジメントアプリ — 動的ロジック
 * -------------------------------------------------------------
 * 設計思想：解き方・答えは扱わない。「管理」に徹する。
 *
 * 動的（インタラクティブ）：
 *   - 解き直しキューを ○ △ × で採点 → 忘却曲線で次回日を再計算
 *   - 今日の問題をチェック → 進捗カウントに即反映
 *   - 教材の周回を +1 / +10 → 達成率・信号を自動再判定
 *   - 状態は localStorage に保存（リロードしても保持）。リセットで初期化。
 *
 * セキュリティ：
 *   - DOMは textContent / createElement で構築（innerHTMLに動的値を入れない）
 *   - イベントは委譲（インラインの onclick を使わない＝CSP維持）
 * ============================================================= */
(function () {
  "use strict";

  const SEED = window.STUDENT_DATA;
  const STORAGE_KEY = "uni-exam-pm-state";

  // 忘却曲線の間隔（ステージ→日数）
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  const STAGE_LABELS = ["初回", "翌日", "3日後", "1週間後", "2週間後", "1ヶ月後"];
  const MAX_STAGE = INTERVALS.length - 1;
  const SUBJECTS = ["英語", "数学", "国語", "物理", "化学"];

  /* =============================================================
   * ユーティリティ
   * ============================================================= */

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0)) : null;
  }
  function fmtDate(date) {
    const y = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return y + "-" + mo + "-" + d;
  }
  function addDays(date, n) {
    return new Date(date.getTime() + n * 86400000);
  }
  function daysBetween(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }
  function today() {
    if (SEED.referenceDate) return parseDate(SEED.referenceDate);
    const n = new Date();
    return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), 12));
  }
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }
  // "HH:MM" → 分
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
    return m ? +m[1] * 60 + +m[2] : 0;
  }
  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // 要素ビルダー
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.class) node.className = opts.class;
      if (opts.text != null) node.textContent = opts.text;
      if (opts.html != null) node.innerHTML = opts.html; // 内部生成の安全文字列のみ
      if (opts.attrs)
        Object.keys(opts.attrs).forEach(function (k) {
          node.setAttribute(k, opts.attrs[k]);
        });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function card(titleHtml, bodyNodes) {
    const c = el("section", { class: "card" });
    if (titleHtml) c.appendChild(el("h3", { class: "card__title", html: titleHtml }));
    (bodyNodes || []).forEach(function (n) {
      if (n) c.appendChild(n);
    });
    return c;
  }
  function btn(label, action, dataset, cls) {
    const attrs = { type: "button", "data-action": action };
    Object.keys(dataset || {}).forEach(function (k) {
      attrs["data-" + k] = dataset[k];
    });
    return el("button", { class: cls || "btn", text: label, attrs: attrs });
  }

  /* =============================================================
   * 状態管理（メモリ + localStorage）
   * ============================================================= */

  let state;

  function seedState() {
    // スケジュールに一意IDを振る（追加・編集・削除のキーに使う）
    const sched = deepClone(SEED.todaySchedule);
    let nextSlotId = 1;
    sched.forEach(function (s) {
      s.id = "s" + nextSlotId++;
    });
    // 既存の問題IDの最大値から次のIDを採番
    const queue = deepClone(SEED.reviewQueue);
    const maxR = queue.reduce(function (m, r) {
      const n = parseInt(String(r.id).slice(1), 10);
      return isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return {
      schemaVersion: SEED.schemaVersion,
      materials: deepClone(SEED.materials),
      reviewQueue: queue,
      todaySchedule: sched,
      nextSlotId: nextSlotId,
      nextProblemId: maxR + 1,
      // 今日チェックした問題ID（当日の進捗トラッカー）
      completedToday: {},
      // 採点ログ（最新の操作を画面に出すため）
      lastAction: null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion !== SEED.schemaVersion) return null; // スキーマ更新時は破棄
      return parsed;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* プライベートモード等で失敗してもメモリ内では動く */
    }
  }
  function resetState() {
    state = seedState();
    save();
    renderAll();
    flash("初期データにリセットしました");
  }

  /* =============================================================
   * 派生計算
   * ============================================================= */

  function primarySchool() {
    return SEED.schools.slice().sort(function (a, b) {
      return a.priority - b.priority;
    })[0];
  }
  function latestExam() {
    return SEED.examResults
      .slice()
      .sort(function (a, b) {
        return parseDate(a.date) - parseDate(b.date);
      })
      .slice(-1)[0];
  }

  function reverseCalc() {
    const school = primarySchool();
    const exam = latestExam();
    const cfg = SEED.calcConfig;
    const days = Math.max(0, daysBetween(today(), parseDate(school.examDate)));
    const gaps = SUBJECTS.map(function (s) {
      const dev = exam.subjects[s] ? exam.subjects[s].deviation : 0;
      return { subject: s, deviation: dev, gap: Math.max(0, school.passLineDeviation - dev) };
    });
    const totalGap = gaps.reduce(function (a, g) {
      return a + g.gap;
    }, 0);
    const requiredHours = Math.round(totalGap * cfg.hoursPerDeviationPoint);
    const capacityHours = Math.round((days / 7) * cfg.availableHoursPerWeek);
    const fillRate = requiredHours > 0 ? capacityHours / requiredHours : 1;
    const allocations = gaps.map(function (g) {
      return { subject: g.subject, gap: g.gap, hours: totalGap > 0 ? Math.round((g.gap / totalGap) * requiredHours) : 0 };
    });
    return { school: school, days: days, gaps: gaps, totalGap: totalGap, requiredHours: requiredHours, capacityHours: capacityHours, fillRate: fillRate, allocations: allocations };
  }
  function fillRateSignal(rate) {
    const pct = Math.round(rate * 100);
    if (pct >= 100) return "green";
    if (pct >= 80) return "yellow";
    return "red";
  }

  // 教材の信号を「予定ペース vs 実績」から動的算出
  function materialSignal(m) {
    const start = parseDate(SEED.calcConfig.planStart);
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

  function activeQueue() {
    return state.reviewQueue.filter(function (r) {
      return !r.mastered;
    });
  }
  function dueToday() {
    const t = today();
    return activeQueue().filter(function (r) {
      const d = parseDate(r.nextDate);
      return d && daysBetween(d, t) >= 0;
    });
  }
  function reviewById(id) {
    return state.reviewQueue.find(function (r) {
      return r.id === id;
    });
  }
  function masteredCount() {
    return state.reviewQueue.filter(function (r) {
      return r.mastered;
    }).length;
  }

  // 今日のタイムテーブル上の問題ID（重複排除）
  function todayProblemIds() {
    const ids = [];
    state.todaySchedule.forEach(function (s) {
      (s.problems || []).forEach(function (p) {
        if (ids.indexOf(p) < 0) ids.push(p);
      });
    });
    return ids;
  }
  function todayProgress() {
    const ids = todayProblemIds();
    const done = ids.filter(function (id) {
      return state.completedToday[id];
    }).length;
    return { done: done, total: ids.length };
  }

  /* =============================================================
   * 操作（ミューテーション）
   * ============================================================= */

  // 解き直し採点：忘却曲線で次回日を再計算
  function gradeReview(id, result) {
    const r = reviewById(id);
    if (!r || r.mastered) return;
    const base = today();
    let nextDays;

    if (result === "○") {
      if (r.intervalStage >= MAX_STAGE) {
        r.mastered = true; // 最終ステージで正解 → 習得済み
        r.lastResult = "○";
        state.completedToday[id] = true;
        save();
        renderAll();
        flash(r.subject + "「" + r.problem + "」を習得済みに 🎉");
        return;
      }
      r.intervalStage = Math.min(MAX_STAGE, r.intervalStage + 1);
      r.priority = r.intervalStage >= 4 ? "低" : "中";
      nextDays = INTERVALS[r.intervalStage];
    } else if (result === "△") {
      // 同じステージで再挑戦（最短でも翌日）
      nextDays = Math.max(1, INTERVALS[r.intervalStage]);
      r.priority = "中";
    } else {
      // × → 翌日に戻し、頻度UP（最優先）
      r.intervalStage = 1;
      nextDays = INTERVALS[1];
      r.priority = "高";
    }

    r.lastResult = result;
    r.nextDate = fmtDate(addDays(base, nextDays));
    state.completedToday[id] = true; // 採点した＝今日触れた
    save();
    renderAll();
    flash(r.subject + "を「" + result + "」で採点 → 次回 " + r.nextDate);
  }

  function toggleProblem(id) {
    if (state.completedToday[id]) delete state.completedToday[id];
    else state.completedToday[id] = true;
    save();
    renderAll();
  }

  function bumpMaterial(id, delta) {
    const m = state.materials.find(function (x) {
      return x.id === id;
    });
    if (!m) return;
    m.completed = clamp(m.completed + delta, 0, m.totalProblems);
    save();
    renderAll();
  }

  /* ---------- スケジュール CRUD ---------- */

  function slotById(id) {
    return state.todaySchedule.find(function (s) {
      return s.id === id;
    });
  }

  function sortSchedule() {
    state.todaySchedule.sort(function (a, b) {
      return toMin(a.start) - toMin(b.start);
    });
  }

  function saveSlot(values, id) {
    // values: {start,end,type,label,problems[]}
    if (!values.start || !values.end || !values.label) {
      flash("時間とラベルを入力してください");
      return false;
    }
    if (toMin(values.end) <= toMin(values.start)) {
      flash("終了時刻は開始時刻より後にしてください");
      return false;
    }
    if (id) {
      const s = slotById(id);
      if (!s) return false;
      s.start = values.start;
      s.end = values.end;
      s.type = values.type;
      s.label = values.label;
      s.problems = values.type === "study" ? (values.problems || []) : [];
    } else {
      state.todaySchedule.push({
        id: "s" + state.nextSlotId++,
        start: values.start,
        end: values.end,
        type: values.type,
        label: values.label,
        problems: values.type === "study" ? (values.problems || []) : [],
      });
    }
    sortSchedule();
    ui.editing = null;
    save();
    renderAll();
    flash(id ? "予定を更新しました" : "予定を追加しました");
    return true;
  }

  function deleteSlot(id) {
    if (!window.confirm("この予定を削除しますか？")) return;
    state.todaySchedule = state.todaySchedule.filter(function (s) {
      return s.id !== id;
    });
    if (ui.editing === id) ui.editing = null;
    save();
    renderAll();
    flash("予定を削除しました");
  }

  function toggleSlotProblem(slotId, problemId) {
    const s = slotById(slotId);
    if (!s) return;
    s.problems = s.problems || [];
    const i = s.problems.indexOf(problemId);
    if (i >= 0) s.problems.splice(i, 1);
    else s.problems.push(problemId);
    save();
    renderAll();
  }

  /* ---------- 問題 CRUD ---------- */

  function addProblem(values) {
    if (!values.subject || !values.material || !values.problem) {
      flash("科目・教材・問題をすべて入力してください");
      return false;
    }
    const newId = "r" + state.nextProblemId++;
    state.reviewQueue.push({
      id: newId,
      subject: values.subject,
      material: values.material,
      problem: values.problem,
      lastResult: "△",
      intervalStage: 0,
      nextDate: fmtDate(today()),
      priority: "中",
      mastered: false,
    });
    ui.editing = null;
    save();
    renderAll();
    flash("問題を追加しました：" + values.problem);
    return true;
  }

  function deleteProblem(id) {
    const r = reviewById(id);
    if (!r) return;
    if (!window.confirm("「" + r.problem + "」を削除しますか？")) return;
    state.reviewQueue = state.reviewQueue.filter(function (x) {
      return x.id !== id;
    });
    // どの予定からも参照を外す
    state.todaySchedule.forEach(function (s) {
      if (s.problems && s.problems.length) {
        s.problems = s.problems.filter(function (p) {
          return p !== id;
        });
      }
    });
    delete state.completedToday[id];
    save();
    renderAll();
    flash("問題を削除しました");
  }

  /* =============================================================
   * 共通パーツ
   * ============================================================= */

  function signalBadge(status, labels) {
    const map = labels || { green: "間に合う", yellow: "やや遅れ", red: "遅れ" };
    return el("span", { class: "sig sig--" + status, text: map[status] || status });
  }
  function gauge(pct, colorClass) {
    const g = el("div", { class: "gauge " + (colorClass || "bar-brand") });
    g.appendChild(el("span", { attrs: { style: "width:" + clamp(pct, 0, 100) + "%" } }));
    return g;
  }
  function stageDots(stage) {
    const wrap = el("span", { class: "stage-dots", attrs: { title: "反復ステージ " + stage + "/" + MAX_STAGE } });
    for (let i = 0; i <= MAX_STAGE; i++) wrap.appendChild(el("i", { class: i <= stage ? "on" : "" }));
    return wrap;
  }

  /* =============================================================
   * 親ビュー
   * ============================================================= */

  function renderParentView(root) {
    root.textContent = "";
    const calc = reverseCalc();
    const exam = latestExam();
    root.appendChild(renderHeaderSummary(calc, exam));

    const g1 = el("div", { class: "grid grid--2" });
    g1.appendChild(renderReversePanel(calc));
    g1.appendChild(renderSubjectProgress());
    root.appendChild(g1);

    const g2 = el("div", { class: "grid grid--2" });
    g2.appendChild(renderTimetable());
    g2.appendChild(renderReviewQueue());
    root.appendChild(g2);

    root.appendChild(renderWeeklyReview());
  }

  function renderHeaderSummary(calc, exam) {
    const school = calc.school;
    const c = el("section", { class: "card" });
    const grid = el("div", { class: "summary" });

    grid.appendChild(
      el("div", {}, [
        el("div", { class: "muted", text: "第一志望" }),
        el("div", { class: "summary__school", text: school.name }),
        el("div", { class: "summary__sub", text: "二次 偏差値 " + school.passLineDeviation + " / 共テ目標 " + Math.round(school.commonTestTargetRate * 100) + "%" }),
        el("div", { class: "tiny", text: "共通テスト " + school.commonTestDate + "　／　二次 " + school.examDate }),
      ])
    );

    const cd = el("div", { class: "countdown" }, [
      el("div", { class: "muted", text: "二次試験まで" }),
      el("div", { class: "metric-row" }, [el("span", { class: "bignum", text: String(calc.days) }), el("span", { class: "unit", text: "日" })]),
      el("div", { class: "tiny", text: "共テまで " + Math.max(0, daysBetween(today(), parseDate(school.commonTestDate))) + "日　（基準日 " + (SEED.referenceDate || "本日") + "）" }),
    ]);
    grid.appendChild(cd);

    const prob = Math.round((exam.passProbability || 0) * 100);
    const probSig = prob >= 60 ? "green" : prob >= 40 ? "yellow" : "red";
    const trend = SEED.examResults.map(function (e) {
      return e.grade;
    });
    grid.appendChild(
      el("div", { class: "judge" }, [
        el("div", { class: "muted", text: "総合判定" }),
        el("div", { class: "metric-row" }, [
          el("span", { class: "bignum", text: (exam.grade || "") + "判定", attrs: { style: "color:var(--" + probSig + ")" } }),
        ]),
        el("div", { class: "trend", text: "合格可能性 " + prob + "%　判定 " + trend.join(" → ") + " ↗" }),
        el("div", { class: "tiny", text: esc(exam.name) + "（" + exam.date + "）" }),
      ])
    );

    c.appendChild(grid);
    return c;
  }

  function renderReversePanel(calc) {
    const sig = fillRateSignal(calc.fillRate);
    const body = [];
    const kpiRow = el("div", { class: "grid grid--3" });
    kpiRow.appendChild(el("div", { class: "kpi" }, [el("div", { class: "bignum", text: Math.round(calc.fillRate * 100) + "%", attrs: { style: "color:var(--" + sig + ")" } }), el("div", { class: "kpi-label", text: "学習時間 充足率" })]));
    kpiRow.appendChild(el("div", { class: "kpi" }, [el("div", { class: "bignum", text: String(calc.requiredHours) }), el("div", { class: "kpi-label", text: "必要総学習(h)" })]));
    kpiRow.appendChild(el("div", { class: "kpi" }, [el("div", { class: "bignum", text: String(calc.capacityHours) }), el("div", { class: "kpi-label", text: "確保可能(h)" })]));
    body.push(kpiRow);
    body.push(gauge(calc.fillRate * 100, "bar-" + sig));
    body.push(el("div", { class: "muted" }, [signalBadge(sig, { green: "キャパ十分", yellow: "やや不足・要管理", red: "時間不足" }), el("span", { text: " 残り " + calc.days + "日 × 週" + SEED.calcConfig.availableHoursPerWeek + "h で算出" })]));

    const table = el("table", { class: "gap-table" });
    table.appendChild(el("thead", {}, [el("tr", {}, [el("th", { text: "科目" }), el("th", { text: "現在" }), el("th", { text: "目標" }), el("th", { text: "ギャップ" }), el("th", { text: "推奨配分(h)" })])]));
    const tbody = el("tbody");
    calc.gaps.forEach(function (g, i) {
      const alloc = calc.allocations[i];
      tbody.appendChild(
        el("tr", {}, [
          el("td", { text: g.subject }),
          el("td", { class: "num", text: String(g.deviation) }),
          el("td", { class: "num", text: String(calc.school.passLineDeviation) }),
          el("td", { class: "num " + (g.gap > 0 ? "gap-pos" : "gap-ok"), text: g.gap > 0 ? "-" + g.gap : "達成" }),
          el("td", { class: "num", text: alloc.hours > 0 ? String(alloc.hours) : "—" }),
        ])
      );
    });
    table.appendChild(tbody);
    body.push(table);
    return card("📐 合格逆算パネル", body);
  }

  function renderSubjectProgress() {
    const body = [];
    state.materials.forEach(function (m) {
      const pct = m.totalProblems > 0 ? (m.completed / m.totalProblems) * 100 : 0;
      const status = materialSignal(m);
      const wrap = el("div", { class: "material" });
      wrap.appendChild(
        el("div", { class: "material__head" }, [
          el("div", {}, [el("span", { class: "material__subj", text: m.subject + "　" }), el("span", { class: "material__name", text: m.name })]),
          signalBadge(status),
        ])
      );
      wrap.appendChild(gauge(pct, "bar-" + status));
      wrap.appendChild(
        el("div", { class: "material__foot" }, [
          el("span", { class: "material__meta", text: m.completed + " / " + m.totalProblems + " 問　(" + Math.round(pct) + "%)　残り " + (m.totalProblems - m.completed) },),
          el("span", { class: "bump" }, [
            btn("+1", "bump", { id: m.id, delta: "1" }, "btn btn--ghost"),
            btn("+10", "bump", { id: m.id, delta: "10" }, "btn btn--ghost"),
            btn("−1", "bump", { id: m.id, delta: "-1" }, "btn btn--ghost"),
          ]),
        ])
      );
      body.push(wrap);
    });
    return card("📊 科目別進捗 <span class='tiny'>（周回を更新すると信号が自動再判定）</span>", body);
  }

  const TYPE_LABEL = { fixed: "固定", study: "学習", free: "自由" };
  const TYPE_ICON = { fixed: "📌", study: "✏️", free: "☕" };

  function renderTimetable() {
    const tl = el("div", { class: "timeline" });
    state.todaySchedule.forEach(function (slot) {
      tl.appendChild(slot.id === ui.editing ? renderSlotEditForm(slot) : renderSlotRow(slot));
    });
    // 末尾：追加フォーム or 追加ボタン
    if (ui.editing === "new-slot") {
      tl.appendChild(renderSlotEditForm(null));
    } else {
      const addRow = el("div", { class: "add-row" }, [
        btn("＋ 予定を追加", "new-slot", {}, "btn add-btn"),
      ]);
      tl.appendChild(addRow);
    }
    const prog = todayProgress();
    const head = el("div", { class: "today-prog" }, [
      el("span", { text: "今日の問題 " }),
      el("strong", { text: prog.done + " / " + prog.total }),
      el("span", { text: " 完了" }),
    ]);
    return card("🗓️ 今日のタイムテーブル <span class='tiny'>（追加・編集・削除でき、本人ビューにも反映）</span>", [head, tl]);
  }

  function renderSlotRow(slot) {
    const row = el("div", { class: "slot slot--" + slot.type });
    row.appendChild(el("div", { class: "slot__time", text: slot.start + "–" + slot.end }));
    const bodyChildren = [
      el("div", { class: "slot__label" }, [
        el("span", { text: slot.label }),
        el("span", { class: "slot__type", attrs: { style: "color:var(--ink-faint)" }, text: TYPE_LABEL[slot.type] || slot.type }),
        el("span", { class: "slot__actions" }, [
          btn("✏️", "edit-slot", { id: slot.id }, "icon-btn"),
          btn("🗑️", "delete-slot", { id: slot.id }, "icon-btn"),
        ]),
      ]),
    ];
    if (slot.problems && slot.problems.length) {
      const ul = el("ul", { class: "slot__problems" });
      slot.problems.forEach(function (pid) {
        const r = reviewById(pid);
        if (!r) return;
        const done = !!state.completedToday[pid];
        ul.appendChild(
          el("li", { class: "checkable" + (done ? " is-done" : ""), attrs: { "data-action": "toggle", "data-id": pid, role: "button", tabindex: "0" } }, [
            el("span", { class: "chk" + (done ? " on" : ""), text: done ? "✓" : "" }),
            el("span", { class: "result-chip result-" + r.lastResult, text: r.lastResult }),
            el("span", {}, [el("strong", { text: r.subject + "：" }), el("span", { text: r.problem })]),
          ])
        );
      });
      bodyChildren.push(ul);
    }
    row.appendChild(el("div", { class: "slot__body" }, bodyChildren));
    return row;
  }

  function renderSlotEditForm(slot) {
    // slot=null → 新規。else → 編集
    const isNew = !slot;
    const cur = slot || { id: "", start: "08:00", end: "09:00", type: "study", label: "", problems: [] };
    const form = el("div", { class: "edit-form slot-form", attrs: { "data-slot-id": cur.id, "data-mode": isNew ? "new" : "edit" } });

    form.appendChild(el("div", { class: "form-title", text: isNew ? "＋ 新しい予定" : "✏️ 予定を編集" }));

    // 時間
    const timeRow = el("div", { class: "form-row" }, [
      el("label", { class: "form-label", text: "時間" }),
      el("div", { class: "time-inputs" }, [
        el("input", { class: "input time-in", attrs: { type: "time", "data-field": "start", value: cur.start } }),
        el("span", { text: "〜" }),
        el("input", { class: "input time-in", attrs: { type: "time", "data-field": "end", value: cur.end } }),
      ]),
    ]);
    form.appendChild(timeRow);

    // 種類
    const typeRow = el("div", { class: "form-row" }, [
      el("label", { class: "form-label", text: "種類" }),
      el("div", { class: "type-chips" }, ["fixed", "study", "free"].map(function (t) {
        const chip = el("label", { class: "type-chip type-chip--" + t + (cur.type === t ? " is-active" : "") }, [
          el("input", { attrs: { type: "radio", name: "type-" + (cur.id || "new"), value: t, "data-field": "type" } }),
          el("span", { text: TYPE_ICON[t] + " " + TYPE_LABEL[t] }),
        ]);
        const inp = chip.querySelector("input");
        if (cur.type === t) inp.checked = true;
        return chip;
      })),
    ]);
    form.appendChild(typeRow);

    // ラベル
    form.appendChild(
      el("div", { class: "form-row" }, [
        el("label", { class: "form-label", text: "内容" }),
        el("input", { class: "input", attrs: { type: "text", "data-field": "label", value: cur.label, placeholder: "例：数学 演習、夕食、休憩" } }),
      ])
    );

    // 関連問題（学習タイプのみ）
    const problemsRow = el("div", { class: "form-row problems-row" });
    problemsRow.appendChild(el("label", { class: "form-label", text: "関連する問題" }));
    const chips = el("div", { class: "problem-chips" });
    const active = state.reviewQueue.filter(function (r) { return !r.mastered; });
    if (active.length === 0) {
      chips.appendChild(el("span", { class: "muted tiny", text: "（解き直しキューに問題がありません）" }));
    }
    active.forEach(function (r) {
      const checked = (cur.problems || []).indexOf(r.id) >= 0;
      const chip = el("label", { class: "p-chip" + (checked ? " is-active" : "") }, [
        el("input", { attrs: { type: "checkbox", "data-problem-id": r.id } }),
        el("span", { class: "subj-pill", text: r.subject }),
        el("span", { text: " " + r.problem }),
      ]);
      const inp = chip.querySelector("input");
      if (checked) inp.checked = true;
      chips.appendChild(chip);
    });
    problemsRow.appendChild(chips);
    form.appendChild(problemsRow);

    // ボタン
    form.appendChild(
      el("div", { class: "form-actions" }, [
        btn(isNew ? "追加" : "保存", "save-slot", { id: cur.id || "" }, "btn btn--primary"),
        btn("キャンセル", "cancel-edit", {}, "btn"),
      ])
    );

    return form;
  }

  function readSlotForm(formEl) {
    const fields = { start: "", end: "", type: "study", label: "", problems: [] };
    formEl.querySelectorAll("[data-field]").forEach(function (inp) {
      const k = inp.dataset.field;
      if (k === "type") {
        if (inp.checked) fields.type = inp.value;
      } else {
        fields[k] = inp.value;
      }
    });
    formEl.querySelectorAll("[data-problem-id]").forEach(function (inp) {
      if (inp.checked) fields.problems.push(inp.dataset.problemId);
    });
    return fields;
  }

  function renderReviewQueue() {
    const items = dueToday().sort(function (a, b) {
      const order = { 高: 0, 中: 1, 低: 2 };
      return (order[a.priority] || 9) - (order[b.priority] || 9);
    });
    const list = el("ul", { class: "queue" });

    if (items.length === 0) {
      list.appendChild(el("li", { class: "queue-empty", text: "今日の解き直しは完了！お疲れさま 🎉" }));
    }

    items.forEach(function (r) {
      list.appendChild(
        el("li", { class: "prio-" + r.priority }, [
          el("span", { class: "result-chip result-" + r.lastResult, text: r.lastResult }),
          el("div", { class: "queue__main" }, [
            el("div", { class: "queue__problem" }, [
              el("span", { class: "subj-pill", text: r.subject }),
              el("span", { text: "　" + r.problem }),
            ]),
            el("div", { class: "queue__meta" }, [
              el("span", { text: r.material + "　／　間隔: " + (STAGE_LABELS[r.intervalStage] || r.intervalStage) }),
              stageDots(r.intervalStage),
            ]),
          ]),
          el("div", { class: "grade" }, [
            btn("○", "grade", { id: r.id, result: "○" }, "btn btn--grade grade-o"),
            btn("△", "grade", { id: r.id, result: "△" }, "btn btn--grade grade-t"),
            btn("×", "grade", { id: r.id, result: "×" }, "btn btn--grade grade-x"),
            btn("🗑️", "delete-problem", { id: r.id }, "icon-btn"),
          ]),
        ])
      );
    });

    // 追加フォーム or 追加ボタン
    const addBox =
      ui.editing === "new-problem"
        ? renderProblemAddForm()
        : el("div", { class: "add-row" }, [btn("＋ 問題を追加", "new-problem", {}, "btn add-btn")]);

    const note = el("p", { class: "tiny", text: "忘却曲線：初回→翌日→3日後→1週間後→2週間後→1ヶ月後。× は翌日に戻し頻度UP、○ は次段階へ。今日 " + items.length + " 件／習得済み " + masteredCount() + " 件。" });
    return card("🔁 解き直しキュー <span class='tiny'>（○△×で採点・問題の追加削除も）</span>", [list, addBox, note]);
  }

  function renderProblemAddForm() {
    const form = el("div", { class: "edit-form problem-form" });
    form.appendChild(el("div", { class: "form-title", text: "＋ 新しい問題" }));

    // 科目
    const subjSel = el("select", { class: "input", attrs: { "data-field": "subject" } });
    SUBJECTS.forEach(function (s) {
      subjSel.appendChild(el("option", { text: s, attrs: { value: s } }));
    });
    form.appendChild(
      el("div", { class: "form-row" }, [
        el("label", { class: "form-label", text: "科目" }),
        subjSel,
      ])
    );
    // 教材
    form.appendChild(
      el("div", { class: "form-row" }, [
        el("label", { class: "form-label", text: "教材" }),
        el("input", { class: "input", attrs: { type: "text", "data-field": "material", placeholder: "例：青チャートIII" } }),
      ])
    );
    // 問題
    form.appendChild(
      el("div", { class: "form-row" }, [
        el("label", { class: "form-label", text: "問題" }),
        el("input", { class: "input", attrs: { type: "text", "data-field": "problem", placeholder: "例：微分法の応用 例題128" } }),
      ])
    );
    form.appendChild(
      el("div", { class: "form-actions" }, [
        btn("追加", "save-problem", {}, "btn btn--primary"),
        btn("キャンセル", "cancel-edit", {}, "btn"),
      ])
    );
    return form;
  }

  function readProblemForm(formEl) {
    const fields = { subject: "", material: "", problem: "" };
    formEl.querySelectorAll("[data-field]").forEach(function (inp) {
      fields[inp.dataset.field] = inp.value.trim();
    });
    return fields;
  }

  function renderWeeklyReview() {
    const w = SEED.weeklyReview;
    const grid = el("div", { class: "review-grid" });
    const probPct = Math.round((w.actual.problems / w.planned.problems) * 100);
    const hourPct = Math.round((w.actual.studyHours / w.planned.studyHours) * 100);
    grid.appendChild(
      el("div", {}, [
        el("div", { class: "muted", text: "計画 vs 実績" }),
        el("div", { class: "compare" }, [el("span", { class: "bignum", text: w.actual.problems }), el("span", { class: "muted", text: "/ " + w.planned.problems + " 問　(" + probPct + "%)" })]),
        gauge(probPct, "bar-" + (probPct >= 90 ? "green" : probPct >= 75 ? "yellow" : "red")),
        el("div", { class: "compare" }, [el("span", { class: "bignum", text: w.actual.studyHours + "h" }), el("span", { class: "muted", text: "/ " + w.planned.studyHours + "h　(" + hourPct + "%)" })]),
        gauge(hourPct, "bar-" + (hourPct >= 90 ? "green" : hourPct >= 75 ? "yellow" : "red")),
        el("div", { class: "tiny", text: "対象週 " + w.weekOf }),
      ])
    );
    const rate = Math.round(w.completionRate * 100);
    const rateSig = rate >= 90 ? "green" : rate >= 75 ? "yellow" : "red";
    grid.appendChild(
      el("div", {}, [
        el("div", { class: "muted", text: "週間達成率" }),
        el("div", { class: "kpi" }, [el("div", { class: "bignum", text: rate + "%", attrs: { style: "color:var(--" + rateSig + ");font-size:3rem" } })]),
        el("div", { class: "statuses" }, SUBJECTS.map(function (s) {
          const st = w.subjectStatus[s] || "—";
          const sg = st === "順調" ? "green" : st === "遅れ" ? "red" : "yellow";
          return el("span", { class: "sig sig--" + sg, text: s + "：" + st });
        })),
      ])
    );
    const alert = el("div", { class: "alert" }, [el("span", { text: "⚠️" }), el("span", { text: w.alert })]);
    const carry = el("ul", { class: "carry" });
    w.carryOver.forEach(function (c) {
      carry.appendChild(el("li", {}, [el("span", { class: "subj-pill", text: c.subject }), el("span", { text: "　" + c.problem + "　" }), el("span", { class: "reason", text: "[" + c.reason + "]" })]));
    });
    const carryWrap = el("div", {}, [el("div", { class: "muted", attrs: { style: "margin:6px 0 8px" }, text: "積み残し → 翌週繰り越し（" + w.carryOver.length + "件）" }), carry]);
    return card("📅 週次レビュー <span class='tiny'>（日曜夜に生成）</span>", [grid, alert, carryWrap]);
  }

  /* =============================================================
   * 子どもビュー（本人用・今日やること中心）
   * ============================================================= */

  function renderKidView(root) {
    root.textContent = "";
    const calc = reverseCalc();
    const exam = latestExam();
    const studyBlocks = state.todaySchedule.filter(function (s) {
      return s.type === "study";
    });
    const prog = todayProgress();

    // ---- ① ゴールを見せる：志望校・カウントダウン・判定 ----
    root.appendChild(renderHeaderSummary(calc, exam));

    // ---- ② 今日のフォーカス ----
    const hero = el("section", { class: "card kid-hero" }, [
      el("h2", { text: "📚 今日のタスク" }),
      el("div", { class: "date", text: (SEED.referenceDate || "今日") + "（予備校なし平日）" }),
      el("div", { class: "kid-progress" }, [
        gauge(prog.total ? (prog.done / prog.total) * 100 : 0, "bar-green"),
        el("div", { class: "kid-count", text: "完了 " + prog.done + " / " + prog.total + " 問" }),
      ]),
    ]);
    root.appendChild(hero);

    // ---- ③ 今日のタイムテーブル + 解く問題 ----
    const gridToday = el("div", { class: "grid grid--2" });

    // タイムテーブル（シンプル・閲覧専用）
    const tl = el("div", { class: "timeline" });
    state.todaySchedule.forEach(function (slot) {
      const row = el("div", { class: "slot slot--" + slot.type });
      row.appendChild(el("div", { class: "slot__time", text: slot.start }));
      row.appendChild(
        el("div", { class: "slot__body" }, [
          el("div", { class: "slot__label" }, [
            el("span", { text: (slot.type === "study" ? "✏️ " : slot.type === "fixed" ? "📌 " : "☕ ") + slot.label }),
          ]),
        ])
      );
      tl.appendChild(row);
    });
    gridToday.appendChild(card("🕐 今日のタイムテーブル", [tl]));

    // 今日解く問題（タップでチェック）
    const todo = el("ul", { class: "kid-todo" });
    studyBlocks.forEach(function (block) {
      (block.problems || []).forEach(function (pid) {
        const r = reviewById(pid);
        if (!r) return;
        const done = !!state.completedToday[pid];
        todo.appendChild(
          el("li", { class: "checkable" + (done ? " is-done" : ""), attrs: { "data-action": "toggle", "data-id": pid, role: "button", tabindex: "0" } }, [
            el("span", { class: "kid-check" + (done ? " on" : ""), text: done ? "✓" : "" }),
            el("span", { class: "subj-tag", text: r.subject }),
            el("span", {}, [
              el("div", { class: "p", text: r.problem }),
              el("div", { class: "tiny", text: block.start + "〜　" + r.material }),
            ]),
          ])
        );
      });
    });
    gridToday.appendChild(
      card("📝 今日解く問題 <span class='tiny'>（完了したらタップ）</span>", [
        todo,
        el("div", { class: "kid-note", text: prog.done >= prog.total && prog.total > 0 ? "今日のタスク完了！お疲れさま 🎉" : "残り " + (prog.total - prog.done) + " 問" }),
      ])
    );
    root.appendChild(gridToday);

    // ---- ④ 全体の現在地：合格逆算 + 科目別進捗 ----
    const gridOverview = el("div", { class: "grid grid--2" });
    gridOverview.appendChild(renderReversePanel(calc));
    gridOverview.appendChild(renderSubjectProgress());
    root.appendChild(gridOverview);
  }

  /* =============================================================
   * ビュー切替・イベント・初期化
   * ============================================================= */

  const ui = { view: "parent", editing: null };

  function switchView(view) {
    ui.view = view;
    document.querySelectorAll(".tab").forEach(function (t) {
      t.setAttribute("aria-selected", t.dataset.view === view ? "true" : "false");
    });
    document.getElementById("view-kid").hidden = view !== "kid";
    document.getElementById("view-parent").hidden = view !== "parent";
  }

  function renderAll() {
    renderParentView(document.getElementById("view-parent"));
    renderKidView(document.getElementById("view-kid"));
  }

  let flashTimer = null;
  function flash(msg) {
    const bar = document.getElementById("flash");
    if (!bar) return;
    bar.textContent = msg;
    bar.classList.add("show");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      bar.classList.remove("show");
    }, 2600);
  }

  function handleAction(action, dataset, target) {
    if (action === "grade") gradeReview(dataset.id, dataset.result);
    else if (action === "toggle") toggleProblem(dataset.id);
    else if (action === "bump") bumpMaterial(dataset.id, parseInt(dataset.delta, 10));
    else if (action === "reset") {
      if (window.confirm("入力した進捗を破棄して初期データに戻します。よろしいですか？")) resetState();
    } else if (action === "view") switchView(dataset.view);
    // --- スケジュール編集 ---
    else if (action === "edit-slot") {
      ui.editing = dataset.id;
      renderAll();
    } else if (action === "new-slot") {
      ui.editing = "new-slot";
      renderAll();
    } else if (action === "cancel-edit") {
      ui.editing = null;
      renderAll();
    } else if (action === "save-slot") {
      const formEl = target.closest(".slot-form");
      if (!formEl) return;
      const values = readSlotForm(formEl);
      saveSlot(values, dataset.id || null);
    } else if (action === "delete-slot") {
      deleteSlot(dataset.id);
    }
    // --- 問題の追加削除 ---
    else if (action === "new-problem") {
      ui.editing = "new-problem";
      renderAll();
    } else if (action === "save-problem") {
      const formEl = target.closest(".problem-form");
      if (!formEl) return;
      const values = readProblemForm(formEl);
      addProblem(values);
    } else if (action === "delete-problem") {
      deleteProblem(dataset.id);
    }
  }

  function init() {
    if (!SEED) return;
    state = load() || seedState();

    renderAll();
    switchView("parent");

    // クリック委譲（インラインJSなし＝CSP維持）
    document.body.addEventListener("click", function (e) {
      const t = e.target.closest("[data-action]");
      if (!t) return;
      handleAction(t.dataset.action, t.dataset, t);
    });
    // チップ式ラジオ／チェックの即時UI反映＋type切替で関連問題行を出し分け
    document.body.addEventListener("change", function (e) {
      const radio = e.target.closest(".type-chip input[type='radio']");
      if (radio) {
        const group = radio.closest(".type-chips");
        group.querySelectorAll(".type-chip").forEach(function (c) {
          c.classList.toggle("is-active", c.contains(radio) ? radio.checked : false);
        });
        // 学習タイプ以外は関連問題行をグレーアウト
        const form = radio.closest(".slot-form");
        if (form) {
          const row = form.querySelector(".problems-row");
          if (row) row.classList.toggle("is-disabled", radio.value !== "study");
        }
        return;
      }
      const pchk = e.target.closest(".p-chip input[type='checkbox']");
      if (pchk) {
        pchk.closest(".p-chip").classList.toggle("is-active", pchk.checked);
      }
    });
    // キーボード操作（チェック可能項目）
    document.body.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target.closest("[data-action='toggle']");
      if (!t) return;
      e.preventDefault();
      handleAction("toggle", t.dataset, t);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
