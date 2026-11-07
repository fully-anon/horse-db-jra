/* 競走馬DB：画面 */
(function () {
  "use strict";
  const { Auth, Settings, AuthError, NetError, shrinkImage, newId, nowStr } = window.Store;
  const { VENUES, parsePaddock, matchHorse, normName, parseResultImages, normLap, lapPairs, lapMarks, formatLap } = window.Paddock;
  const CLASSES = ["新馬", "未勝利", "1勝", "2勝", "3勝", "OP", "L", "G3", "G2", "G1"];
  const SURFACES = ["芝", "ダート"], GOINGS = ["良", "稍重", "重", "不良"], SEXES = ["牡", "牝", "セン"];
  const STYLES = ["逃げ", "先行", "差し", "追込", "自在"], RESULTS = ["好走", "凡走", "大敗"];
  const SLOT = ["後肢伸展時", "後肢垂直時"];

  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = s => document.querySelector(s);
  const main = () => $("#main");
  const demo = !(window.APP_CONFIG && window.APP_CONFIG.clientId);
  const B = demo ? window.Store.LocalBackend() : window.Store.GoogleBackend();
  let D = { horses: [], races: [], entries: [] };
  let ready = false;

  /* ---------------- 小物 ---------------- */
  let toastT;
  function toast(t) {
    let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3200);
  }
  function banner(msg, kind = "warn") { return `<div class="banner ${kind}" role="alert">${msg}</div>`; }
  const opts = (list, cur, blank = true) => (blank ? `<option value="">—</option>` : "") + list.map(v => `<option ${String(v) === String(cur) ? "selected" : ""}>${esc(v)}</option>`).join("");
  const horse = id => D.horses.find(h => h.id === id);
  const race = id => D.races.find(r => r.id === id);
  const entry = id => D.entries.find(e => e.id === id);
  const raceKey = (date, venue, no) => `${date}|${venue}|${String(+no || "")}`;
  const findRace = (date, venue, no) => D.races.find(r => raceKey(r.date, r.venue, r.raceNo) === raceKey(date, venue, no));
  const recentNoDate = (venue, no) => { const lim = Date.now() - 3 * 864e5; return D.races.find(r => !r.date && r.venue === venue && String(+r.raceNo) === String(+no) && Date.parse(String(r.updated || "").replace(" ", "T")) >= lim); };
  const raceTitle = r => r ? `${r.date || "日付未入力"} ${r.venue || ""}${r.raceNo ? r.raceNo + "R" : ""}${r.raceName ? " " + r.raceName : ""}` : "（レース不明）";
  const raceCond = r => [r.cls, r.surface && r.distance ? r.surface + r.distance + "m" : (r.surface || (r.distance ? r.distance + "m" : "")), r.going].filter(Boolean).join("・");
  const styles = h => (h && h.styles ? String(h.styles).split(",").filter(Boolean) : []);
  const parseJSON = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
  function entriesOfHorse(hid) { return D.entries.filter(e => e.horseId === hid).sort((a, b) => String((race(b.raceId) || {}).date).localeCompare(String((race(a.raceId) || {}).date))); }
  function entriesOfRace(rid) { return D.entries.filter(e => e.raceId === rid).sort((a, b) => (+a.umaban || 99) - (+b.umaban || 99)); }
  function goodSummary(hid) {
    const good = entriesOfHorse(hid).filter(e => e.result === "好走");
    const paces = good.filter(e => e.review).map(e => ({ text: e.review, race: race(e.raceId) }));
    const ws = good.map(e => +e.weight).filter(w => w > 0);
    return { count: good.length, paces, weight: ws.length ? (Math.min(...ws) === Math.max(...ws) ? `${ws[0]}kg` : `${Math.min(...ws)}〜${Math.max(...ws)}kg`) : "" };
  }

  /* ---------------- ラップ：距離とタイムを組で表示・入力 ---------------- */
  function lapTable(lap, distance) {
    const pr = lapPairs(lap, distance); if (!pr.length) return "";
    return `<div class="laptable"><table><thead><tr><th scope="row">距離</th>${pr.map((p, j) => `<th>${p.m ? p.m + "m" : (j + 1) + "F"}</th>`).join("")}</tr></thead>
      <tbody><tr><th scope="row">ラップ</th>${pr.map(p => `<td>${esc(p.t)}</td>`).join("")}</tr></tbody></table></div>`;
  }
  // 入力欄：p は id の頭（"r"、"iv_" など）。距離の欄は p+"distance"
  function lapCells(pairs, distance) {
    let pr = pairs.slice();
    const n = Math.ceil((+distance || 0) / 200);
    if (!pr.length && n) pr = (lapMarks(distance, n) || []).map(m => ({ m, t: "" }));
    if (!pr.length) return `<p class="muted lapnote">距離を入れると、200mごとの入力欄が出ます。下の欄にまとめて貼り付けることもできます。</p>`;
    const warn = +distance && pr.some(x => !x.m) ? `<p class="miss lapwarn">ラップが${pr.length}区間あり、距離${+distance}mの${n}区間と合いません。距離か値を確認してください</p>` : "";
    return warn + pr.map((x, j) => `<label class="lapc"><span>${x.m ? x.m + "m" : (j + 1) + "F"}</span><input type="text" inputmode="decimal" data-m="${x.m || ""}" value="${esc(x.t)}" aria-label="${x.m ? x.m + "m" : (j + 1) + "ハロン目"}のラップ"></label>`).join("");
  }
  function lapEditor(p, lap, distance) {
    return `<div class="lapbox" data-p="${p}"><div class="lapgrid" id="${p}lapgrid">${lapCells(lapPairs(lap, distance), distance)}</div>
      <input type="text" class="lappaste" id="${p}lapPaste" placeholder="まとめて入力：12.2-11.2-11.6…（区切りは空白でも可）" inputmode="decimal" autocomplete="off" aria-label="ラップをまとめて入力"></div>`;
  }
  function readLap(p) {
    const dist = ($("#" + p + "distance") || {}).value || "";
    const paste = ($("#" + p + "lapPaste") || {}).value || "";
    if (paste.trim()) return normLap(paste, dist);
    const pr = [...document.querySelectorAll("#" + CSS.escape(p) + "lapgrid input")].map(i => ({ m: +i.dataset.m || null, t: i.value.trim() })).filter(x => /^\d{1,2}(\.\d)?$/.test(x.t)).map(x => ({ m: x.m, t: (+x.t).toFixed(1) }));
    return normLap(formatLap(pr), dist);
  }
  // まとめて入力した値や、距離の変更を入力欄に反映
  document.addEventListener("input", e => {
    const el = e.target; if (!el.id) return;
    let p = null;
    if (el.classList.contains("lappaste")) p = el.id.replace(/lapPaste$/, "");
    else if (/distance$/.test(el.id) && $("#" + el.id.replace(/distance$/, "") + "lapgrid")) p = el.id.replace(/distance$/, "");
    if (p === null) return;
    const grid = $("#" + p + "lapgrid"), dist = ($("#" + p + "distance") || {}).value || "";
    const pasteVal = ($("#" + p + "lapPaste") || {}).value || "";
    const cur = [...grid.querySelectorAll("input")].map(i => i.value.trim()).filter(Boolean);
    const src = el.classList.contains("lappaste") ? pasteVal : (cur.length ? cur.join("-") : "");
    grid.innerHTML = lapCells(lapPairs(src, dist), dist);
  });

  /* ---------------- 画像の貼り付け ---------------- */
  // ボタンから：クリップボードの画像を読む（ブラウザが確認を求めることがあります）
  async function readClipboardImage() {
    if (!navigator.clipboard || !navigator.clipboard.read) return null;
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find(x => x.startsWith("image/"));
        if (t) { const b = await it.getType(t); return new File([b], "paste." + (t.split("/")[1] || "png"), { type: t }); }
      }
      return "noimage";
    } catch (e) { return null; }
  }
  // Ctrl+V や長押しメニューの「ペースト」から
  function imageFromPasteEvent(e) {
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const it = items.find(x => x.kind === "file" && x.type.startsWith("image/"));
    return it ? it.getAsFile() : null;
  }
  let onPaste = null; // 表示中の画面の貼り付け処理
  document.addEventListener("paste", e => {
    if (!onPaste) return;
    const t = e.target; if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "file")) && !imageFromPasteEvent(e)) return;
    onPaste(e);
  });

  /* ---------------- 保存と通信エラー ---------------- */
  async function save(table, obj) {
    const t = nowStr(); obj.updated = t; if (table !== "races" && !obj.created) obj.created = t;
    await B.save(table, obj);
    const list = D[table]; const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = obj; else list.push(obj);
    return obj;
  }
  // 画面上の入力内容を一時保存して、ログインし直しても消えないようにする
  function collectDraft() { const v = {}; document.querySelectorAll("#main [data-f]").forEach(el => { v[el.dataset.f + (el.type === "checkbox" ? ":" + el.value : "")] = el.type === "checkbox" ? el.checked : el.value; }); return v; }
  function applyDraft() {
    let d; try { d = JSON.parse(sessionStorage.getItem("horsedb-draft") || "null"); } catch (e) { d = null; }
    if (!d || d.hash !== location.hash) return;
    document.querySelectorAll("#main [data-f]").forEach(el => { const k = el.dataset.f + (el.type === "checkbox" ? ":" + el.value : ""); if (k in d.v) { if (el.type === "checkbox") el.checked = d.v[k]; else el.value = d.v[k]; } });
    try { sessionStorage.removeItem("horsedb-draft"); } catch (e) { /* noop */ }
    toast("ログイン前の入力内容を戻しました。もう一度保存してください");
  }
  async function run(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "保存中…"; }
    try { return await fn(); }
    catch (e) {
      if (e instanceof AuthError) { showRelogin(); }
      else if (e instanceof NetError) { showError(e.message); }
      else { console.error(e); showError("予期しないエラーが起きました（" + esc(e.message || e) + "）"); }
    } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
  }
  /* ---------------- 削除 ---------------- */
  // 出走記録を消す（画像はドライブのゴミ箱へ）。その後データを読み直して行番号を最新にする
  async function removeEntries(list) {
    for (const en of list) { await B.trashImage(en.img1); await B.trashImage(en.img2); }
    await B.remove("entries", list.map(x => x.id));
    const s = new Set(list.map(x => x.id)); D.entries = D.entries.filter(x => !s.has(x.id));
  }
  async function reloadData() { if (!demo) D = await B.loadAll(); }
  // ページ内の確認欄（ブラウザの確認ダイアログは使わない）
  function askDelete(box, html, label, onYes) {
    box.innerHTML = `<div class="confirm danger-zone"><p class="msg">${html}</p><div class="row"><button class="btn danger strong" data-yes>${esc(label)}</button><button class="btn" data-no>やめる</button></div></div>`;
    box.querySelector("[data-no]").onclick = () => { box.innerHTML = ""; };
    box.querySelector("[data-yes]").onclick = e => run(e.target, onYes);
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const imgCount = list => list.reduce((n, en) => n + (en.img1 ? 1 : 0) + (en.img2 ? 1 : 0), 0);

  function showError(msg) { const box = $("#alerts"); box.innerHTML = banner(esc(msg), "error"); box.scrollIntoView({ block: "nearest" }); }
  function showRelogin() {
    const box = $("#alerts");
    box.innerHTML = banner(`ログインの有効期限が切れました。入力内容は保持したまま、ログインし直せます。 <button class="btn primary" id="relogin">Googleでログインし直す</button>`, "error");
    $("#relogin").onclick = () => { try { sessionStorage.setItem("horsedb-draft", JSON.stringify({ hash: location.hash, v: collectDraft() })); } catch (e) { /* noop */ } Auth.login(location.hash); };
  }

  /* ---------------- ルーティング ---------------- */
  const routes = { "": viewRaces, races: viewRaces, race: viewRace, horses: viewHorses, horse: viewHorse, new: () => go("#/import/card"), import: viewImport, entry: viewEntry, settings: viewSettings };
  function render() {
    if (!ready) return;
    const [, name = "", id = ""] = (location.hash.replace(/^#\/?/, "#/").match(/^#\/([^/]*)\/?(.*)$/) || []);
    const fn = routes[name] || viewRaces;
    document.querySelectorAll(".nav a").forEach(a => a.setAttribute("aria-current", a.dataset.nav === (name === "race" ? "races" : name === "horse" ? "horses" : name === "entry" ? "" : name || "races") ? "page" : "false"));
    $("#alerts").innerHTML = ""; onPaste = null;
    const old = main(), fresh = old.cloneNode(false); old.replaceWith(fresh); // 前の画面のイベントを消す
    fn(decodeURIComponent(id));
    applyDraft();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", render);
  const go = h => { if (location.hash === h) render(); else location.hash = h; };

  /* ================= レース一覧 ================= */
  function raceForm(r, idp = "r") {
    return `<div class="grid form">
      <label>日付<input type="date" data-f="${idp}date" id="${idp}date" value="${esc(r.date)}"></label>
      <label>開催場<input type="text" data-f="${idp}venue" id="${idp}venue" list="venues" value="${esc(r.venue)}" placeholder="京都"></label>
      <label>レース番号<input type="number" inputmode="numeric" min="1" max="12" data-f="${idp}raceNo" id="${idp}raceNo" value="${esc(r.raceNo)}" placeholder="11"></label>
      <label>レース名<input type="text" data-f="${idp}raceName" id="${idp}raceName" value="${esc(r.raceName)}"></label>
      <label>クラス<select data-f="${idp}cls" id="${idp}cls">${opts(CLASSES, r.cls)}</select></label>
      <label>芝／ダート<select data-f="${idp}surface" id="${idp}surface">${opts(SURFACES, r.surface)}</select></label>
      <label>距離（m）<input type="number" inputmode="numeric" step="100" data-f="${idp}distance" id="${idp}distance" value="${esc(r.distance)}" placeholder="1600"></label>
      <label>馬場状態<select data-f="${idp}going" id="${idp}going">${opts(GOINGS, r.going)}</select></label>
      <div class="span2 lapfield"><span class="lbl">ラップ（距離ごと）</span>${lapEditor(idp, r.lap, r.distance)}</div>
    </div>`;
  }
  const readRaceForm = (idp = "r") => { const v = k => ($("#" + idp + k) || {}).value || ""; return { date: v("date"), venue: v("venue").trim(), raceNo: v("raceNo") ? String(+v("raceNo")) : "", raceName: v("raceName").trim(), cls: v("cls"), surface: v("surface"), distance: v("distance"), going: v("going"), lap: readLap(idp) }; };

  function viewRaces() {
    const list = D.races.slice().sort((a, b) => (a.date ? 1 : 0) - (b.date ? 1 : 0) || String(b.date).localeCompare(String(a.date)) || (+b.raceNo - +a.raceNo));
    main().innerHTML = `
      <div class="head"><h1>レース</h1><div class="row"><a class="btn primary" href="#/import/card">＋ 出馬表を取込（レース前）</a><a class="btn primary" href="#/import/result">＋ 結果を取込（レース後）</a><button class="btn" id="newRace">手で作る</button></div></div>
      <section class="card" id="newRaceBox" hidden><h2>新しいレース</h2>${raceForm({})}<div class="row"><button class="btn primary" id="createRace">作成して出馬表へ</button><button class="btn" id="cancelRace">やめる</button></div></section>
      <div class="filters"><label>絞り込み<input type="search" id="rq" placeholder="日付・開催場・レース名"></label></div>
      <ul class="list" id="raceList"></ul>`;
    const draw = () => {
      const q = ($("#rq").value || "").trim();
      const rows = list.filter(r => !q || raceTitle(r).includes(q) || raceCond(r).includes(q));
      $("#raceList").innerHTML = rows.length ? rows.map(r => {
        const n = entriesOfRace(r.id).length;
        return `<li><a href="#/race/${encodeURIComponent(r.id)}" class="item"><span class="t">${esc(raceTitle(r))}</span><span class="s">${esc(raceCond(r) || "条件未入力")}・${n}頭${r.analysis ? '・<b class="pill">分析済み</b>' : ""}</span></a></li>`;
      }).join("") : `<li class="empty">${D.races.length ? "該当するレースはありません" : "まだレースがありません。「新しいレース」で出馬表を作るか、「パドック登録」から過去のレースを登録してください。"}</li>`;
    };
    $("#rq").oninput = draw; draw();
    $("#newRace").onclick = () => { $("#newRaceBox").hidden = false; $("#rdate").focus(); };
    $("#cancelRace").onclick = () => { $("#newRaceBox").hidden = true; };
    $("#createRace").onclick = e => run(e.target, async () => {
      const f = readRaceForm(); if (!f.date && !(f.venue && f.raceNo)) { showError("日付、または開催場とレース番号を入力してください"); return; }
      if (f.venue && f.raceNo && findRace(f.date, f.venue, f.raceNo)) { toast("同じレースがすでにあります"); go("#/race/" + findRace(f.date, f.venue, f.raceNo).id); return; }
      const r = await save("races", Object.assign({ id: newId("R") }, f)); go("#/race/" + r.id);
    });
  }

  /* ================= 出馬表 ================= */
  function viewRace(id) {
    const r = race(id); if (!r) { main().innerHTML = banner("レースが見つかりません"); return; }
    const ents = entriesOfRace(id);
    const hasRes = ents.some(e => e.finish); // 結果を登録済みなら着順・着差を表示
    const an = parseJSON(r.analysis, null);
    const overall = e => an ? an.patterns.reduce((s, p) => s + (p.probability / 100) * ((p.rates[e.id] || 0) / 100), 0) : 0;
    const pct = v => (v * 100).toFixed(1) + "%";
    main().innerHTML = `
      <div class="head"><div><p class="eyebrow">出馬表</p><h1>${esc(raceTitle(r))}</h1><p class="sub">${esc(raceCond(r) || "条件未入力")}</p></div>
        <div class="row"><button class="btn" id="editRace">レース条件を編集</button><button class="btn danger" id="delRace">レースを削除</button></div></div>
      <div id="delRaceBox"></div>
      ${r.lap ? `<section class="lapsec"><h2 class="sub3">ラップ</h2>${lapTable(r.lap, r.distance)}</section>` : ""}
      <section class="card" id="raceEdit" hidden>${raceForm(r)}<div class="row"><button class="btn primary" id="saveRace">保存</button></div></section>
      ${an ? `<section class="patterns">${an.patterns.map((p, i) => `<div class="pat"><span class="pnum">展開${i + 1}</span><b>${esc(p.name)}</b><span class="prob">${p.probability.toFixed(1)}%</span><p>${esc(p.summary)}</p></div>`).join("")}<p class="muted">分析日時 ${esc(r.analyzedAt)}。基準オッズ＝この単勝オッズを超えれば回収率100%超え</p></section>` : ""}
      <div class="tablewrap"><table class="card-table">
        <thead><tr><th>馬番</th><th>馬名</th>${hasRes ? '<th class="n">着順</th><th class="n">着差</th>' : ""}<th>性</th><th>脚質</th><th>馬体の特徴</th><th>好走時の展開</th>
          ${an ? an.patterns.map((p, i) => `<th class="n">展開${i + 1}</th>`).join("") + `<th class="n">総合勝率</th><th class="n">基準オッズ</th>` : ""}<th></th></tr></thead>
        <tbody>${ents.length ? ents.map(e => {
          const h = horse(e.horseId) || {}; const g = goodSummary(e.horseId); const ov = overall(e);
          return `<tr>
            <td class="n umaban"><input type="number" inputmode="numeric" min="1" max="18" class="umaban-in" data-umaban="${esc(e.id)}" value="${esc(e.umaban)}" aria-label="${esc((horse(e.horseId) || {}).name)}の馬番"></td>
            <td><a href="#/horse/${encodeURIComponent(h.id)}"><b>${esc(h.name)}</b></a></td>
            ${hasRes ? `<td class="n"><b>${esc(e.finish)}</b></td><td class="n">${esc(e.margin)}</td>` : ""}
            <td>${esc(h.sex)}</td>
            <td>${styles(h).map(s => `<span class="pill">${esc(s)}</span>`).join(" ")}</td>
            <td class="wrap">${esc(h.body)}</td>
            <td class="wrap">${g.paces.length ? `<ul class="paces">${g.paces.slice(0, 3).map(p => `<li><span class="muted">${esc(p.race ? p.race.date : "")}</span> ${esc(p.text)}</li>`).join("")}</ul>${g.paces.length > 3 ? `<span class="muted">ほか${g.paces.length - 3}件</span>` : ""}` : '<span class="muted">—</span>'}</td>
            ${an ? an.patterns.map(p => `<td class="n">${p.rates[e.id] != null ? p.rates[e.id].toFixed(1) + "%" : "—"}</td>`).join("") + `<td class="n"><b>${ov ? pct(ov) : "—"}</b></td><td class="n"><b class="odds">${ov ? (1 / ov).toFixed(1) + "倍" : "—"}</b></td>` : ""}
            <td><a class="btn small" href="#/entry/${encodeURIComponent(e.id)}">記録・パドック</a></td></tr>`;
        }).join("") : `<tr><td colspan="9" class="empty">出走予定馬を下から追加してください</td></tr>`}</tbody>
      </table></div>

      <section class="card" id="resCard"></section>

      <details class="manual"><summary>手で馬を追加する（読み取りがうまくいかないとき）</summary>
      <section class="card"><h2>出走予定馬を追加</h2>
        <div class="row add">
          <label class="w-num">馬番<input type="number" inputmode="numeric" min="1" max="18" id="addUmaban" data-f="addUmaban"></label>
          <label class="grow">馬名<input type="text" id="addName" list="horseNames" data-f="addName" placeholder="途中まで入力すると候補が出ます" autocomplete="off"></label>
          <button class="btn primary" id="addBtn">追加</button>
        </div>
        <div id="addMatch"></div>
      </section>

      <section class="card"><div class="cardhead"><h2>登録済みの馬から選ぶ</h2><span class="muted" id="pickCount"></span></div>
        <p class="muted" style="margin:0">チェックした馬をまとめて出馬表に追加します。馬番は追加した後、表の中で入力できます。</p>
        <div class="row add"><label class="grow">馬名で絞り込み<input type="search" id="pickQ" placeholder="馬名の一部" autocomplete="off"></label></div>
        <ul class="picklist" id="pickList"></ul>
        <div class="row"><button class="btn primary" id="pickAdd" disabled>選んだ馬を追加</button><button class="btn" id="pickClear" disabled>選択を解除</button></div>
      </section>

      </details>

      <section class="card"><h2>Claudeで展開分析</h2>
        <ol class="steps"><li>「分析用にコピー」を押す</li><li>Claudeアプリに貼り付けて送信する</li><li>Claudeが返した結果をコピーして、下の欄に貼り付け「反映」を押す</li></ol>
        <div class="row"><button class="btn primary" id="copyBtn" ${ents.length ? "" : "disabled"}>分析用にコピー</button></div>
        <textarea id="copyFallback" class="mono" rows="5" hidden readonly></textarea>
        <label>分析結果を貼り付け<textarea id="paste" class="mono" rows="5" data-f="paste" placeholder='{"patterns":[…]}'></textarea></label>
        <div class="row"><button class="btn primary" id="applyBtn">反映</button>${an ? '<span class="muted">反映すると前回の分析結果は上書きされます</span>' : ""}</div>
      </section>
      <datalist id="horseNames">${D.horses.map(h => `<option value="${esc(h.name)}"></option>`).join("")}</datalist>`;

    $("#delRace").onclick = () => {
      const list = entriesOfRace(r.id), ni = imgCount(list);
      askDelete($("#delRaceBox"), `<b>${esc(raceTitle(r))}</b> を削除します。<br>このレースの出走記録 ${list.length}件${ni ? `（パドック画像 ${ni}枚を含む）` : ""}と、展開分析の結果も一緒に消えます。馬の情報は残ります。${ni ? "<br>画像はGoogleドライブのゴミ箱に移り、30日間は元に戻せます。" : ""}`,
        "レースを削除する", async () => {
          await removeEntries(list);
          await B.remove("races", [r.id]); D.races = D.races.filter(x => x.id !== r.id);
          await reloadData(); toast("レースを削除しました"); go("#/races");
        });
    };
    $("#editRace").onclick = () => { $("#raceEdit").hidden = !$("#raceEdit").hidden; };
    $("#saveRace").onclick = e => run(e.target, async () => {
      const f = readRaceForm(); if (!f.date && !(f.venue && f.raceNo)) { showError("日付、または開催場とレース番号を入力してください"); return; }
      const dup = f.venue && f.raceNo && findRace(f.date, f.venue, f.raceNo); if (dup && dup.id !== r.id) { showError("同じ日付・開催場・レース番号のレースが別にあります"); return; }
      await save("races", Object.assign(r, f)); toast("レース条件を保存しました"); render();
    });

    // 出走予定馬の追加（名寄せ）
    let chosen = null;
    const showMatch = () => {
      const name = $("#addName").value.trim(); chosen = null;
      if (!name) { $("#addMatch").innerHTML = ""; return; }
      const m = matchHorse(name, D.horses);
      if (m.exact) { chosen = m.exact.id; $("#addMatch").innerHTML = `<p class="ok">登録済みの馬：<b>${esc(m.exact.name)}</b></p>`; return; }
      $("#addMatch").innerHTML = m.candidates.length
        ? `<fieldset class="cands"><legend>似た名前の馬がいます。この馬ですか？</legend>${m.candidates.map(h => `<label><input type="radio" name="cand" value="${esc(h.id)}"> ${esc(h.name)}</label>`).join("")}<label><input type="radio" name="cand" value="" checked> 新しい馬「${esc(name)}」として登録</label></fieldset>`
        : `<p class="muted">未登録の馬です。追加すると馬も自動で登録されます。</p>`;
    };
    $("#addName").oninput = showMatch;
    $("#addBtn").onclick = e => run(e.target, async () => {
      const name = $("#addName").value.trim(), umaban = $("#addUmaban").value;
      if (!name) { showError("馬名を入力してください"); return; }
      const sel = document.querySelector("input[name=cand]:checked");
      let hid = chosen || (sel && sel.value) || "";
      if (!hid) { const h = await save("horses", { id: newId("H"), name: normName(name), sex: "", styles: "", body: "" }); hid = h.id; await B.log({ at: nowStr(), kind: "出馬表", input: name, decision: "新規登録", horseId: h.id, horseName: h.name }); }
      else if (!chosen) { await B.log({ at: nowStr(), kind: "出馬表", input: name, decision: "候補から選択", horseId: hid, horseName: horse(hid).name }); }
      if (D.entries.some(x => x.raceId === r.id && x.horseId === hid)) { showError("この馬はすでに出馬表にいます"); return; }
      await save("entries", { id: newId("E"), horseId: hid, raceId: r.id, umaban: umaban ? String(+umaban) : "", img1: "", img2: "", anno1: "", anno2: "", finish: "", margin: "", weight: "", result: "", prediction: "", review: "" });
      toast(horse(hid).name + "を追加しました"); render(); setTimeout(() => $("#addUmaban") && $("#addUmaban").focus(), 50);
    });

    // Claude 分析
    // 登録済みの馬をチェックしてまとめて追加
    const picked = new Set();
    const lastRun = hid => { const x = entriesOfHorse(hid).find(en => en.raceId !== r.id); const rr = x && race(x.raceId); return rr ? rr.date : ""; };
    const drawPick = () => {
      const inRace = new Set(ents.map(x => x.horseId)), q = normName($("#pickQ").value || "");
      const pool = D.horses.filter(h => !inRace.has(h.id));
      const rows = pool.filter(h => !q || normName(h.name).includes(q))
        .sort((a, b) => String(lastRun(b.id)).localeCompare(String(lastRun(a.id))) || String(b.updated).localeCompare(String(a.updated)));
      $("#pickList").innerHTML = rows.length ? rows.map(h => `<li><label class="pickrow"><input type="checkbox" value="${esc(h.id)}" ${picked.has(h.id) ? "checked" : ""}>
          <span class="pn">${esc(h.name)}</span><span class="muted">${esc([h.sex, styles(h).join("・"), lastRun(h.id) ? "前走 " + lastRun(h.id) : ""].filter(Boolean).join("　"))}</span></label></li>`).join("")
        : `<li class="empty">${pool.length ? "該当する馬はいません" : "追加できる登録済みの馬はいません"}</li>`;
      $("#pickCount").textContent = picked.size ? picked.size + "頭を選択中" : "";
      $("#pickAdd").disabled = !picked.size; $("#pickClear").disabled = !picked.size;
      $("#pickAdd").textContent = picked.size ? `選んだ${picked.size}頭を追加` : "選んだ馬を追加";
    };
    $("#pickQ").oninput = drawPick;
    $("#pickList").addEventListener("change", ev => { const c = ev.target; if (c.type !== "checkbox") return; if (c.checked) picked.add(c.value); else picked.delete(c.value); drawPick(); });
    $("#pickClear").onclick = () => { picked.clear(); drawPick(); };
    $("#pickAdd").onclick = ev => run(ev.target, async () => {
      const ids = [...picked].filter(hid => !D.entries.some(x => x.raceId === r.id && x.horseId === hid));
      for (const hid of ids) await save("entries", { id: newId("E"), horseId: hid, raceId: r.id, umaban: "", img1: "", img2: "", anno1: "", anno2: "", finish: "", margin: "", weight: "", result: "", prediction: "", review: "" });
      toast(`${ids.length}頭を出馬表に追加しました。馬番を入力してください`); render();
    });
    drawPick();

    // ---- 結果のスクリーンショットから読み取り（共通の処理） ----
    mountImporter($("#resCard"), r, ents.length ? "result" : "card");

    // 馬番の編集：入力欄を変えると保存し、馬番順に並べ直す
    document.querySelectorAll("[data-umaban]").forEach(inp => {
      inp.addEventListener("keydown", ev => { if (ev.key === "Enter") inp.blur(); });
      inp.addEventListener("change", () => run(null, async () => {
        const en = entry(inp.dataset.umaban); if (!en) return;
        const raw = inp.value.trim(), v = raw ? String(+raw) : "";
        if (raw && !(+raw >= 1 && +raw <= 18 && Number.isInteger(+raw))) { showError("馬番は1〜18の数字で入力してください"); inp.value = en.umaban; return; }
        const dup = v && entriesOfRace(r.id).find(x => x.id !== en.id && String(x.umaban) === v);
        if (dup) { showError(`${v}番はすでに${esc((horse(dup.horseId) || {}).name)}に使われています。先にそちらの馬番を変えてください`); inp.value = en.umaban; return; }
        if (v === String(en.umaban || "")) return;
        en.umaban = v; await save("entries", en);
        toast(`${(horse(en.horseId) || {}).name}の馬番を${v ? v + "番" : "空欄"}にしました`);
        render();
      }));
    });
    $("#copyBtn").onclick = () => {
      const text = analysisPrompt(r, ents);
      const fb = () => { const t = $("#copyFallback"); t.hidden = false; t.value = text; t.focus(); t.select(); toast("自動コピーできませんでした。表示された文章をすべて選択してコピーしてください"); };
      try { navigator.clipboard.writeText(text).then(() => toast("コピーしました。Claudeアプリに貼り付けてください"), fb); } catch (e) { fb(); }
    };
    $("#applyBtn").onclick = e => run(e.target, async () => {
      const res = parseAnalysis($("#paste").value, ents);
      if (res.error) { showError(res.error); return; }
      await save("races", Object.assign(r, { analysis: JSON.stringify(res.data), analyzedAt: nowStr() }));
      toast("分析結果を反映しました" + (res.warn ? "（" + res.warn + "）" : "")); render();
    });
  }

  /* ================= 結果のスクリーンショットから登録 ================= */
  // 読み取る項目：年月日・開催場・レース名・クラス・芝ダート・距離・馬場状態・ラップ、各馬の馬番・馬名・着順・着差（1着とのタイム差）
  const RES_FIELDS = [["date", "日付"], ["venue", "開催場"], ["raceNo", "レース番号"], ["raceName", "レース名"], ["cls", "クラス"], ["surface", "芝／ダート"], ["distance", "距離（m）"], ["going", "馬場状態"], ["lap", "ラップ"]];
  const OCR_ERR = { nokey: "Vision APIのAPIキーが未設定です。設定画面で入力してください", offline: "通信できません", network: "読み取りの通信に失敗しました", http403: "APIキーが使えませんでした。キーの制限設定を確認してください", http429: "本日の読み取り上限に達しました" };
  const blankEntry = (hid, rid) => ({ id: newId("E"), horseId: hid, raceId: rid, umaban: "", img1: "", img2: "", anno1: "", anno2: "", finish: "", margin: "", weight: "", result: "", prediction: "", review: "" });

  // 日付なしで登録したレースを、同じ日付つきのレースへまとめる（同じ馬の記録は1つに）
  async function mergeRaceInto(src, dst) {
    for (const en of D.entries.filter(x => x.raceId === src.id)) {
      const same = D.entries.find(x => x.raceId === dst.id && x.horseId === en.horseId);
      if (same) {
        ["img1", "img2", "anno1", "anno2", "weight", "umaban", "prediction", "review", "result", "finish", "margin"].forEach(k => { if (!same[k] && en[k]) same[k] = en[k]; });
        await save("entries", same); await B.remove("entries", [en.id]); D.entries = D.entries.filter(x => x.id !== en.id);
      } else { en.raceId = dst.id; await save("entries", en); }
    }
    RES_FIELDS.forEach(([k]) => { if (!dst[k] && src[k]) dst[k] = src[k]; });
    await B.remove("races", [src.id]); D.races = D.races.filter(x => x.id !== src.id);
  }

  // mode: "card"＝出馬表（レース前）、"result"＝レース結果（レース後）
  const CARD_KEYS = ["date", "venue", "raceNo", "raceName", "cls", "surface", "distance"];
  const RESULT_ONLY = ["going", "lap"];
  // 日付のタブが複数あるとき：背景が白く強調されたタブを、画像の色から選ぶ
  async function guessDateByColor(race, imgs) {
    if (!race.dateBoxes || race.dateBoxes.length < 2) return;
    const cache = {};
    const pixels = async i => {
      if (cache[i]) return cache[i];
      const im = imgs[i]; const bmp = await new Promise((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = rej; x.src = im.url; });
      const c = document.createElement("canvas"); c.width = im.w; c.height = im.h;
      const cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, im.w, im.h);
      return (cache[i] = { data: cx.getImageData(0, 0, im.w, im.h).data, w: im.w, h: im.h });
    };
    const scores = [];
    for (const b of race.dateBoxes) {
      const px = await pixels(b.img), hh = b.y1 - b.y0;
      // 日付の文字のまわり（タブの中）を調べる。文字の線より背景の方が多いので、明るい方から3割の値を背景の明るさとする
      const x0 = Math.max(0, Math.round(b.x0 - hh * 0.4)), x1 = Math.min(px.w - 1, Math.round(b.x1 + hh * 0.4));
      const y0 = Math.max(0, Math.round(b.y0 - hh * 0.15)), y1 = Math.min(px.h - 1, Math.round(b.y1 + hh * 0.15));
      const lum = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = (y * px.w + x) * 4; lum.push(0.299 * px.data[k] + 0.587 * px.data[k + 1] + 0.114 * px.data[k + 2]); }
      lum.sort((a, b) => a - b);
      scores.push({ date: b.date, v: lum[Math.floor(lum.length * 0.7)] || 0 });
    }
    scores.sort((a, b) => b.v - a.v);
    if (scores[0].v - scores[1].v >= 6) race.dateGuess = scores[0].date; // いちばん白いタブが、他よりはっきり明るいときだけ
  }

  function mountImporter(box, fixedRace, mode = "result", keepImgs = []) {
    const isCard = mode === "card";
    const FIELDS = isCard ? RES_FIELDS.filter(([k]) => CARD_KEYS.includes(k)) : RES_FIELDS;
    box.innerHTML = `<div class="cardhead"><h2>${isCard ? "出馬表を画像から読み取る（レース前）" : "結果を画像から読み取る（レース後）"}</h2><span class="muted" id="resCount"></span></div>
      <div class="seg" role="group" aria-label="読み取る画像の種類"><button class="segb" data-mode="card" aria-pressed="${isCard}">出馬表（レース前）</button><button class="segb" data-mode="result" aria-pressed="${!isCard}">結果（レース後）</button></div>
      <p class="muted" style="margin:0">${isCard
        ? "出馬表のスクリーンショットから、日付・開催場・レース名・クラス・芝ダート・距離と、全馬の馬番・馬名を読み取って出馬表を作ります。出走する馬が登録済みならその馬の出走レースに追加し、未登録なら新しく登録します。"
        : "結果ページのスクリーンショットから、馬場状態・ラップと、全馬の着順・着差（1着とのタイム差）を読み取って追加します。出馬表を作っていないレースでも、日付・レース名などを読み取ってレースと馬を登録します。"}</p>
      <p class="muted" style="margin:0">文字が小さくならないように撮ってください（PCはブラウザを150〜200%に拡大）。一覧が長いときは、スクロールして複数枚に分けて入れてください。</p>
      <div class="resthumbs" id="resThumbs"></div>
      <div class="row">
        <label class="btn filebtn">画像を選ぶ<input type="file" accept="image/*" multiple id="resFile"></label>
        <button class="btn" id="resPaste">コピーした画像を貼り付け</button>
        <button class="btn primary" id="resRead" disabled>読み取る</button>
      </div>
      <div id="resOut"></div>`;
    const imgs = keepImgs; let lastOCR = null;
    box.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { if (b.dataset.mode !== mode) mountImporter(box, fixedRace, b.dataset.mode, imgs); });
    const drawThumbs = () => {
      $("#resThumbs").innerHTML = imgs.map((im, i) => `<div class="rt"><img src="${im.url}" alt="結果画像${i + 1}"><button class="rtx" data-rdel="${i}" aria-label="${i + 1}枚目を外す">×</button></div>`).join("");
      $("#resCount").textContent = imgs.length ? imgs.length + "枚" : "";
      $("#resRead").disabled = !imgs.length;
    };
    setTimeout(() => { if ($("#resThumbs")) drawThumbs(); }, 0);
    async function addImage(f) {
      if (imgs.length >= 6) { toast("一度に読み取れるのは6枚までです"); return; }
      try { const s = await shrinkImage(f, 2400); imgs.push({ blob: s.blob, w: s.width, h: s.height, url: URL.createObjectURL(s.blob) }); drawThumbs(); }
      catch (err) { toast("この画像は読み込めませんでした。JPEGかPNGで試してください"); }
    }
    $("#resFile").addEventListener("change", async ev => { const fs = [...(ev.target.files || [])]; ev.target.value = ""; for (const f of fs) await addImage(f); });
    $("#resPaste").onclick = async () => {
      const f = await readClipboardImage();
      if (f instanceof Blob) addImage(f);
      else if (f === "noimage") toast("クリップボードに画像がありません。スクリーンショットをコピーしてから押してください");
      else toast("貼り付けできませんでした。PCでは Ctrl＋V（Macは ⌘＋V）で貼り付けてください");
    };
    onPaste = ev => { const f = imageFromPasteEvent(ev); if (!f) return; ev.preventDefault(); addImage(f); box.scrollIntoView({ block: "nearest" }); };
    $("#resThumbs").addEventListener("click", ev => { const b = ev.target.closest("[data-rdel]"); if (!b) return; const i = +b.dataset.rdel; URL.revokeObjectURL(imgs[i].url); imgs.splice(i, 1); drawThumbs(); });
    $("#resRead").onclick = ev => run(ev.target, async () => {
      ev.target.textContent = "読み取り中…";
      const got = [];
      for (const im of imgs) {
        const o = await B.ocr(im.blob);
        if (o.error) { showError(OCR_ERR[o.error] || "読み取りに失敗しました（" + o.error + "）"); return; }
        got.push({ words: o.words, w: im.w, h: im.h });
      }
      lastOCR = got.map(g => ({ w: g.w, h: g.h, words: (g.words || []).map(x => { const v = (x.boundingPoly && x.boundingPoly.vertices) || []; const xs = v.map(p => p.x || 0), ys = v.map(p => p.y || 0); return [x.description, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }) }));
      const parsed = parseResultImages(got, mode);
      try { await guessDateByColor(parsed.race, imgs); } catch (e) { /* 判定できなければ選んでもらう */ }
      showConfirm(parsed);
    });

    function showConfirm(res) {
      const rr = res.race, rows = res.rows;
      const base = fixedRace || {};
      // 結果モードで出馬表から作ったレースに入れるときは、レース名などは出馬表の値を残す（馬場状態・ラップだけ結果から）
      const val = k => (!isCard && fixedRace && !RESULT_ONLY.includes(k)) ? (base[k] || rr[k] || "") : (rr[k] || base[k] || "");
      const fieldInput = (k) => {
        const v = val(k), id = "iv_" + k;
        if (k === "date" && !rr.date && rr.dateOptions) { const pre = rr.dateGuess || base.date; return `<select id="${id}"><option value="">日付のタブが複数写っています。選んでください</option>${rr.dateOptions.map(d => `<option ${d === pre ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>`; }
        if (k === "date") return `<input type="date" id="${id}" value="${esc(v)}">`;
        if (k === "venue") return `<input type="text" id="${id}" list="venues" value="${esc(v)}">`;
        if (k === "cls") return `<select id="${id}">${opts(CLASSES, v)}</select>`;
        if (k === "surface") return `<select id="${id}">${opts(SURFACES, v)}</select>`;
        if (k === "going") return `<select id="${id}">${opts(GOINGS, v)}</select>`;
        if (k === "raceNo" || k === "distance") return `<input type="number" inputmode="numeric" id="${id}" value="${esc(v)}">`;
        if (k === "lap") return lapEditor("iv_", v, val("distance"));
        return `<input type="text" id="${id}" value="${esc(v)}">`;
      };
      const read = k => rr[k] ? "" : `<span class="miss">読み取れず</span>`;
      $("#resOut").innerHTML = `
        ${!rows.length && !FIELDS.some(([k]) => rr[k]) ? banner(isCard ? "画像から出馬表を読み取れませんでした。出馬表のスクリーンショットか、文字が小さすぎないかを確認してください" : "画像から結果を読み取れませんでした。結果ページのスクリーンショットか、文字が小さすぎないかを確認してください") : ""}
        ${!rows.length && FIELDS.some(([k]) => rr[k]) ? banner(isCard ? "馬の一覧を読み取れませんでした。結果のスクリーンショットなら「結果（レース後）」に切り替えてください" : "着順の一覧を読み取れませんでした。出馬表のスクリーンショットなら「出馬表（レース前）」に切り替えてください") : ""}
        <h3 class="sub3">レース情報</h3>
        <div class="grid form rf">${FIELDS.map(([k, l]) => k === "lap" ? `<div class="span2 lapfield"><span class="lbl">${l}（距離ごと） ${read(k)}</span>${fieldInput(k)}</div>` : `<label class="${k === "raceName" ? "span2" : ""}">${l} ${k === "date" && rr.dateOptions && !rr.date ? (rr.dateGuess ? `<span class="guess">白いタブの日付を選びました・確認してください</span>` : `<span class="miss">選んでください</span>`) : read(k)}${fieldInput(k)}</label>`).join("")}</div>
        <div id="iTarget"></div>
        ${rows.length ? `<h3 class="sub3">${isCard ? "出走馬" : "結果"}（${rows.length}頭）</h3>
          ${!isCard && !res.winTime ? banner("1着の馬の走破タイムが読み取れなかったため、着差（1着とのタイム差）を計算できませんでした。1着の行が写った画像を加えるか、手で入力してください。") : ""}
          <div class="tablewrap"><table class="card-table rc"><thead><tr><th><input type="checkbox" class="ck" id="ckAll" checked aria-label="すべて選ぶ"></th>${isCard ? "" : "<th>着順</th>"}<th>馬番</th><th>馬名（直せます）</th>${isCard ? "" : "<th>着差（秒）</th>"}<th>登録</th></tr></thead><tbody>
          ${rows.map((x, i) => `<tr data-row="${i}"><td><input type="checkbox" class="ck" data-ri="${i}" checked></td>
            ${isCard ? "" : `<td><input type="text" class="sm xs" id="if_${i}" value="${esc(x.finish || "")}"></td>`}
            <td><input type="number" class="sm xs" id="iu_${i}" value="${esc(x.umaban || "")}"></td>
            <td><input type="text" class="nm" id="in_${i}" value="${esc(x.name || "")}"></td>
            ${isCard ? "" : `<td><input type="text" class="sm xs" id="id_${i}" value="${esc(x.diff || "")}" inputmode="decimal"></td>`}
            <td id="is_${i}"></td></tr>`).join("")}
          </tbody></table></div>` : ""}
        ${rows.length || FIELDS.some(([k]) => rr[k]) ? `<div class="row"><button class="btn primary" id="resApply">${isCard ? "出馬表を登録する" : "結果を登録する"}</button><button class="btn" id="resCancel">やめる</button></div>
          <p class="muted">${isCard ? "レースが終わったら、このレースの画面で「結果（レース後）」の画像を読み取ってください。" : "結果区分（好走／凡走／大敗）やパドック画像・メモは、各馬の「記録・パドック」から入力してください。"}</p>` : ""}
        <details class="dbg"><summary>読み取りがうまくいかないとき</summary>
          <p class="muted">下のボタンで、文字認識の結果（文字と位置）をコピーできます。Claude とのチャットに貼り付けてもらえれば、読み取りのルールを調整できます。画像そのものや Google の情報は含まれません。</p>
          <div class="row"><button class="btn small" id="dbgCopy">読み取りの詳細をコピー</button></div><textarea id="dbgText" class="mono" rows="4" hidden readonly></textarea></details>`;

      const form = () => { const f = {}; FIELDS.forEach(([k]) => { const el = $("#iv_" + k); f[k] = el ? String(el.value || "").trim() : ""; }); if (f.raceNo) f.raceNo = String(+f.raceNo); if (FIELDS.some(([k]) => k === "lap")) f.lap = readLap("iv_"); return f; };
      // 反映先のレース：日付・開催場・レース番号で探す。日付なしで先に登録したレース（パドック登録）も拾う
      const findTarget = f => {
        if (fixedRace) {
          const twin = !fixedRace.date && f.date && f.venue && f.raceNo ? findRace(f.date, f.venue, f.raceNo) : null;
          return { race: twin && twin.id !== fixedRace.id ? twin : fixedRace, merge: twin && twin.id !== fixedRace.id ? fixedRace : null };
        }
        if (f.venue && f.raceNo) {
          const dated = f.date ? findRace(f.date, f.venue, f.raceNo) : null;
          const nodate = recentNoDate(f.venue, f.raceNo);
          if (dated && nodate) return { race: dated, merge: nodate };
          if (dated || nodate) return { race: dated || nodate, merge: null };
        }
        return { race: null, merge: null };
      };
      const statusOf = (i) => {
        const name = ($("#in_" + i).value || "").trim(); const cell = $("#is_" + i);
        if (!name) { cell.innerHTML = `<span class="miss">馬名を入力</span>`; return; }
        const t = findTarget(form()).race;
        const m = matchHorse(name, D.horses);
        if (m.exact) { const has = t && D.entries.some(e => e.raceId === t.id && e.horseId === m.exact.id); cell.innerHTML = `<span class="ok">登録済み</span>${has ? '<span class="muted">・記録を更新</span>' : '<span class="muted">・出走を追加</span>'}`; return; }
        if (m.candidates.length) { cell.innerHTML = `<select id="ic_${i}" aria-label="${esc(name)}は登録済みのどの馬か">${m.candidates.map(h => `<option value="${esc(h.id)}">${esc(h.name)}（登録済み）</option>`).join("")}<option value="">新しい馬として登録</option></select><span class="muted cand-note">名前が似た馬がいます</span>`; return; }
        cell.innerHTML = `<span class="pill">新規登録</span>`;
      };
      const drawTarget = () => {
        const f = form(), t = findTarget(f);
        $("#iTarget").innerHTML = t.race ? `<p class="ok">登録済みのレース <b>${esc(raceTitle(t.race))}</b> に反映します${t.merge ? `（日付なしで登録していた ${esc(raceTitle(t.merge))} もまとめます）` : !t.race.date && f.date ? "（日付などのレース情報を書き込みます）" : ""}</p>`
          : (f.date || (f.venue && f.raceNo)) ? `<p class="muted">新しいレースとして登録します</p>` : banner("日付、または開催場とレース番号を入力してください");
        rows.forEach((x, i) => statusOf(i));
      };
      FIELDS.forEach(([k]) => { const el = $("#iv_" + k); if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", drawTarget); });
      rows.forEach((x, i) => $("#in_" + i).addEventListener("input", () => statusOf(i)));
      if ($("#ckAll")) $("#ckAll").onchange = e => document.querySelectorAll("#resOut [data-ri]").forEach(c => { c.checked = e.target.checked; });
      drawTarget();
      $("#resOut").scrollIntoView({ block: "start", behavior: "smooth" });
      if ($("#resCancel")) $("#resCancel").onclick = () => { $("#resOut").innerHTML = ""; };
      $("#dbgCopy").onclick = () => {
        const text = "競走馬DB 読み取りの詳細 v1\n" + JSON.stringify(lastOCR);
        const fb = () => { const ta = $("#dbgText"); ta.hidden = false; ta.value = text; ta.focus(); ta.select(); toast("自動でコピーできませんでした。表示された文字をすべて選んでコピーしてください"); };
        try { navigator.clipboard.writeText(text).then(() => toast("読み取りの詳細をコピーしました"), fb); } catch (e) { fb(); }
      };
      if (!$("#resApply")) return;
      $("#resApply").onclick = ev => run(ev.target, async () => {
        const f = form();
        if (!f.date && !(f.venue && f.raceNo)) { showError("日付、または開催場とレース番号を入力してください"); return; }
        const picked = [...document.querySelectorAll("#resOut [data-ri]:checked")].map(c => +c.dataset.ri);
        const nums = picked.map(i => $("#iu_" + i).value.trim()).filter(Boolean);
        if (new Set(nums).size !== nums.length) { showError("同じ馬番が2頭に入っています。馬番を確認してください"); return; }
        if (picked.some(i => !$("#in_" + i).value.trim())) { showError("馬名が空の行があります。入力するか、チェックを外してください"); return; }
        // レース
        let { race: target, merge } = findTarget(f);
        if (target && f.date && f.venue && f.raceNo) { const other = findRace(f.date, f.venue, f.raceNo); if (other && other.id !== target.id && !merge) { showError(`${raceTitle(other)} がすでに別のレースとして登録されています`); return; } }
        if (!target) target = await save("races", Object.assign({ id: newId("R"), analysis: "", analyzedAt: "" }, f));
        else {
          if (merge) await mergeRaceInto(merge, target);
          // 出馬表：読み取った条件で上書き。結果：馬場状態・ラップを書き込み、他の項目は空欄のときだけ埋める
          FIELDS.forEach(([k]) => { if (f[k] && (isCard || RESULT_ONLY.includes(k) || !target[k])) target[k] = f[k]; });
          await save("races", target);
        }
        // 馬と出走記録
        let created = 0, added = 0, updated = 0;
        for (const i of picked) {
          const x = rows[i], name = $("#in_" + i).value.trim();
          const m = matchHorse(name, D.horses); const sel = $("#ic_" + i);
          let hid = m.exact ? m.exact.id : (sel && sel.value) || "";
          if (hid && !m.exact) await B.log({ at: nowStr(), kind: isCard ? "出馬表取込" : "結果取込", input: name, decision: "候補から選択", horseId: hid, horseName: horse(hid).name });
          if (!hid) {
            const h = await save("horses", { id: newId("H"), name: normName(name), sex: x.sex || "", styles: "", body: "" }); hid = h.id; created++;
            await B.log({ at: nowStr(), kind: isCard ? "出馬表取込" : "結果取込", input: name, decision: "新規登録", horseId: h.id, horseName: h.name });
          } else { const h = horse(hid); if (h && !h.sex && x.sex) await save("horses", Object.assign(h, { sex: x.sex })); }
          let en = D.entries.find(e => e.raceId === target.id && e.horseId === hid);
          if (en) updated++; else { en = blankEntry(hid, target.id); added++; }
          const u = $("#iu_" + i).value.trim();
          if (isCard) Object.assign(en, { umaban: u ? String(+u) : en.umaban });
          else Object.assign(en, { umaban: u ? String(+u) : en.umaban, finish: $("#if_" + i).value.trim(), margin: $("#id_" + i).value.trim(), weight: en.weight || x.weight || "" });
          await save("entries", en);
        }
        imgs.forEach(im => URL.revokeObjectURL(im.url));
        await reloadData();
        toast(`${raceTitle(target)} の${isCard ? "出馬表" : "結果"}を登録しました（新しい馬 ${created}頭・出走を追加 ${added}頭・${isCard ? "登録済み" : "更新"} ${updated}頭）`);
        go("#/race/" + target.id);
      });
    }
  }

  function viewImport(kind) {
    const isCard = kind === "card";
    main().innerHTML = `<div class="head"><div><p class="eyebrow">${isCard ? "レース前" : "レース後"}</p><h1>${isCard ? "出馬表のスクリーンショットから登録" : "結果のスクリーンショットから登録"}</h1></div></div>
      <section class="card" id="resCard"></section>`;
    mountImporter($("#resCard"), null, isCard ? "card" : "result");
  }

  function analysisPrompt(r, ents) {
    const data = {
      race: { date: r.date, venue: r.venue, raceNo: r.raceNo, raceName: r.raceName, class: r.cls, surface: r.surface, distance: r.distance, going: r.going },
      horses: ents.map(e => {
        const h = horse(e.horseId) || {}; const g = goodSummary(e.horseId);
        return {
          umaban: +e.umaban || null, name: h.name, sex: h.sex, runningStyles: styles(h), bodyNotes: h.body,
          goodRunPaces: g.paces.map(p => p.text), goodRunWeight: g.weight,
          history: entriesOfHorse(h.id).filter(x => x.raceId !== r.id).slice(0, 10).map(x => { const rr = race(x.raceId) || {}; return { date: rr.date, venue: rr.venue, class: rr.cls, surface: rr.surface, distance: rr.distance, going: rr.going, finish: x.finish, margin: x.margin, weight: x.weight, result: x.result, paceAndReview: x.review }; })
        };
      })
    };
    return `以下の出馬表データをもとに、このレースの展開と勝率を予想してください。

【分析の考え方】
（今後追記します）

【やること】
1. 展開を3パターン予想する（名前と2〜3文の概要）
2. 各パターンの出現確率（%）を予想する。3つの合計は100にする
3. 各パターンにおける全出走馬の勝率（%）を予想する。パターンごとに合計100にする

【出力形式】
説明文は不要です。次の形のJSONだけを返してください。馬は umaban と name の両方を入れてください。
{"patterns":[{"name":"スローの前残り","summary":"…","probability":45,"winRates":[{"umaban":1,"name":"馬名","winRate":12.5}]}]}

【出馬表データ】
${JSON.stringify(data, null, 1)}`;
  }
  function parseAnalysis(text, ents) {
    const s = String(text || ""); const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b < a) return { error: "貼り付けた内容に分析結果（{ から始まるJSON）が見つかりません" };
    let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { return { error: "分析結果の形式が崩れていて読めません。Claudeの返答のJSON部分だけを、もう一度コピーして貼り付けてください" }; }
    const ps = Array.isArray(j.patterns) ? j.patterns : [];
    if (ps.length !== 3) return { error: `展開パターンが3つではありません（${ps.length}つ）` };
    const probs = ps.map(p => +p.probability);
    if (probs.some(v => !(v >= 0))) return { error: "出現確率が数値になっていないパターンがあります" };
    const sum = probs.reduce((x, y) => x + y, 0);
    if (Math.abs(sum - 100) > 1) return { error: `出現確率の合計が100%ではありません（${sum.toFixed(1)}%）` };
    const unknown = new Set(); const missing = new Set();
    const out = ps.map(p => {
      const rates = {};
      (p.winRates || []).forEach(w => {
        const byNo = ents.find(e => w.umaban != null && String(+w.umaban) === String(+e.umaban) && e.umaban);
        const byName = ents.find(e => horse(e.horseId) && w.name && normName(horse(e.horseId).name) === normName(w.name));
        const e = byName || byNo;
        if (!e) { unknown.add(w.name || ("馬番" + w.umaban)); return; }
        rates[e.id] = Math.max(0, +w.winRate || 0);
      });
      ents.forEach(e => { if (rates[e.id] == null) missing.add((horse(e.horseId) || {}).name); });
      const tot = Object.values(rates).reduce((x, y) => x + y, 0);
      if (tot > 0) Object.keys(rates).forEach(k => { rates[k] = rates[k] / tot * 100; }); // パターン内の合計を100%に補正
      return { name: String(p.name || ""), summary: String(p.summary || ""), probability: +p.probability * 100 / sum, rates };
    });
    if (missing.size) return { error: "勝率がない馬がいます：" + [...missing].join("、") };
    return { data: { patterns: out }, warn: unknown.size ? "出馬表にない馬名を無視しました：" + [...unknown].join("、") : "" };
  }

  /* ================= 馬 ================= */
  function viewHorses() {
    main().innerHTML = `<div class="head"><h1>馬</h1></div>
      <div class="filters"><label>馬名で検索<input type="search" id="hq" placeholder="馬名の一部"></label></div>
      <ul class="list" id="horseList"></ul>`;
    const draw = () => {
      const q = normName($("#hq").value || "");
      const rows = D.horses.filter(h => !q || normName(h.name).includes(q)).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      $("#horseList").innerHTML = rows.length ? rows.map(h => {
        const n = entriesOfHorse(h.id).length, g = goodSummary(h.id);
        return `<li><a class="item" href="#/horse/${encodeURIComponent(h.id)}"><span class="t">${esc(h.name)} <span class="muted">${esc(h.sex)}</span></span><span class="s">${styles(h).join("・") || "脚質未入力"}・出走${n}・好走${g.count}${g.weight ? "・好走時 " + esc(g.weight) : ""}</span></a></li>`;
      }).join("") : `<li class="empty">${D.horses.length ? "該当する馬はいません" : "まだ馬がいません。パドック登録か出馬表の作成で自動的に登録されます。"}</li>`;
    };
    $("#hq").oninput = draw; draw();
  }
  function horseFields(h) {
    return `<div class="grid form">
      <label>名前<input type="text" id="hname" data-f="hname" value="${esc(h.name)}"></label>
      <label>性別<select id="hsex" data-f="hsex">${opts(SEXES, h.sex)}</select></label>
      <fieldset class="checks"><legend>脚質（複数可）</legend>${STYLES.map(s => `<label><input type="checkbox" data-f="hstyle" value="${s}" ${styles(h).includes(s) ? "checked" : ""}> ${s}</label>`).join("")}</fieldset>
      <label class="span2">馬体の特徴<textarea id="hbody" data-f="hbody" rows="3">${esc(h.body)}</textarea></label>
    </div>`;
  }
  const readHorse = () => ({ name: ($("#hname") ? $("#hname").value.trim() : undefined), sex: $("#hsex").value, styles: [...document.querySelectorAll("[data-f=hstyle]:checked")].map(c => c.value).join(","), body: $("#hbody").value });
  function viewHorse(id) {
    const h = horse(id); if (!h) { main().innerHTML = banner("馬が見つかりません"); return; }
    const g = goodSummary(id), ents = entriesOfHorse(id);
    main().innerHTML = `
      <div class="head"><div><p class="eyebrow">馬</p><h1>${esc(h.name)}</h1></div><button class="btn danger" id="delHorse">この馬を削除</button></div>
      <div id="delHorseBox"></div>
      <section class="card">${horseFields(h)}<div class="row"><button class="btn primary" id="saveHorse">保存</button></div></section>
      <div class="two">
        <section class="card"><h2>好走時の展開</h2>${g.paces.length ? `<ul class="paces">${g.paces.map(p => `<li><span class="muted">${esc(raceTitle(p.race))}</span><br>${esc(p.text)}</li>`).join("")}</ul>` : '<p class="muted">好走の記録がまだありません</p>'}</section>
        <section class="card"><h2>好走時の馬体重</h2><p class="big">${g.weight || "—"}</p><p class="muted">好走 ${g.count}回</p></section>
      </div>
      <section><h2>出走履歴</h2><ul class="runs">${ents.length ? ents.map(e => {
        const r = race(e.raceId) || {}; const rs = [...window.Sketch.ratios(parseJSON(e.anno1, null)), ...window.Sketch.ratios(parseJSON(e.anno2, null))].filter(x => x.value);
        return `<li><a class="run" href="#/entry/${encodeURIComponent(e.id)}"><span class="thumb" data-img="${esc(e.img1)}"></span>
          <span class="body"><span class="t">${esc(raceTitle(r))}</span><span class="s">${esc(raceCond(r))}${e.finish ? "・" + esc(e.finish) + "着" : ""}${e.weight ? "・" + esc(e.weight) + "kg" : ""}${rs.length ? "・" + rs.map(x => esc(x.name) + " " + x.value.toFixed(3)).join("、") : ""}</span></span>
          ${e.result ? `<span class="res r-${RESULTS.indexOf(e.result)}">${esc(e.result)}</span>` : ""}</a></li>`;
      }).join("") : '<li class="empty">出走記録はまだありません</li>'}</ul></section>`;
    loadThumbs();
    $("#delHorse").onclick = () => {
      const list = entriesOfHorse(h.id), ni = imgCount(list);
      askDelete($("#delHorseBox"), `<b>${esc(h.name)}</b> を削除します。<br>この馬の出走記録 ${list.length}件${ni ? `（パドック画像 ${ni}枚、線と比率を含む）` : ""}も一緒に消え、出馬表からも外れます。レースそのものは残ります。${ni ? "<br>画像はGoogleドライブのゴミ箱に移り、30日間は元に戻せます。" : ""}`,
        "この馬を削除する", async () => {
          await removeEntries(list);
          await B.remove("horses", [h.id]); D.horses = D.horses.filter(x => x.id !== h.id);
          await reloadData(); toast(h.name + "を削除しました"); go("#/horses");
        });
    };
    $("#saveHorse").onclick = e => run(e.target, async () => {
      const v = readHorse(); if (!v.name) { showError("名前を入力してください"); return; }
      const m = D.horses.find(x => x.id !== h.id && normName(x.name) === normName(v.name)); if (m) { showError("同じ名前の馬がすでに登録されています"); return; }
      await save("horses", Object.assign(h, v)); toast("保存しました"); render();
    });
  }
  async function loadThumbs() {
    for (const el of document.querySelectorAll("[data-img]")) {
      const id = el.dataset.img; if (!id) { el.classList.add("none"); continue; }
      try { const u = await B.imageURL(id); if (u && el.isConnected) el.style.backgroundImage = `url("${u}")`; } catch (e) { if (e instanceof AuthError) { showRelogin(); return; } }
    }
  }

  /* ================= 出走記録 ================= */
  function viewEntry(id) {
    const e = entry(id); if (!e) { main().innerHTML = banner("出走記録が見つかりません"); return; }
    const h = horse(e.horseId) || {}, r = race(e.raceId) || {};
    const anno = [parseJSON(e.anno1, null), parseJSON(e.anno2, null)];
    const imgs = [e.img1, e.img2];
    main().innerHTML = `
      <div class="head"><div><p class="eyebrow">出走記録</p><h1><a href="#/horse/${encodeURIComponent(h.id)}">${esc(h.name)}</a>${e.umaban ? ` <span class="muted">${esc(e.umaban)}番</span>` : ""}</h1>
        <p class="sub"><a href="#/race/${encodeURIComponent(r.id)}">${esc(raceTitle(r))}</a></p></div></div>
      <section class="card"><div class="cardhead"><h2>パドック画像</h2>
        <div class="seg" role="group" aria-label="線の表示"><button class="segb" id="annoShow" aria-pressed="true">線を表示</button><button class="segb" id="annoHide" aria-pressed="false">線を非表示</button></div></div>
        <div class="slots" id="entrySlots">${SLOT.map((s, i) => `
        <div class="slot2"><span class="slabel">${i + 1}枚目　${s}</span>
          <button class="sprev big" data-sketch="${i}" ${imgs[i] ? "" : "disabled"} id="sk${i}">${imgs[i] ? '<span class="muted">読み込み中…</span>' : '<span class="muted">画像なし</span>'}</button>
          <div class="chips" id="chips${i}">${window.Sketch.ratios(anno[i]).map(x => `<span class="pill">${esc(x.name)} <b>${x.value ? x.value.toFixed(3) : "—"}</b></span>`).join("")}</div>
          <div class="row"><button class="btn small" data-sketch="${i}" ${imgs[i] ? "" : "disabled"}>線を引く・比率を測る</button>
          <label class="btn small filebtn">${imgs[i] ? "画像を差し替え" : "画像を追加"}<input type="file" accept="image/*" data-replace="${i}"></label>
          <button class="btn small" data-epaste="${i}">${imgs[i] ? "貼り付けで差し替え" : "貼り付けで追加"}</button></div>
        </div>`).join("")}</div></section>
      <div class="two">
        <section class="card"><h2>結果</h2><div class="grid form">
          <label>着順<input type="number" inputmode="numeric" id="efinish" data-f="efinish" value="${esc(e.finish)}"></label>
          <label>着差（1着とのタイム差・秒）<input type="text" id="emargin" data-f="emargin" value="${esc(e.margin)}" placeholder="0.3" inputmode="decimal"></label>
          <label>馬体重（kg）<input type="number" inputmode="numeric" id="eweight" data-f="eweight" value="${esc(e.weight)}"></label>
          <label>結果区分<select id="eresult" data-f="eresult">${opts(RESULTS, e.result)}</select></label>
          <label>馬番<input type="number" inputmode="numeric" id="eumaban" data-f="eumaban" value="${esc(e.umaban)}"></label>
        </div></section>
        <section class="card"><h2>この馬の情報</h2>${horseFields(h).replace('<label>名前<input type="text" id="hname" data-f="hname" value="' + esc(h.name) + '"></label>', "")}</section>
      </div>
      <section class="card"><h2>予想</h2><textarea id="epred" data-f="epred" rows="3">${esc(e.prediction)}</textarea></section>
      <section class="card"><h2>展開と振返り</h2><textarea id="ereview" data-f="ereview" rows="4">${esc(e.review)}</textarea><p class="muted">結果区分が「好走」のとき、この内容が馬の「好走時の展開」に並びます。</p></section>
      <section class="card"><h2>レース条件</h2><p class="muted">同じレースの他の馬にも反映されます。</p>${raceForm(r)}</section>
      <section class="card"><h2>この出走記録を削除</h2><p class="muted">出馬表から外したいときや、間違えて登録したときに使います。馬とレースは残ります。</p><div class="row"><button class="btn danger" id="delEntry">出走記録を削除</button></div><div id="delEntryBox"></div></section>
      <div class="savebar"><button class="btn primary" id="saveEntry">保存</button></div>`;

    // サムネイル（保存した線を重ねて表示）
    const imgSize = [null, null];
    function drawOverlay(i) {
      const box = $("#sk" + i); if (!box || !imgSize[i]) return;
      const old = box.querySelector(".ov"); if (old) old.remove();
      box.insertAdjacentHTML("beforeend", window.Sketch.overlay(anno[i], imgSize[i].w, imgSize[i].h));
    }
    imgs.forEach(async (iid, i) => {
      if (!iid) return;
      try {
        const u = await B.imageURL(iid); if (!u) return;
        const box = $("#sk" + i); box.innerHTML = `<img src="${u}" alt="${SLOT[i]}">`;
        const im = box.querySelector("img");
        const done = () => { imgSize[i] = { w: im.naturalWidth, h: im.naturalHeight }; drawOverlay(i); };
        if (im.complete && im.naturalWidth) done(); else im.addEventListener("load", done, { once: true });
      } catch (err) { if (err instanceof AuthError) showRelogin(); }
    });
    // 線の表示・非表示（2枚まとめて切り替え。設定はこの端末に記憶）
    const applyAnnoVis = () => {
      const show = Settings.get("hideAnno") !== "1";
      $("#entrySlots").classList.toggle("hide-ov", !show);
      $("#annoShow").setAttribute("aria-pressed", show); $("#annoHide").setAttribute("aria-pressed", !show);
    };
    $("#annoShow").onclick = () => {
      Settings.set("hideAnno", ""); applyAnnoVis();
      if (!anno.some(a => a && ((a.lines || []).length || (a.strokes || []).length))) toast("この出走記録には、まだ保存した線がありません。「線を引く・比率を測る」で線を引いて「完了」を押すと表示されます");
    };
    $("#annoHide").onclick = () => { Settings.set("hideAnno", "1"); applyAnnoVis(); };
    applyAnnoVis();

    main().addEventListener("click", async ev => {
      const b = ev.target.closest("[data-sketch]"); if (!b || b.disabled) return;
      const i = +b.dataset.sketch;
      await run(null, async () => {
        const u = await B.imageURL(imgs[i]); if (!u) { showError("画像を読み込めませんでした"); return; }
        const res = await window.Sketch.open({ url: u, label: `${h.name}　${i + 1}枚目　${SLOT[i]}`, data: anno[i] });
        if (!res) return;
        anno[i] = res; e["anno" + (i + 1)] = JSON.stringify(res);
        await save("entries", e); toast("書き込みを保存しました");
        $("#chips" + i).innerHTML = window.Sketch.ratios(res).map(x => `<span class="pill">${esc(x.name)} <b>${x.value ? x.value.toFixed(3) : "—"}</b></span>`).join("");
        drawOverlay(i);
        Settings.set("hideAnno", ""); applyAnnoVis();
      });
    });
    document.querySelectorAll("[data-replace]").forEach(inp => inp.addEventListener("change", ev => {
      const i = +inp.dataset.replace, f = inp.files && inp.files[0]; inp.value = ""; if (f) replaceImage(i, f);
    }));
    main().addEventListener("click", async ev => {
      const b = ev.target.closest("[data-epaste]"); if (!b) return;
      const i = +b.dataset.epaste;
      if (imgs[i] && b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "線と比率も消えます。もう一度押すと差し替え"; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "貼り付けで差し替え"; } }, 4000); return; }
      const f = await readClipboardImage();
      if (f instanceof Blob) replaceImage(i, f);
      else if (f === "noimage") toast("クリップボードに画像がありません。画像をコピーしてから押してください");
      else toast("貼り付けできませんでした。PCでは Ctrl＋V（Macは ⌘＋V）で貼り付けてください");
    });
    // Ctrl+V：画像がない枠にだけ入れる（差し替えはボタンから）
    onPaste = ev => {
      const f = imageFromPasteEvent(ev); if (!f) return;
      const i = !imgs[0] ? 0 : !imgs[1] ? 1 : -1;
      if (i < 0) { toast("画像は2枚とも登録済みです。差し替えは「貼り付けで差し替え」ボタンから行ってください"); return; }
      ev.preventDefault(); replaceImage(i, f);
    };
    async function replaceImage(i, f) {
      await run(null, async () => {
        const s = await shrinkImage(f);
        const nid = await B.putImage(s.blob, `${r.date}_${r.venue}${r.raceNo}R_${e.umaban}_${h.name}_${i + 1}.jpg`);
        e["img" + (i + 1)] = nid; e["anno" + (i + 1)] = "";
        if (i === 0 && (!e.weight || !e.umaban)) {
          const o = await B.ocr(s.blob);
          if (!o.error) { const p = parsePaddock(o.words, s.width, s.height); if (!e.weight && p.weight) e.weight = p.weight; if (!e.umaban && p.umaban) e.umaban = p.umaban; }
        }
        await save("entries", e); toast("画像を保存しました"); render();
      });
    }
    $("#delEntry").onclick = () => {
      const ni = imgCount([e]);
      askDelete($("#delEntryBox"), `<b>${esc(h.name)}</b> の <b>${esc(raceTitle(r))}</b> の出走記録を削除します。${ni ? `<br>パドック画像 ${ni}枚と線・比率も消えます（画像はGoogleドライブのゴミ箱に移り、30日間は元に戻せます）。` : ""}`,
        "出走記録を削除する", async () => {
          await removeEntries([e]); await reloadData(); toast("出走記録を削除しました");
          go(r.id ? "#/race/" + r.id : "#/horse/" + h.id);
        });
    };
    $("#saveEntry").onclick = ev => run(ev.target, async () => {
      const f = readRaceForm(); if (!f.date && !(f.venue && f.raceNo)) { showError("レース条件の日付、または開催場とレース番号を入力してください"); return; }
      const dup = f.venue && f.raceNo && findRace(f.date, f.venue, f.raceNo); if (dup && dup.id !== r.id) { showError("同じ日付・開催場・レース番号のレースが別にあります"); return; }
      Object.assign(e, { finish: $("#efinish").value, margin: $("#emargin").value.trim(), weight: $("#eweight").value, result: $("#eresult").value, umaban: $("#eumaban").value ? String(+$("#eumaban").value) : "", prediction: $("#epred").value, review: $("#ereview").value });
      await save("entries", e);
      const hv = readHorse(); delete hv.name;
      if (hv.sex !== (h.sex || "") || hv.styles !== (h.styles || "") || hv.body !== (h.body || "")) await save("horses", Object.assign(h, hv));
      if (r.id && Object.keys(f).some(k => String(f[k] || "") !== String(r[k] || ""))) await save("races", Object.assign(r, f));
      toast("保存しました");
    });
  }

  /* ================= 設定 ================= */
  function viewSettings() {
    const key = Settings.get("visionKey");
    main().innerHTML = `
      <div class="head"><h1>設定</h1></div>
      <section class="card"><h2>文字認識（Vision API）のAPIキー</h2>
        <p class="muted">キーはこのiPadの中にだけ保存され、アプリのコードやスプレッドシートには入りません。</p>
        <p>${key ? `設定済み（末尾 <span class="mono">${esc(key.slice(-4))}</span>）` : "未設定"}</p>
        <div class="row add"><label class="grow">APIキー<input type="password" id="vkey" autocomplete="off" placeholder="AIzaSy…"></label><button class="btn primary" id="saveKey">保存</button>${key ? '<button class="btn danger" id="delKey">削除</button>' : ""}</div>
      </section>
      <section class="card"><h2>データの保存先</h2>
        ${demo ? `<p><b class="pill">デモモード</b> データはこのブラウザの中にだけ保存されています。Googleの準備ができたら、設定ファイルにクライアントIDを入れると本番モードになります。</p>
          <div class="row"><button class="btn danger" id="resetDemo">デモのデータをすべて消す</button></div><div id="resetBox"></div>`
        : `<p>Googleドライブの「${esc(window.APP_CONFIG.appName)}」フォルダに保存しています。ログインの残り時間：約${Auth.minutesLeft()}分</p>
          <div class="row">${B.sheetURL() ? `<a class="btn" href="${esc(B.sheetURL())}" target="_blank" rel="noopener">スプレッドシートを開く</a>` : ""}<button class="btn" id="logout">ログアウト</button></div>`}
      </section>
      <section class="card"><h2>このアプリについて</h2><p class="muted">競走馬DB 版 ${APP_VERSION}。馬 ${D.horses.length}頭・レース ${D.races.length}件・出走 ${D.entries.length}件</p></section>`;
    $("#saveKey").onclick = () => { const v = $("#vkey").value.trim(); if (!/^[\w-]{20,}$/.test(v)) { showError("APIキーの形式が正しくないようです。コピーし直して貼り付けてください"); return; } Settings.set("visionKey", v); toast("APIキーを保存しました"); render(); };
    if ($("#delKey")) $("#delKey").onclick = () => { Settings.set("visionKey", ""); toast("APIキーを削除しました"); render(); };
    if ($("#logout")) $("#logout").onclick = () => { Auth.logout(); location.hash = "#/"; location.reload(); };
    if ($("#resetDemo")) $("#resetDemo").onclick = () => {
      $("#resetBox").innerHTML = `<div class="confirm">馬・レース・出走・画像をすべて消します。元に戻せません。<div class="row"><button class="btn danger" id="resetYes">消す</button><button class="btn" id="resetNo">やめる</button></div></div>`;
      $("#resetYes").onclick = async () => { await B.reset(); D = { horses: [], races: [], entries: [] }; toast("デモのデータを消しました"); go("#/"); };
      $("#resetNo").onclick = () => { $("#resetBox").innerHTML = ""; };
    };
  }

  /* ================= 起動 ================= */
  // 新しい版が公開されていたら1回だけ自動で読み込み直す（古いファイルが残る対策）
  const APP_VERSION = "19";
  async function checkUpdate() {
    if (!/github\.io$/.test(location.hostname)) return false;
    try {
      const html = await (await fetch("index.html?t=" + Date.now(), { cache: "no-store" })).text();
      const m = /app\.js\?v=(\d+)/.exec(html);
      if (m && m[1] !== APP_VERSION) {
        const key = "horsedb-reloaded-" + m[1];
        if (sessionStorage.getItem(key)) return false;
        sessionStorage.setItem(key, "1"); location.reload(); return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }
  async function boot() {
    if (await checkUpdate()) return;
    $("#mode").hidden = !demo;
    if (!demo) {
      const r = Auth.consumeRedirect();
      if (!Auth.valid()) {
        main().innerHTML = `<section class="login card"><h1>競走馬DB</h1><p>Googleアカウントでログインすると、Googleドライブのデータを読み込みます。</p>
          ${r === "error" ? banner("ログインできませんでした。もう一度お試しください。") : ""}
          <button class="btn primary big" id="login">Googleでログイン</button>
          <p class="muted">「Googleはこのアプリを確認していません」と出たら、「詳細」から進んでください（ご自身で作成したアプリです）。</p></section>`;
        $("#login").onclick = () => Auth.login(location.hash || "#/");
        return;
      }
    }
    main().innerHTML = `<p class="loading">データを読み込んでいます…</p>`;
    try {
      await B.init();
      D = await B.loadAll();
    } catch (e) {
      if (e instanceof AuthError) { Auth.logout(); location.reload(); return; }
      main().innerHTML = banner(esc(e.message || "読み込みに失敗しました") + ` <button class="btn" onclick="location.reload()">再読み込み</button>`, "error"); return;
    }
    ready = true; render();
    if (!demo) setInterval(() => { const m = Auth.minutesLeft(); const el = $("#session"); if (el) { el.hidden = m > 5; el.textContent = m > 0 ? `ログイン残り${m}分` : "ログイン期限切れ"; } }, 30000);
  }
  window.App = { toast };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
