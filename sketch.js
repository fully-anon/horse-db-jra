/* 画像書き込み（Apple Pencil）：全画面で開き、線・比率のデータを返す */
(function () {
  "use strict";
  const COLORS = ["#ff3b30", "#ffd60a", "#32d7ff", "#ffffff"];
  const WIDTHS = [2, 4, 7];
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const len = l => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
  function distSeg(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }

  // 保存済みデータから比率の値を計算（一覧表示用）
  function ratios(data) {
    if (!data || !data.ratios) return [];
    const byId = id => (data.lines || []).find(l => l.id === id);
    return data.ratios.map(r => { const a = byId(r.num), b = byId(r.den); return { name: r.name, value: a && b && len(b) ? len(a) / len(b) : null }; });
  }

  function open({ url, label, data }) {
    return new Promise(resolve => {
      const st = JSON.parse(JSON.stringify(data && data.lines ? data : { lines: [], strokes: [], ratios: [], uid: 1 }));
      st.uid = st.uid || 1;
      const undoStack = [];
      let tool = "select", color = COLORS[0], width = 4, show = true, fingerDraw = false;
      let sel = null, pending = null, hover = null, picking = false, picks = [], drag = null, pinch = null, view = null, img = null;
      const touches = new Map();

      const root = document.createElement("div");
      root.className = "sk"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", label + "の書き込み");
      root.innerHTML = `
        <div class="sk-bar">
          <strong class="sk-title">${esc(label)}</strong>
          <div class="sk-group" role="group" aria-label="道具">
            ${[["select", "選択"], ["line", "直線"], ["free", "自由線"], ["erase", "消しゴム"]].map(([t, l]) => `<button class="sk-b" data-t="${t}">${l}</button>`).join("")}
            <button class="sk-b" data-act="finger" title="Apple Pencilがないとき">指で描く</button>
          </div>
          <div class="sk-group" aria-label="色">${COLORS.map(c => `<button class="sk-sw" data-c="${c}" style="background:${c}" aria-label="色"></button>`).join("")}</div>
          <div class="sk-group" aria-label="太さ">${WIDTHS.map(w => `<button class="sk-b sk-w" data-w="${w}" aria-label="太さ${w}"><i style="height:${w}px"></i></button>`).join("")}</div>
          <div class="sk-group">
            <button class="sk-b" data-act="undo">取り消し</button>
            <button class="sk-b" data-act="del">削除</button>
            <button class="sk-b" data-act="vis">表示</button>
            <button class="sk-b" data-act="fit">全体</button>
            <button class="sk-b" data-act="clear">全消去</button>
          </div>
          <span class="sk-spacer"></span>
          <button class="sk-b" data-act="cancel">やめる</button>
          <button class="sk-b sk-primary" data-act="done">完了</button>
        </div>
        <div class="sk-stage"><canvas></canvas><div class="sk-hint"><span></span></div></div>
        <div class="sk-ratio"></div>`;
      document.body.appendChild(root);
      document.documentElement.classList.add("sk-open");
      const cv = root.querySelector("canvas"), ctx = cv.getContext("2d"), stage = root.querySelector(".sk-stage");
      const q = s => root.querySelector(s);

      const toImg = (cx, cy) => { const r = cv.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale }; };
      const tol = px => px / view.scale;
      const lineById = id => st.lines.find(l => l.id === id);
      const lineName = l => "L" + (st.lines.indexOf(l) + 1);
      function hitLine(p, px = 16) { let best = null, bd = tol(px); for (const l of st.lines) { const d = distSeg(p, l.a, l.b); if (d < bd) { bd = d; best = l; } } return best; }
      function hitEnd(p, l) { const t = tol(24); if (Math.hypot(p.x - l.a.x, p.y - l.a.y) < t) return "a"; if (Math.hypot(p.x - l.b.x, p.y - l.b.y) < t) return "b"; return null; }
      const snap = () => { undoStack.push(JSON.stringify({ lines: st.lines, strokes: st.strokes, ratios: st.ratios })); if (undoStack.length > 80) undoStack.shift(); };
      function undo() { const u = undoStack.pop(); if (!u) return; Object.assign(st, JSON.parse(u)); sel = null; pending = null; picks = picks.filter(id => lineById(id)); sync(); draw(); }

      function fit() {
        if (!img) return; const r = stage.getBoundingClientRect();
        const sc = Math.min(r.width / img.width, r.height / img.height) * 0.97;
        view = { scale: sc, x: (r.width - img.width * sc) / 2, y: (r.height - img.height * sc) / 2 }; draw();
      }
      function resize() { const r = stage.getBoundingClientRect(), d = window.devicePixelRatio || 1; cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); if (!view) fit(); else draw(); }
      const ro = new ResizeObserver(resize); ro.observe(stage);

      function label2(t, x, y, bg) {
        const d = window.devicePixelRatio || 1; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        const sx = (x * view.scale + view.x) * d, sy = (y * view.scale + view.y) * d;
        ctx.font = `700 ${12 * d}px system-ui,sans-serif`; const w = ctx.measureText(t).width + 12 * d, h = 20 * d;
        ctx.fillStyle = bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(sx - w / 2, sy - h - 8 * d, w, h, 5 * d); else ctx.rect(sx - w / 2, sy - h - 8 * d, w, h); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, sx, sy - h / 2 - 8 * d); ctx.restore();
      }
      function draw() {
        const d = window.devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
        if (!img || !view) return;
        ctx.setTransform(d * view.scale, 0, 0, d * view.scale, d * view.x, d * view.y); ctx.drawImage(img, 0, 0);
        if (!show) return;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const s of st.strokes) { if (s.pts.length < 2) continue; ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.beginPath(); ctx.moveTo(s.pts[0].x, s.pts[0].y); s.pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); }
        const role = {}; if (picking) { if (picks[0]) role[picks[0]] = ["分子", "#c2410c"]; if (picks[1]) role[picks[1]] = ["分母", "#0e7490"]; }
        for (const l of st.lines) {
          const isSel = l.id === sel, r = role[l.id];
          if (isSel || r) { ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = l.w + 4 / view.scale; ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke(); }
          ctx.strokeStyle = l.color; ctx.lineWidth = l.w; ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
          const er = (isSel ? 10 : 4) / view.scale;
          for (const p of [l.a, l.b]) { ctx.beginPath(); ctx.arc(p.x, p.y, er, 0, Math.PI * 2); ctx.fillStyle = isSel ? "#fff" : l.color; ctx.fill(); if (isSel) { ctx.lineWidth = 2.5 / view.scale; ctx.strokeStyle = "#1f5f8b"; ctx.stroke(); } }
          label2(lineName(l) + (r ? " " + r[0] : ""), (l.a.x + l.b.x) / 2, (l.a.y + l.b.y) / 2, r ? r[1] : "rgba(0,0,0,.7)");
        }
        if (pending) {
          const p2 = hover || pending; ctx.setLineDash([8 / view.scale, 6 / view.scale]); ctx.strokeStyle = color; ctx.lineWidth = width / view.scale;
          ctx.beginPath(); ctx.moveTo(pending.x, pending.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(pending.x, pending.y, 6 / view.scale, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        }
      }
      function zoomAt(sx, sy, f) {
        const r = stage.getBoundingClientRect(); const min = Math.min(r.width / img.width, r.height / img.height) * 0.5;
        const ns = Math.max(min, Math.min(12, view.scale * f)), k = ns / view.scale;
        view.x = sx - (sx - view.x) * k; view.y = sy - (sy - view.y) * k; view.scale = ns; draw();
      }
      function startGesture() {
        const pts = [...touches.values()];
        if (pts.length === 1) pinch = { mode: "pan", x: pts[0].x, y: pts[0].y };
        else if (pts.length >= 2) { const [a, b] = pts; pinch = { mode: "zoom", d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
        else pinch = null;
      }
      function moveGesture() {
        if (!pinch) return; const pts = [...touches.values()];
        if (pinch.mode === "pan" && pts.length === 1) { view.x += pts[0].x - pinch.x; view.y += pts[0].y - pinch.y; pinch.x = pts[0].x; pinch.y = pts[0].y; draw(); }
        else if (pinch.mode === "zoom" && pts.length >= 2) {
          const [a, b] = pts, d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = cv.getBoundingClientRect();
          view.x += mx - pinch.mx; view.y += my - pinch.my; zoomAt(mx - r.left, my - r.top, d / pinch.d); pinch.d = d; pinch.mx = mx; pinch.my = my;
        }
      }
      function removeLine(id) {
        st.lines = st.lines.filter(l => l.id !== id);
        const n = st.ratios.length; st.ratios = st.ratios.filter(r => r.num !== id && r.den !== id);
        if (n !== st.ratios.length) window.App && App.toast("線を消したため、その線を使った比率も削除しました");
        if (sel === id) sel = null; picks = picks.filter(x => x !== id);
      }
      function eraseAt(p) {
        const t = tol(14), before = st.strokes.length;
        st.strokes = st.strokes.filter(s => !s.pts.some((q, i) => i > 0 ? distSeg(p, s.pts[i - 1], q) < t : Math.hypot(p.x - q.x, p.y - q.y) < t));
        let hit = st.strokes.length !== before;
        const l = hitLine(p, 14); if (l) { removeLine(l.id); hit = true; }
        if (hit) { drag.hit = true; draw(); }
      }
      function penDown(e, finger) {
        const p = toImg(e.clientX, e.clientY);
        if (picking) {
          const l = hitLine(p, 24);
          if (l) { if (picks.includes(l.id)) picks = picks.filter(x => x !== l.id); else if (picks.length < 2) picks.push(l.id); else picks = [picks[0], l.id]; sync(); draw(); }
          return;
        }
        if (tool === "select") {
          if (sel) { const l = lineById(sel), end = l && hitEnd(p, l); if (end) { snap(); drag = { type: "end", lid: l.id, end, id: e.pointerId, finger }; return; } }
          const l = hitLine(p);
          if (l) { sel = l.id; snap(); drag = { type: "move", lid: l.id, last: p, id: e.pointerId, finger }; } else sel = null;
          sync(); draw(); return;
        }
        if (tool === "line") {
          if (!pending) { pending = p; hint("2点目をタップ（「直線」をもう一度押すと取消）"); }
          else { snap(); const l = { id: st.uid++, a: pending, b: p, color, w: width / view.scale }; st.lines.push(l); pending = null; sel = l.id; hint(lineName(l) + " を作成。続けて1点目をタップ"); sync(); }
          draw(); return;
        }
        if (tool === "free") { snap(); const s = { id: st.uid++, color, w: width / view.scale, pts: [p] }; st.strokes.push(s); drag = { type: "free", s, id: e.pointerId, finger }; return; }
        if (tool === "erase") { snap(); drag = { type: "erase", id: e.pointerId, hit: false, finger }; eraseAt(p); }
      }
      function cancelFinger() {
        if (drag.type === "free") { st.strokes.pop(); undoStack.pop(); }
        else { const u = undoStack.pop(); if (u) Object.assign(st, JSON.parse(u)); }
        drag = null; draw();
      }
      cv.addEventListener("pointerdown", e => {
        cv.setPointerCapture(e.pointerId);
        if (e.pointerType === "touch") {
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (fingerDraw && touches.size === 1) { penDown(e, true); return; }
          if (drag && drag.finger) cancelFinger();
          startGesture(); return;
        }
        if (e.button === 1 || e.button === 2) { drag = { type: "pan", x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
        penDown(e, false);
      });
      cv.addEventListener("pointermove", e => {
        if (e.pointerType === "touch" && !(drag && drag.id === e.pointerId)) { if (touches.has(e.pointerId)) { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); moveGesture(); } return; }
        const p = toImg(e.clientX, e.clientY); hover = p;
        if (drag && drag.id === e.pointerId) {
          if (drag.type === "pan") { view.x += e.clientX - drag.x; view.y += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; }
          else if (drag.type === "end") { lineById(drag.lid)[drag.end] = { x: p.x, y: p.y }; drag.moved = true; }
          else if (drag.type === "move") { const l = lineById(drag.lid), dx = p.x - drag.last.x, dy = p.y - drag.last.y; l.a = { x: l.a.x + dx, y: l.a.y + dy }; l.b = { x: l.b.x + dx, y: l.b.y + dy }; drag.last = p; drag.moved = true; }
          else if (drag.type === "free") drag.s.pts.push(p);
          else if (drag.type === "erase") eraseAt(p);
          draw(); if (drag.type === "end" || drag.type === "move") ratioUI(); return;
        }
        if (pending) draw();
      });
      function up(e) {
        if (e.pointerType === "touch") { touches.delete(e.pointerId); if (!(drag && drag.id === e.pointerId)) { startGesture(); return; } }
        if (drag && drag.id === e.pointerId) {
          if (drag.type === "free" && drag.s.pts.length < 2) { st.strokes.pop(); undoStack.pop(); }
          if ((drag.type === "end" || drag.type === "move") && !drag.moved) undoStack.pop();
          if (drag.type === "erase" && !drag.hit) undoStack.pop();
          drag = null; sync(); draw();
        }
      }
      cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      cv.addEventListener("contextmenu", e => e.preventDefault());
      cv.addEventListener("wheel", e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

      const hintEl = q(".sk-hint span");
      const HINT = { select: "線をタップで選択。端の丸で長さ・向き、線をドラッグで平行移動", line: "1点目をタップ", free: "なぞって描く", erase: "消したい線をなぞる" };
      function hint(t) { hintEl.textContent = t + (fingerDraw ? "（2本指で拡大・移動）" : "（指で拡大・移動）"); }

      function ratioUI() {
        const box = q(".sk-ratio");
        const saved = st.ratios.map(r => { const a = lineById(r.num), b = lineById(r.den); const v = a && b && len(b) ? (len(a) / len(b)).toFixed(3) : "—"; return `<span class="sk-chip">${esc(r.name)} <b>${v}</b> <button data-delr="${r.id}" aria-label="${esc(r.name)}を削除">×</button></span>`; }).join("");
        if (!picking) {
          box.innerHTML = `<button class="sk-b sk-primary" data-act="pick" ${st.lines.length < 2 ? "disabled" : ""}>比率を測る</button>${saved || '<span class="sk-muted">直線を2本引くと比率を測れます</span>'}`;
        } else {
          const a = lineById(picks[0]), b = lineById(picks[1]); const v = a && b && len(b) ? len(a) / len(b) : null;
          box.innerHTML = `<span class="sk-tag" style="background:#c2410c">分子</span>${a ? lineName(a) : "未選択"}
            <span class="sk-tag" style="background:#0e7490">分母</span>${b ? lineName(b) : "未選択"}
            <b class="sk-val">${v ? v.toFixed(3) : "—"}</b>
            <input type="text" id="sk-rname" list="sk-names" value="背中/後肢" aria-label="比率の名前">
            <datalist id="sk-names"><option value="背中/後肢"></option></datalist>
            <button class="sk-b sk-primary" data-act="saver" ${v ? "" : "disabled"}>保存</button>
            <button class="sk-b" data-act="cancelr">やめる</button>`;
        }
      }
      function sync() {
        root.querySelectorAll("[data-t]").forEach(b => b.setAttribute("aria-pressed", b.dataset.t === tool && !picking));
        root.querySelectorAll("[data-c]").forEach(b => b.setAttribute("aria-pressed", b.dataset.c === color));
        root.querySelectorAll("[data-w]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.w === width));
        q("[data-act=finger]").setAttribute("aria-pressed", fingerDraw);
        q("[data-act=vis]").setAttribute("aria-pressed", show);
        q("[data-act=undo]").disabled = !undoStack.length; q("[data-act=del]").disabled = !sel;
        ratioUI();
      }
      const applySel = fn => { const l = sel && lineById(sel); if (l) { snap(); fn(l); draw(); } };
      let confirmClear = false;
      root.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.t) { const t = b.dataset.t; if (t === "line" && tool === "line" && pending) { pending = null; } else { tool = t; pending = null; } picking = false; picks = []; hint(HINT[tool]); sync(); draw(); return; }
        if (b.dataset.c) { color = b.dataset.c; applySel(l => l.color = color); sync(); return; }
        if (b.dataset.w) { width = +b.dataset.w; applySel(l => l.w = width / view.scale); sync(); return; }
        if (b.dataset.delr) { snap(); st.ratios = st.ratios.filter(r => String(r.id) !== b.dataset.delr); sync(); return; }
        const a = b.dataset.act;
        if (a === "undo") undo();
        else if (a === "del" && sel) { snap(); removeLine(sel); sync(); draw(); }
        else if (a === "vis") { show = !show; sync(); draw(); }
        else if (a === "fit") fit();
        else if (a === "finger") { fingerDraw = !fingerDraw; hint(HINT[tool]); sync(); }
        else if (a === "clear") {
          if (!confirmClear) { confirmClear = true; b.textContent = "本当に消す"; setTimeout(() => { confirmClear = false; b.textContent = "全消去"; }, 3000); return; }
          snap(); st.lines = []; st.strokes = []; st.ratios = []; sel = null; picks = []; confirmClear = false; b.textContent = "全消去"; sync(); draw();
        }
        else if (a === "pick") { picking = true; picks = []; pending = null; hintEl.textContent = "分子にする線 → 分母にする線の順にタップ"; sync(); draw(); }
        else if (a === "saver") { const name = (q("#sk-rname").value || "背中/後肢").trim(); snap(); st.ratios.push({ id: st.uid++, name, num: picks[0], den: picks[1] }); picking = false; picks = []; hint(HINT[tool]); sync(); draw(); }
        else if (a === "cancelr") { picking = false; picks = []; hint(HINT[tool]); sync(); draw(); }
        else if (a === "cancel") close(null);
        else if (a === "done") close(st);
      });
      function onKey(e) {
        if (e.target.tagName === "INPUT") return;
        if (e.key === "Escape") { pending = null; picking = false; picks = []; sel = null; sync(); draw(); }
        if ((e.key === "Delete" || e.key === "Backspace") && sel) { snap(); removeLine(sel); sync(); draw(); }
        if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
      }
      document.addEventListener("keydown", onKey);
      function close(result) { ro.disconnect(); document.removeEventListener("keydown", onKey); root.remove(); document.documentElement.classList.remove("sk-open"); resolve(result ? JSON.parse(JSON.stringify(result)) : null); }

      const im = new Image(); im.onload = () => { img = im; resize(); fit(); }; im.src = url;
      hint(HINT[tool]); sync();
    });
  }
  window.Sketch = { open, ratios };
})();
