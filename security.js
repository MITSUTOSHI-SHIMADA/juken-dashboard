/* =============================================================
 * セキュリティモジュール
 * -------------------------------------------------------------
 *  - パスコードから PBKDF2 で鍵を導出
 *  - localStorage の保存内容を AES-GCM で暗号化
 *  - 自動ロック（操作なしN分）
 *  - 暗号化バックアップの書き出し / 読み込み
 *
 *  外部に一切通信しません。すべて端末ブラウザ内で完結。
 * ============================================================= */
(function () {
  "use strict";

  const KEY_STATE   = "uni-exam-pm-state";        // 暗号化された state
  const KEY_META    = "uni-exam-pm-security";     // salt / iterations 等のメタ
  const KEY_DRAFT   = "uni-exam-pm-state-plain";  // パスコード未設定時の平文保存

  const IDLE_LOCK_MS = 15 * 60 * 1000;             // 15分操作なしで自動ロック
  const PBKDF2_ITER  = 250000;
  const SALT_BYTES   = 16;
  const IV_BYTES     = 12;

  /* ---------- 内部ユーティリティ ---------- */

  function rndBytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }
  function b64encode(bytes) {
    let s = "";
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function b64decode(str) {
    const bin = atob(str);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function strToBytes(s) { return new TextEncoder().encode(s); }
  function bytesToStr(b) { return new TextDecoder().decode(b); }

  /* ---------- 鍵導出 ---------- */

  async function deriveKey(passcode, saltBytes, iter) {
    const baseKey = await crypto.subtle.importKey(
      "raw", strToBytes(passcode), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: iter || PBKDF2_ITER, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptObject(obj, key) {
    const iv = rndBytes(IV_BYTES);
    const data = strToBytes(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return { iv: b64encode(iv), ct: b64encode(cipher) };
  }
  async function decryptObject(payload, key) {
    const iv = b64decode(payload.iv);
    const ct = b64decode(payload.ct);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(bytesToStr(plain));
  }

  /* ---------- ストレージ操作 ---------- */

  function getMeta() {
    try {
      const raw = localStorage.getItem(KEY_META);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function isPasscodeSet() {
    const m = getMeta();
    return !!(m && m.salt && m.iter && m.verifier);
  }

  function clearAll() {
    try {
      localStorage.removeItem(KEY_STATE);
      localStorage.removeItem(KEY_META);
      localStorage.removeItem(KEY_DRAFT);
    } catch (e) {}
  }

  /* ---------- 公開API ---------- */

  // パスコードを新規設定 or 変更
  // 既存ステート（plainでもencでも）があれば、新パスコードで再暗号化して保存
  const PASS_RE = /^[A-Za-z0-9]+$/;
  const PASS_MIN = 6;
  function validatePass(p) {
    if (!p || p.length < PASS_MIN) return "パスコードは英数字" + PASS_MIN + "文字以上にしてください";
    if (!PASS_RE.test(p)) return "パスコードは英字（A〜Z, a〜z）と数字（0〜9）のみ使えます";
    return null;
  }
  async function setPasscode(newPass, currentPass) {
    const err = validatePass(newPass);
    if (err) throw new Error(err);
    // 現在のstateを取り出す
    let currentState = null;
    if (isPasscodeSet()) {
      if (!currentPass) throw new Error("現在のパスコードが必要です");
      currentState = await loadState(currentPass);
      if (currentState === null) throw new Error("現在のパスコードが違います");
    } else {
      // 平文stateがあれば取り出す
      try {
        const raw = localStorage.getItem(KEY_DRAFT);
        if (raw) currentState = JSON.parse(raw);
      } catch (e) {}
    }

    const salt = rndBytes(SALT_BYTES);
    const iter = PBKDF2_ITER;
    const key = await deriveKey(newPass, salt, iter);

    // 検証用トークン（パスコード正誤判定のため）
    const verifierObj = { v: "ok", t: Date.now() };
    const verifierEnc = await encryptObject(verifierObj, key);

    localStorage.setItem(KEY_META, JSON.stringify({
      salt: b64encode(salt),
      iter: iter,
      verifier: verifierEnc,
      createdAt: Date.now(),
    }));

    // 旧 plain ステートを削除（暗号化版に移行）
    localStorage.removeItem(KEY_DRAFT);

    // current state があれば暗号化して保存
    if (currentState) {
      const enc = await encryptObject(currentState, key);
      localStorage.setItem(KEY_STATE, JSON.stringify(enc));
    }

    return true;
  }

  // パスコードを解除（暗号化を外して平文に戻す）
  async function removePasscode(currentPass) {
    if (!isPasscodeSet()) return true;
    const state = await loadState(currentPass);
    if (state === null) throw new Error("パスコードが違います");
    localStorage.removeItem(KEY_META);
    localStorage.removeItem(KEY_STATE);
    if (state) localStorage.setItem(KEY_DRAFT, JSON.stringify(state));
    return true;
  }

  // パスコードでstateを取り出す。失敗時 null
  // パスコード未設定の場合は平文 stateを返す
  async function loadState(passcode) {
    if (!isPasscodeSet()) {
      try {
        const raw = localStorage.getItem(KEY_DRAFT);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    try {
      const meta = getMeta();
      if (!meta) return null;
      const salt = b64decode(meta.salt);
      const key = await deriveKey(passcode, salt, meta.iter || PBKDF2_ITER);
      // verifier を試し復号
      try { await decryptObject(meta.verifier, key); }
      catch (e) { return null; /* パスコード誤り */ }

      const raw = localStorage.getItem(KEY_STATE);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return await decryptObject(parsed, key);
    } catch (e) {
      return null;
    }
  }

  // stateを保存
  async function saveState(state, passcode) {
    if (!isPasscodeSet()) {
      try { localStorage.setItem(KEY_DRAFT, JSON.stringify(state)); }
      catch (e) {}
      return;
    }
    const meta = getMeta();
    const salt = b64decode(meta.salt);
    const key = await deriveKey(passcode, salt, meta.iter || PBKDF2_ITER);
    const enc = await encryptObject(state, key);
    localStorage.setItem(KEY_STATE, JSON.stringify(enc));
  }

  // パスコード判定だけ（true: 正しい）
  async function verifyPasscode(passcode) {
    if (!isPasscodeSet()) return true;
    const r = await loadState(passcode);
    return r !== null;
  }

  /* ---------- 自動ロック ---------- */

  let idleTimer = null;
  let onIdleLock = null;
  function startIdleTimer(cb) {
    onIdleLock = cb;
    resetIdleTimer();
    ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach(ev => {
      window.addEventListener(ev, resetIdleTimer, { passive: true });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        // タブを離れたら即ロックではないが、復帰時にチェックする
      }
    });
  }
  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (typeof onIdleLock === "function") onIdleLock();
    }, IDLE_LOCK_MS);
  }
  function stopIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  /* ---------- 暗号化バックアップ（書き出し / 読み込み） ---------- */

  // 暗号化済みのバックアップJSONを作る（パスコードで保護）
  // ファイルに書き出して別端末で復元できる
  async function exportBackup(state, password) {
    const verr = validatePass(password);
    if (verr) throw new Error(verr);
    const salt = rndBytes(SALT_BYTES);
    const iter = PBKDF2_ITER;
    const key = await deriveKey(password, salt, iter);
    const enc = await encryptObject(state, key);
    return {
      magic: "juken-dashboard-backup",
      version: 1,
      salt: b64encode(salt),
      iter: iter,
      payload: enc,
      exportedAt: new Date().toISOString(),
    };
  }
  async function importBackup(backup, password) {
    if (!backup || backup.magic !== "juken-dashboard-backup") {
      throw new Error("バックアップファイルの形式が違います");
    }
    const salt = b64decode(backup.salt);
    const key = await deriveKey(password, salt, backup.iter || PBKDF2_ITER);
    try {
      return await decryptObject(backup.payload, key);
    } catch (e) {
      throw new Error("パスワードが違います");
    }
  }

  // 平文 JSON で保存しているとき用の単純なエクスポート
  function exportPlain(state) {
    return {
      magic: "juken-dashboard-plain",
      version: 1,
      state: state,
      exportedAt: new Date().toISOString(),
    };
  }
  function importPlain(obj) {
    if (!obj || obj.magic !== "juken-dashboard-plain") {
      throw new Error("バックアップファイルの形式が違います");
    }
    return obj.state;
  }

  window.SECURITY = {
    isPasscodeSet,
    setPasscode,
    removePasscode,
    validatePass,
    PASS_MIN,
    loadState,
    saveState,
    verifyPasscode,
    clearAll,
    startIdleTimer,
    resetIdleTimer,
    stopIdleTimer,
    exportBackup,
    importBackup,
    exportPlain,
    importPlain,
    IDLE_LOCK_MS,
  };
})();
