/* データ層：Google（スプレッドシート＋ドライブ）とデモ用ローカル保存の2種類 */
(function () {
  "use strict";

  // シートの列定義（1行目は日本語の見出し。順番を変えないこと）
  const TABLES = {
    horses: { sheet: "馬", cols: [
      ["id", "馬ID"], ["name", "馬名"], ["sex", "性別"], ["styles", "脚質"], ["body", "馬体の特徴"],
      ["created", "登録日"], ["updated", "更新日"], ["raceStyle", "レースから見る脚質"]] },
    races: { sheet: "レース", cols: [
      ["id", "レースID"], ["date", "日付"], ["venue", "開催場"], ["raceNo", "レース番号"], ["raceName", "レース名"],
      ["cls", "クラス"], ["surface", "芝／ダート"], ["distance", "距離"], ["going", "馬場状態"],
      ["analysis", "分析結果"], ["analyzedAt", "分析日時"], ["lap", "ラップ"], ["review", "レースのふり返り"],
      ["flow", "レース展開"], ["run1", "1着馬の走り"], ["run2", "2着馬の走り"], ["run3", "3着馬の走り"]] },
    entries: { sheet: "出走", cols: [
      ["id", "出走ID"], ["horseId", "馬ID"], ["raceId", "レースID"], ["umaban", "馬番"],
      ["img1", "後肢伸展時画像"], ["img2", "後肢垂直時画像"], ["anno1", "書き込み1"], ["anno2", "書き込み2"],
      ["finish", "着順"], ["margin", "着差"], ["weight", "馬体重"], ["result", "結果区分"],
      ["prediction", "予想"], ["review", "展開と振返り"], ["created", "登録日"], ["updated", "更新日"]] },
    log: { sheet: "名寄せ履歴", cols: [
      ["at", "日時"], ["kind", "種別"], ["input", "入力名"], ["decision", "判定"], ["horseId", "馬ID"], ["horseName", "馬名"]] }
  };

  const nowStr = () => {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const newId = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  class AuthError extends Error { constructor() { super("ログインの有効期限が切れました"); this.name = "AuthError"; } }
  class NetError extends Error { constructor(m) { super(m); this.name = "NetError"; } }

  /* ---------------- 共通：画像の縮小 ---------------- */
  async function shrinkImage(file, maxSide = 2048) {
    const src = await new Promise((res, rej) => { const r = new FileReader(); r.onerror = () => rej(new Error("read")); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error("decode")); im.src = src; });
    try { if (im.decode) await im.decode(); } catch (e) { /* noop */ }
    const w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) throw new Error("size0");
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const cx = c.getContext("2d"); cx.fillStyle = "#000"; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(im, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
    if (blob && blob.size > 1000) return { blob, width: c.width, height: c.height };
    const raw = await (await fetch(src)).blob();
    return { blob: raw, width: w, height: h };
  }
  const blobToBase64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onerror = rej; r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });

  /* ---------------- 設定（iPad内に保存） ---------------- */
  const Settings = {
    get(k) { try { return localStorage.getItem("horsedb-" + k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { if (v) localStorage.setItem("horsedb-" + k, v); else localStorage.removeItem("horsedb-" + k); } catch (e) { /* noop */ } }
  };

  /* ---------------- Vision API ---------------- */
  async function visionOCR(blob) {
    const key = Settings.get("visionKey");
    if (!key) return { error: "nokey" };
    if (!navigator.onLine) return { error: "offline" };
    const body = { requests: [{ image: { content: await blobToBase64(blob) }, features: [{ type: "TEXT_DETECTION" }], imageContext: { languageHints: ["ja"] } }] };
    let r;
    try {
      r = await fetch("https://vision.googleapis.com/v1/images:annotate?key=" + encodeURIComponent(key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { return { error: "network" }; }
    if (!r.ok) return { error: "http" + r.status };
    const j = await r.json();
    const res = j.responses && j.responses[0];
    if (!res || res.error) return { error: "api" };
    return { words: (res.textAnnotations || []).slice(1), full: (res.textAnnotations && res.textAnnotations[0] && res.textAnnotations[0].description) || "" };
  }

  /* ================= デモモード（このブラウザ内に保存） ================= */
  function LocalBackend() {
    const K = "horsedb-demo-v1";
    let db = { horses: [], races: [], entries: [], log: [] };
    const mem = new Map(); // IndexedDBが使えないときの画像置き場
    let idbP = null;
    function idb() {
      if (idbP) return idbP;
      idbP = new Promise(res => {
        try {
          const rq = indexedDB.open("horsedb-demo", 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore("img");
          rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
        } catch (e) { res(null); }
      });
      return idbP;
    }
    function persist() { try { localStorage.setItem(K, JSON.stringify(db)); } catch (e) { /* noop */ } }
    const urlCache = new Map();
    return {
      mode: "demo",
      async init() { try { const d = JSON.parse(localStorage.getItem(K) || "null"); if (d) db = Object.assign(db, d); } catch (e) { /* noop */ } return true; },
      async loadAll() { return JSON.parse(JSON.stringify({ horses: db.horses, races: db.races, entries: db.entries })); },
      async save(table, obj) {
        const list = db[table]; const i = list.findIndex(x => x.id === obj.id);
        const clean = Object.assign({}, obj); delete clean._row;
        if (i >= 0) list[i] = clean; else list.push(clean);
        persist(); return obj;
      },
      async log(row) { db.log.push(row); persist(); },
      async remove(table, ids) { const s = new Set(ids); db[table] = db[table].filter(x => !s.has(x.id)); persist(); },
      async trashImage(id) {
        if (!id) return; mem.delete(id); if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
        const d = await idb(); if (d) await new Promise(res => { const tx = d.transaction("img", "readwrite"); tx.objectStore("img").delete(id); tx.oncomplete = res; tx.onerror = res; });
      },
      async putImage(blob) {
        const id = newId("img_");
        const d = await idb();
        if (d) { await new Promise(res => { const tx = d.transaction("img", "readwrite"); tx.objectStore("img").put(blob, id); tx.oncomplete = res; tx.onerror = res; }); }
        else mem.set(id, blob);
        return id;
      },
      async imageURL(id) {
        if (!id) return null; if (urlCache.has(id)) return urlCache.get(id);
        let blob = mem.get(id);
        if (!blob) { const d = await idb(); if (d) blob = await new Promise(res => { const rq = d.transaction("img").objectStore("img").get(id); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); }); }
        if (!blob) return null; const u = URL.createObjectURL(blob); urlCache.set(id, u); return u;
      },
      async ocr(blob) { return visionOCR(blob); },
      async reset() { db = { horses: [], races: [], entries: [], log: [] }; persist(); try { indexedDB.deleteDatabase("horsedb-demo"); idbP = null; } catch (e) { /* noop */ } },
      sheetURL: () => null
    };
  }

  /* ================= Google（スプレッドシート＋ドライブ） ================= */
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  // Googleのアクセストークンは1時間で切れる（Google側の決まりで変えられない）。
  // そのため、ログインから最長5時間までは、画面を触ったときに裏で自動的に更新する
  const SESSION_HOURS = 5;
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* noop */ } }, del: k => { try { sessionStorage.removeItem(k); } catch (e) { /* noop */ } } };
  const Auth = {
    token: null, exp: 0, loginAt: 0, pending: null,
    limitAt() { return this.loginAt ? this.loginAt + SESSION_HOURS * 3600000 : 0; },
    setToken(t, sec) {
      this.token = t; this.exp = Math.min(Date.now() + (sec || 3600) * 1000, this.limitAt() || Infinity);
      ss.set("horsedb-token", t); ss.set("horsedb-exp", String(this.exp));
    },
    redirectURI() { return location.origin + location.pathname.replace(/index\.html$/, ""); },
    // ログイン後に戻ってきたとき、URLの#からトークンを取り出す
    consumeRedirect() {
      const h = location.hash;
      if (!/access_token=/.test(h)) {
        if (/error=/.test(h)) { history.replaceState(null, "", location.pathname + "#/"); return "error"; }
        this.loginAt = +ss.get("horsedb-loginAt") || 0;
        const t = ss.get("horsedb-token"), e = +ss.get("horsedb-exp");
        if (t && e > Date.now() + 60000) { this.token = t; this.exp = e; if (!this.loginAt) { this.loginAt = Date.now(); ss.set("horsedb-loginAt", String(this.loginAt)); } }
        return null;
      }
      const p = new URLSearchParams(h.slice(1));
      const state = p.get("state") || "";
      let expected = ""; try { expected = sessionStorage.getItem("horsedb-state") || ""; } catch (e) { /* noop */ }
      let back = "#/";
      if (state && state === expected.split("|")[0]) {
        back = expected.split("|")[1] || "#/";
        // 同じタブ内だけで保持（タブやアプリを閉じれば消える）。ここから5時間を数える
        this.loginAt = Date.now(); ss.set("horsedb-loginAt", String(this.loginAt));
        this.setToken(p.get("access_token"), +p.get("expires_in") || 3600);
      }
      try { sessionStorage.removeItem("horsedb-state"); } catch (e) { /* noop */ }
      history.replaceState(null, "", location.pathname + back);
      return this.token ? "ok" : "error";
    },
    valid() { return this.token && this.exp > Date.now() + 30000; },
    minutesLeft() { return this.token ? Math.max(0, Math.round((this.exp - Date.now()) / 60000)) : 0; },
    sessionMinutesLeft() { return this.token ? Math.max(0, Math.round((this.limitAt() - Date.now()) / 60000)) : 0; },
    // 更新が必要か：トークンの残りが15分を切っていて、5時間の上限まではまだ余裕がある
    needsRenew() {
      const now = Date.now(), lim = this.limitAt();
      return !!(this.token && lim && !this.pending && lim - now > 120000 && this.exp < lim && this.exp - now < 15 * 60000 && window.google && google.accounts && google.accounts.oauth2);
    },
    // 画面を触った（クリック・タップ）ときに呼ぶ。Googleの小さな画面が一瞬開いて、確認なしで新しいトークンを受け取る
    renew() {
      if (!this.needsRenew()) return this.pending;
      this.pending = new Promise(resolve => {
        const done = ok => { this.pending = null; resolve(ok); };
        try {
          const opt = { client_id: window.APP_CONFIG.clientId, scope: SCOPE, prompt: "",
            callback: r => { if (r && r.access_token) { this.setToken(r.access_token, +r.expires_in || 3600); done(true); } else done(false); },
            error_callback: () => done(false) };
          const hint = ss.get("horsedb-hint"); if (hint) opt.hint = hint;
          google.accounts.oauth2.initTokenClient(opt).requestAccessToken();
        } catch (e) { done(false); }
        setTimeout(() => { if (this.pending) done(false); }, 60000);
      });
      return this.pending;
    },
    // 自動更新でアカウントを選ぶ画面を出さないため、ログイン中のアカウントを覚えておく
    async loadHint() {
      if (ss.get("horsedb-hint") || !this.valid()) return;
      try { const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { Authorization: "Bearer " + this.token } }); const j = await r.json(); if (j.user && j.user.emailAddress) ss.set("horsedb-hint", j.user.emailAddress); } catch (e) { /* noop */ }
    },
    login(returnHash) {
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { sessionStorage.setItem("horsedb-state", state + "|" + (returnHash || location.hash || "#/")); } catch (e) { /* noop */ }
      const q = new URLSearchParams({ client_id: window.APP_CONFIG.clientId, redirect_uri: this.redirectURI(), response_type: "token", scope: SCOPE, include_granted_scopes: "true", state, prompt: "select_account" });
      location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
    },
    logout() {
      const t = this.token; this.token = null; this.exp = 0;
      this.loginAt = 0; ["horsedb-token", "horsedb-exp", "horsedb-loginAt", "horsedb-hint"].forEach(ss.del);
      if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t), { method: "POST" }).catch(() => {});
    }
  };

  function GoogleBackend() {
    let ids = { folder: "", images: "", sheet: "" };
    try { ids = Object.assign(ids, JSON.parse(localStorage.getItem("horsedb-ids") || "{}")); } catch (e) { /* noop */ }
    const saveIds = () => { try { localStorage.setItem("horsedb-ids", JSON.stringify(ids)); } catch (e) { /* noop */ } };
    const urlCache = new Map();
    let dirty = {}; // 行を削除したシート：以後の保存は行番号をIDで探し直す

    async function api(url, opt = {}) {
      if (!Auth.valid() && Auth.pending) await Auth.pending; // 自動更新の途中なら待つ
      if (!Auth.valid()) throw new AuthError();
      if (!navigator.onLine) throw new NetError("通信できません。電波の良い場所でもう一度保存してください");
      let r;
      try { r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + Auth.token }, opt.headers || {}) })); }
      catch (e) { throw new NetError("通信に失敗しました。もう一度お試しください"); }
      if (r.status === 401) throw new AuthError();
      if (!r.ok) { let m = ""; try { m = (await r.json()).error.message; } catch (e) { /* noop */ } throw new NetError("Googleとの通信でエラーが起きました（" + r.status + (m ? "：" + m : "") + "）"); }
      return r;
    }
    const J = { "Content-Type": "application/json" };
    const DRIVE = "https://www.googleapis.com/drive/v3/files";
    const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";

    async function exists(id) {
      if (!id) return false;
      try { const r = await api(DRIVE + "/" + id + "?fields=id,trashed"); const j = await r.json(); return !j.trashed; } catch (e) { if (e instanceof AuthError) throw e; return false; }
    }
    async function findByName(name, mime, parent) {
      const q = [`name='${name}'`, `mimeType='${mime}'`, "trashed=false"]; if (parent) q.push(`'${parent}' in parents`);
      const r = await api(DRIVE + "?q=" + encodeURIComponent(q.join(" and ")) + "&fields=files(id,name)&spaces=drive");
      const j = await r.json(); return j.files && j.files[0] ? j.files[0].id : "";
    }
    async function create(name, mime, parent) {
      const meta = { name, mimeType: mime }; if (parent) meta.parents = [parent];
      const r = await api(DRIVE + "?fields=id", { method: "POST", headers: J, body: JSON.stringify(meta) });
      return (await r.json()).id;
    }
    const FOLDER = "application/vnd.google-apps.folder", SHEET = "application/vnd.google-apps.spreadsheet";

    async function setupSheet(id) {
      const info = await (await api(SHEETS + id + "?fields=sheets.properties")).json();
      const have = info.sheets.map(s => s.properties.title);
      const reqs = [];
      Object.values(TABLES).forEach(t => { if (!have.includes(t.sheet)) reqs.push({ addSheet: { properties: { title: t.sheet, gridProperties: { frozenRowCount: 1 } } } }); });
      if (reqs.length) {
        await api(SHEETS + id + ":batchUpdate", { method: "POST", headers: J, body: JSON.stringify({ requests: reqs }) });
        const def = info.sheets.find(s => !Object.values(TABLES).some(t => t.sheet === s.properties.title));
        if (def && info.sheets.length === 1) await api(SHEETS + id + ":batchUpdate", { method: "POST", headers: J, body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: def.properties.sheetId } }] }) });
        await api(SHEETS + id + "/values:batchUpdate", { method: "POST", headers: J, body: JSON.stringify({ valueInputOption: "RAW", data: Object.values(TABLES).map(t => ({ range: `'${t.sheet}'!A1`, values: [t.cols.map(c => c[1])] })) }) });
        return;
      }
      // 版が上がって列が増えたときは、既存のシートの見出し行に足りない見出しを書き足す（データは触らない）
      const ts = Object.values(TABLES);
      const hd = await (await api(SHEETS + id + "/values:batchGet?" + ts.map(t => "ranges=" + encodeURIComponent(`'${t.sheet}'!1:1`)).join("&"))).json();
      const fix = [];
      // 版32で「レースからみる脚質」を登録日の前に入れてしまい、既存の登録日が脚質の欄に見えていたのを直す。
      // その版で保存した行（更新日の位置に日付がある行）は並べ替え、それ以外の行はそのまま。日付だけの脚質は消す
      const hcur = ((hd.valueRanges[0] || {}).values || [[]])[0] || [];
      if (hcur[5] === "レースからみる脚質" && hcur[6] === "登録日") {
        const rows = (((await (await api(SHEETS + id + "/values/" + encodeURIComponent("'馬'!A2:H"))).json()).values) || []);
        const isDate = v => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(String(v || "").trim());
        const fixed = rows.map(r => { const a = r.slice(0, 5); while (a.length < 5) a.push(""); const [f = "", g = "", h = ""] = r.slice(5, 8);
          return isDate(h) ? [...a, g, h, isDate(f) ? "" : f] : [...a, f, g, isDate(h) || h === "" ? "" : h]; });
        if (fixed.length) fix.push({ range: "'馬'!A2:H" + (fixed.length + 1), values: fixed });
      }
      ts.forEach((t, i) => { const cur = ((hd.valueRanges[i] || {}).values || [[]])[0] || []; if (t.cols.some((c, j) => cur[j] !== c[1])) fix.push({ range: `'${t.sheet}'!A1`, values: [t.cols.map(c => c[1])] }); });
      if (fix.length) await api(SHEETS + id + "/values:batchUpdate", { method: "POST", headers: J, body: JSON.stringify({ valueInputOption: "RAW", data: fix }) });
    }

    const toRow = (table, o) => TABLES[table].cols.map(([k]) => o[k] == null ? "" : String(o[k]));
    const fromRow = (table, row, idx) => { const o = { _row: idx + 2 }; TABLES[table].cols.forEach(([k], i) => { o[k] = row[i] == null ? "" : row[i]; }); return o; };

    return {
      mode: "google",
      async init() {
        if (!Auth.valid()) return false;
        if (!(await exists(ids.folder))) { ids.folder = await findByName(window.APP_CONFIG.appName, FOLDER) || await create(window.APP_CONFIG.appName, FOLDER); }
        if (!(await exists(ids.images))) { ids.images = await findByName("画像", FOLDER, ids.folder) || await create("画像", FOLDER, ids.folder); }
        if (!(await exists(ids.sheet))) { ids.sheet = await findByName(window.APP_CONFIG.appName, SHEET, ids.folder) || await create(window.APP_CONFIG.appName, SHEET, ids.folder); }
        saveIds();
        await setupSheet(ids.sheet);
        return true;
      },
      async loadAll() {
        dirty = {};
        const ranges = ["horses", "races", "entries"].map(t => `ranges=${encodeURIComponent("'" + TABLES[t].sheet + "'!A2:Z")}`).join("&");
        const j = await (await api(SHEETS + ids.sheet + "/values:batchGet?" + ranges)).json();
        const out = {};
        ["horses", "races", "entries"].forEach((t, i) => {
          const rows = (j.valueRanges[i] && j.valueRanges[i].values) || [];
          out[t] = rows.map((r, idx) => fromRow(t, r, idx)).filter(o => o.id);
        });
        return out;
      },
      async save(table, obj) {
        const sheet = TABLES[table].sheet, row = toRow(table, obj);
        if (dirty[table]) {
          const col = await (await api(SHEETS + ids.sheet + "/values/" + encodeURIComponent(`'${sheet}'!A2:A`))).json();
          const i = (col.values || []).findIndex(r => r[0] === obj.id);
          if (i >= 0) obj._row = i + 2; else delete obj._row;
        }
        if (obj._row) {
          await api(SHEETS + ids.sheet + "/values/" + encodeURIComponent(`'${sheet}'!A${obj._row}`) + "?valueInputOption=RAW", { method: "PUT", headers: J, body: JSON.stringify({ values: [row] }) });
        } else {
          const r = await api(SHEETS + ids.sheet + "/values/" + encodeURIComponent(`'${sheet}'!A1`) + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", { method: "POST", headers: J, body: JSON.stringify({ values: [row] }) });
          const j = await r.json(); const m = /![A-Z]+(\d+)/.exec(j.updates && j.updates.updatedRange || "");
          if (m) obj._row = +m[1];
        }
        return obj;
      },
      // 行の削除：IDの列を読み直して該当行を特定し、下の行から順に消す（行番号のずれを防ぐ）
      async remove(table, idList) {
        if (!idList.length) return;
        const sheet = TABLES[table].sheet, want = new Set(idList);
        const col = await (await api(SHEETS + ids.sheet + "/values/" + encodeURIComponent(`'${sheet}'!A2:A`))).json();
        const rows = []; (col.values || []).forEach((r, i) => { if (want.has(r[0])) rows.push(i + 1); }); // 0始まりの行番号（見出し=0）
        if (!rows.length) return;
        dirty[table] = true;
        const info = await (await api(SHEETS + ids.sheet + "?fields=sheets.properties")).json();
        const sh = info.sheets.find(s => s.properties.title === sheet); if (!sh) return;
        rows.sort((a, b) => b - a);
        await api(SHEETS + ids.sheet + ":batchUpdate", { method: "POST", headers: J, body: JSON.stringify({ requests: rows.map(r => ({ deleteDimension: { range: { sheetId: sh.properties.sheetId, dimension: "ROWS", startIndex: r, endIndex: r + 1 } } })) }) });
      },
      // 画像はドライブのゴミ箱へ（30日間は復元できる）
      async trashImage(id) {
        if (!id) return;
        try { await api(DRIVE + "/" + id, { method: "PATCH", headers: J, body: JSON.stringify({ trashed: true }) }); } catch (e) { if (e instanceof AuthError) throw e; }
        if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
      },
      async log(row) {
        try { await api(SHEETS + ids.sheet + "/values/" + encodeURIComponent(`'${TABLES.log.sheet}'!A1`) + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", { method: "POST", headers: J, body: JSON.stringify({ values: [toRow("log", row)] }) }); } catch (e) { /* 履歴の失敗は無視 */ }
      },
      async putImage(blob, name) {
        const meta = { name: name || ("paddock_" + Date.now() + ".jpg"), parents: [ids.images] };
        const bd = "hdb" + Math.random().toString(36).slice(2);
        const body = new Blob([`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: ${blob.type || "image/jpeg"}\r\n\r\n`, blob, `\r\n--${bd}--`]);
        const r = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + bd }, body });
        return (await r.json()).id;
      },
      async imageURL(id) {
        if (!id) return null; if (urlCache.has(id)) return urlCache.get(id);
        const r = await api(DRIVE + "/" + id + "?alt=media"); const u = URL.createObjectURL(await r.blob()); urlCache.set(id, u); return u;
      },
      async ocr(blob) { return visionOCR(blob); },
      sheetURL: () => ids.sheet ? "https://docs.google.com/spreadsheets/d/" + ids.sheet + "/edit" : null
    };
  }

  window.Store = { TABLES, AuthError, NetError, Auth, Settings, LocalBackend, GoogleBackend, shrinkImage, newId, nowStr };
})();
