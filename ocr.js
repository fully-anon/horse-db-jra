/* パドック画像の文字認識結果から項目を取り出す処理と、馬名の名寄せ */
(function () {
  "use strict";
  const VENUES = ["札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];

  // 単語を行にまとめる（縦位置が近いものを同じ行とみなす）
  function toLines(words) {
    const items = words.map(w => {
      const v = (w.boundingPoly && w.boundingPoly.vertices) || [];
      const xs = v.map(p => p.x || 0), ys = v.map(p => p.y || 0);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      return { t: w.description || "", x0, x1, y0, y1, cy: (y0 + y1) / 2, h: Math.max(1, y1 - y0) };
    }).filter(i => i.t && isFinite(i.x0));
    items.sort((a, b) => a.cy - b.cy);
    const lines = [];
    for (const it of items) {
      const ln = lines.find(l => Math.abs(l.cy - it.cy) < Math.max(l.h, it.h) * 0.55);
      if (ln) { ln.items.push(it); ln.cy = (ln.cy * (ln.items.length - 1) + it.cy) / ln.items.length; ln.h = Math.max(ln.h, it.h); }
      else lines.push({ items: [it], cy: it.cy, h: it.h });
    }
    lines.forEach(l => {
      l.items.sort((a, b) => a.x0 - b.x0);
      l.text = l.items.map(i => i.t).join("");
      l.x0 = Math.min(...l.items.map(i => i.x0)); l.x1 = Math.max(...l.items.map(i => i.x1));
      l.y0 = Math.min(...l.items.map(i => i.y0)); l.y1 = Math.max(...l.items.map(i => i.y1));
    });
    return lines;
  }

  const nfkc = s => (s || "").normalize("NFKC");
  const KATA = /[ァ-ヺー]{2,9}/g;
  function longestKatakana(s) { const m = nfkc(s).match(KATA) || []; return m.sort((a, b) => b.length - a.length)[0] || ""; }

  /**
   * words: Vision の textAnnotations（先頭の全文を除く）, w/h: 画像サイズ
   * 戻り値：{ venue, raceNo, umaban, name, weight, telop, missing[] }
   */
  function parsePaddock(words, w, h) {
    const lines = toLines(words || []);
    const out = { venue: "", raceNo: "", umaban: "", name: "", weight: "", telop: false, missing: [] };
    const top = lines.filter(l => l.cy < h * 0.25 && l.x0 < w * 0.55);
    const bottom = lines.filter(l => l.cy > h * 0.68);
    const rest = lines;

    // 下部テロップがあるか（「kg」を含む行があるか）
    // 映像だけの画像では下部、ページ全体のスクリーンショットでは中ほどにある。一番下の「000kg」の行を採る
    const telopLine = lines.filter(l => l.cy > h * 0.25 && /\d{3}\s*kg/i.test(nfkc(l.text)) && !/\(\s*[+\-−]?\d+\s*\)/.test(nfkc(l.text))).sort((a, b) => b.cy - a.cy)[0];
    out.telop = !!telopLine;

    // 開催場：左上テロップ優先、なければ全体
    const findVenue = ls => { for (const l of ls) { const t = nfkc(l.text); const v = VENUES.find(x => t.includes(x)); if (v) return v; } return ""; };
    out.venue = findVenue(top) || (out.telop ? findVenue(rest) : "");

    // レース番号：「11R」の形。左上テロップ優先、なければゼッケン
    // 「◀11R」のような前後レースへの移動ボタンは除き、いちばん多く出てくる番号を採る（テロップ・ゼッケン・ページ見出し）
    const findRace = ls => {
      const cnt = {}; let first = "";
      ls.forEach(l => { const re = /(^|[^◀◁<▶▷>\d])(\d{1,2})\s*R(?![a-z])/gi; let m; const s = nfkc(l.text); while ((m = re.exec(s))) if (+m[2] >= 1 && +m[2] <= 12) { cnt[+m[2]] = (cnt[+m[2]] || 0) + 1; if (!first) first = String(+m[2]); } });
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      return best && best[1] > 1 ? best[0] : first;
    };
    out.raceNo = findRace(rest) || findRace(top);

    if (telopLine) {
      const t = nfkc(telopLine.text);
      // 馬体重
      const wm = /(\d{3})\s*kg/i.exec(t); if (wm) out.weight = wm[1];
      // 馬番：テロップ行の左端の数字
      const first = telopLine.items.find(i => /^\d{1,2}$/.test(nfkc(i.t)));
      if (first && first.x0 < telopLine.x0 + (telopLine.x1 - telopLine.x0) * 0.25 && +nfkc(first.t) >= 1 && +nfkc(first.t) <= 18) out.umaban = String(+nfkc(first.t));
      // 馬名：テロップ行のカタカナ
      out.name = longestKatakana(telopLine.items.filter(i => !/kg/i.test(i.t)).map(i => i.t).join(""));
      if (!out.name) { const near = lines.filter(l => l !== telopLine && Math.abs(l.cy - telopLine.cy) < telopLine.h * 3).map(l => longestKatakana(l.text)).find(Boolean); out.name = near || ""; }
    }
    // テロップがない、または取れなかった項目はゼッケンから
    if (!out.name) {
      const cands = lines.filter(l => l.cy > h * 0.12 && l.cy < h * 0.8).map(l => longestKatakana(l.text)).filter(Boolean);
      out.name = cands.sort((a, b) => b.length - a.length)[0] || "";
    }
    if (!out.umaban) {
      // ゼッケンの大きな数字（1〜18）。一番文字が大きいものを採用
      const nums = [];
      lines.forEach(l => l.items.forEach(i => { const t = nfkc(i.t); if (/^\d{1,2}$/.test(t) && +t >= 1 && +t <= 18 && i.cy > h * 0.1) nums.push({ n: +t, h: i.h }); }));
      nums.sort((a, b) => b.h - a.h);
      if (nums[0]) out.umaban = String(nums[0].n);
    }
    [["name", "馬名"], ["venue", "開催場"], ["raceNo", "レース番号"], ["umaban", "馬番"], ["weight", "馬体重"]].forEach(([k, l]) => { if (!out[k]) out.missing.push(l); });
    return out;
  }

  /* ---------------- 馬名の正規化と照合 ---------------- */
  const SMALL = { "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ", "ッ": "ツ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ヮ": "ワ" };
  function normName(s) {
    let t = nfkc(s).replace(/[\s　・･]/g, "");
    t = t.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)); // ひらがな→カタカナ
    t = t.replace(/[ー－―‐-]/g, "ー").replace(/[一]/g, "ー"); // 長音の揺れ（漢数字の一も長音扱い）
    return t;
  }
  // 照合用：さらに小書き・濁点の違いも吸収
  function looseName(s) {
    return normName(s).replace(/[ァィゥェォッャュョヮ]/g, c => SMALL[c]).normalize("NFD").replace(/[゙゚]/g, "").normalize("NFC");
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  /** 戻り値：{ exact: 馬 | null, candidates: [馬...] }（候補は1文字違い・表記揺れ） */
  function matchHorse(name, horses) {
    const n = normName(name); if (!n) return { exact: null, candidates: [] };
    const exact = horses.find(h => normName(h.name) === n) || null;
    if (exact) return { exact, candidates: [] };
    const ln = looseName(name);
    const candidates = horses.filter(h => { const hl = looseName(h.name); return hl === ln || lev(normName(h.name), n) <= 1; });
    return { exact: null, candidates };
  }

  /* ================= レース結果ページのスクリーンショット ================= */
  // 単語を「見た目のかたまり」にまとめる（同じ行で、すき間がほぼない単語どうし）
  function toSegments(words) {
    const segs = [];
    toLines(words).forEach(l => {
      let cur = null;
      l.items.forEach(it => {
        // 数字と日本語の境目（「11フェアリーライク」「55.0坂井」など）は、すき間がごく小さくないかぎり分ける
        const a = cur && cur.t.slice(-1), b = it.t[0], gap = cur ? it.x0 - cur.x1 : 0, hh = cur ? Math.max(cur.h, it.h) : 0;
        const kindChange = cur && (/[\d.]/.test(a) && /[ぁ-んァ-ヺ一-龯]/.test(b) || /[ぁ-んァ-ヺ一-龯]/.test(a) && /\d/.test(b));
        if (cur && gap < hh * (kindChange ? 0.08 : 0.35)) {
          cur.t += it.t; cur.x1 = Math.max(cur.x1, it.x1); cur.y0 = Math.min(cur.y0, it.y0); cur.y1 = Math.max(cur.y1, it.y1); cur.h = cur.y1 - cur.y0;
        } else { if (cur) segs.push(cur); cur = { t: it.t, x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1, h: it.h }; }
      });
      if (cur) segs.push(cur);
    });
    segs.forEach(s => { s.t = nfkc(s.t); s.cx = (s.x0 + s.x1) / 2; s.cy = (s.y0 + s.y1) / 2; });
    return segs;
  }
  const WD = "日月火水木金土";
  // 「5/2(土)」から年を推定：曜日が一致する直近の年（今日より後は除く）
  function inferDate(mo, d, wd, today = new Date()) {
    const p = n => String(n).padStart(2, "0");
    for (let y = today.getFullYear(); y >= today.getFullYear() - 2; y--) { // 曜日の読み間違いで何年も前にならないよう直近3年まで
      const dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1 || dt > today) continue;
      if (!wd || WD[dt.getDay()] === wd) return `${y}-${p(mo)}-${p(d)}`;
    }
    const y = today.getFullYear() - (new Date(today.getFullYear(), mo - 1, d) > today ? 1 : 0);
    return `${y}-${p(mo)}-${p(d)}`;
  }
  function classOf(t) {
    if (/G\s*(III|3)(?![\dI])/.test(t)) return "G3";
    if (/G\s*(II|2)(?![\dI])/.test(t)) return "G2";
    if (/G\s*(I|1)(?![\dI])/.test(t)) return "G1";
    if (/\(L\)|リステッド/.test(t)) return "L";
    if (/オープン|\(OP\)|\bOP\b/.test(t)) return "OP";
    if (/新馬/.test(t)) return "新馬";
    if (/未勝利/.test(t)) return "未勝利";
    if (/1勝クラス|500万/.test(t)) return "1勝";
    if (/2勝クラス|1000万/.test(t)) return "2勝";
    if (/3勝クラス|1600万/.test(t)) return "3勝";
    return "";
  }
  // ページ上部のレース情報
  function parseRaceHeader(segs, w, h) {
    const out = {};
    const lines = toLines(segs.map(s => ({ description: s.t, boundingPoly: { vertices: [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }] } })))
      .map(l => ({ text: nfkc(l.text), cy: l.cy })).sort((a, b) => a.cy - b.cy);
    const spaced = toLines(segs.map(s => ({ description: s.t + " ", boundingPoly: { vertices: [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }] } })))
      .map(l => ({ text: nfkc(l.text).trim(), cy: l.cy })).sort((a, b) => a.cy - b.cy);
    const top = lines.filter(l => l.cy < h * 0.35), topS = spaced.filter(l => l.cy < h * 0.35);
    // 日付：「5/2(土)」または「10月11日(日)」。着差の「1.1/2」などは日付にしない。
    // PC版のように日付のタブが並んでいるときは、どれが選ばれているか分からないので候補として返す
    const DRES = [/(^|[^\d.])(\d{1,2})\/(\d{1,2})\s*[(（]\s*([日月火水木金土])/g, /(^|[^\d])(\d{1,2})月\s*(\d{1,2})日\s*[(（]\s*([日月火水木金土])/g];
    const dates = [];
    top.forEach(l => DRES.forEach(re => { re.lastIndex = 0; let m; while ((m = re.exec(l.text))) if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) { const d = inferDate(+m[2], +m[3], m[4]); if (!dates.includes(d)) dates.push(d); } }));
    if (dates.length === 1) out.date = dates[0]; else if (dates.length > 1) out.dateOptions = dates;
    // 開催場：「4回 京都 4日目」があれば最優先（PC版は 東京・京都 のタブも並ぶため）
    const kai = lines.map(l => new RegExp("\\d+回\\s*(" + VENUES.join("|") + ")\\s*\\d+日").exec(l.text)).find(Boolean);
    if (kai) out.venue = kai[1];
    else for (const l of top) { const v = VENUES.find(x => l.text.includes(x)); if (v) { out.venue = v; break; } }
    // レース名の行：「10R 三年坂S」「12R 4歳以上2勝クラス」。「10R 11R 12R」のようなタブの並びや「◀11R」は除く
    const TRE = /^(\d{1,2})\s*R\s+(.+)$/;
    const tlS = topS.find(l => { const m = TRE.exec(l.text); return m && /[^\d\s▼▽∨⌄]/.test(m[2]) && !/\d:\d{2}/.test(l.text) && (l.text.match(/\d{1,2}\s*R\b/g) || []).length === 1; });
    const KEY = /クラス|新馬|未勝利|ステークス|賞|カップ|特別|オープン|\(G|\(L\)|ハンデ|記念|杯/;
    if (tlS) {
      const m = TRE.exec(tlS.text);
      if (+m[1] >= 1 && +m[1] <= 12) out.raceNo = String(+m[1]);
      out.raceName = m[2].replace(/[▼▽∨⌄]/g, "").replace(/(\s+(\d勝|G\s*(I{1,3}|\d)|L|OP|WIN\d|[A-Z]{2,}\d?))+\s*$/i, "").trim();
      out.cls = classOf(m[2]);
    } else {
      const tl = top.find(l => KEY.test(l.text) && !/\d:\d{2}\.\d/.test(l.text));
      if (tl) {
        const m = /(\d{1,2})\s*R/.exec(tl.text); if (m && +m[1] >= 1 && +m[1] <= 12) out.raceNo = String(+m[1]);
        out.raceName = tl.text.replace(/^.*?\d{1,2}\s*R\s*/, "").replace(/[▼▽∨⌄]/g, "").trim();
        out.cls = classOf(tl.text);
      }
    }
    // クラスはレース名の行になければ、条件の行（「サラ系3歳以上 3勝クラス」など）から
    if (!out.cls) { const cl2 = top.find(l => /サラ系|クラス|新馬|未勝利|オープン/.test(l.text) && classOf(l.text)); if (cl2) out.cls = classOf(cl2.text); }
    if (!out.raceNo) { // 「◀11R」のような移動ボタンは除いて、いちばん多く出てくるレース番号
      const cnt = {}; lines.forEach(l => { const re = /(^|[^◀◁<▶▷>\d])(\d{1,2})\s*R(?![a-z])/gi; let m; while ((m = re.exec(l.text))) if (+m[2] >= 1 && +m[2] <= 12) cnt[+m[2]] = (cnt[+m[2]] || 0) + 1; });
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (best) out.raceNo = best[0];
    }
    const cl = lines.find(l => /(芝|ダート|ダ)\s*(\d{3,4})\s*m/.test(l.text));
    if (cl) {
      const m = /(芝|ダート|ダ)\s*(\d{3,4})\s*m/.exec(cl.text);
      out.surface = m[1] === "芝" ? "芝" : "ダート"; out.distance = m[2];
      const after = cl.text.slice(m.index + m[0].length);
      const g = after.match(/稍重|不良|稍|不|重|良/g);
      if (g) out.going = { "稍": "稍重", "不": "不良" }[g[g.length - 1]] || g[g.length - 1];
    }
    const gm = lines.map(l => /馬場\s*[:：]\s*(稍重|不良|重|良|稍|不)/.exec(l.text)).find(Boolean); // PC版「馬場:稍重」
    if (gm) out.going = { "稍": "稍重", "不": "不良" }[gm[1]] || gm[1];
    // ラップは数字が詰まって「12.311.0」とならないよう、かたまりの間に空白を入れた行で読む
    out.lap = parseLap(spaced);
    return out;
  }
  // ラップ：「12.5-10.9-11.3…」の並び。「ハロン」「ラップ」の行を優先し、累計（23.4、35.0…）は除く
  const LAPNUM = /(^|[^\d.:])(\d{1,2}\.\d)(?![\d倍])/g;
  function lapNums(s) { const out = []; let m; LAPNUM.lastIndex = 0; while ((m = LAPNUM.exec(s))) out.push(+m[2]); return out; }
  const isLapSeq = ns => ns.length >= 3 && ns.every(v => v >= 5 && v < 16) && ns.filter(v => v >= 10).length >= ns.length - 1;
  function parseLap(lines) {
    const cand = lines.map((l, i) => ({ i, text: l.text, cy: l.cy, ns: /\d:\d{2}\.\d|倍|人気|kg/.test(l.text) ? [] : lapNums(l.text) })).filter(c => isLapSeq(c.ns));
    if (!cand.length) return "";
    const labeled = cand.filter(c => /ハロン|ラップ/.test(c.text) && !/累計|ペース/.test(c.text));
    let best = labeled[0] || cand.sort((a, b) => b.ns.length - a.ns.length)[0];
    // 長いレースで2行に折り返している場合は、すぐ下の行も続きとしてつなげる
    let ns = best.ns.slice(), last = best;
    for (;;) {
      const next = cand.find(c => c.i > last.i && c.i <= last.i + 2 && !/ハロン|ラップ|累計|ペース/.test(c.text));
      if (!next || ns.length >= 20) break;
      ns = ns.concat(next.ns); last = next;
    }
    return ns.map(v => v.toFixed(1)).join("-");
  }
  const MARGIN = /^(ハナ|アタマ|クビ|大差|大|同着|\d{1,2}|\d\/\d|\d\.\d\/\d|\d+\.\d\/\d)$/;
  // 結果・着順の一覧（1行＝1頭）
  function parseResultRows(segs, w, h) {
    // 馬名：左側のカタカナ。同じ行にカタカナの騎手名（ルメールなど）があっても、いちばん左だけを馬名とする
    const cand = segs.filter(s => s.x0 < w * 0.45 && /[ァ-ヺー]{2,}/.test(s.t) && !/kg|人気|倍/.test(s.t) && !/^(タイム|オッズ|馬名|ラップ|ハロン|コーナー|ペース|レース|データ|ワイド|ワイ|トリプル|マイ)/.test(s.t))
      .sort((a, b) => a.x0 - b.x0);
    const names = [];
    cand.forEach(s => { if (!names.some(n => Math.abs(n.cy - s.cy) < Math.max(n.h, s.h) * 0.6)) names.push(s); });
    names.sort((a, b) => a.y0 - b.y0);
    // 表の見出し（PC版）。「着差」の列の位置が分かれば、その列から着差を読む
    const hdr = segs.find(s => /^着差$/.test(s.t));
    let hdrHalf = 0;
    if (hdr) {
      const row = segs.filter(s => s !== hdr && Math.abs(s.cy - hdr.cy) < hdr.h * 1.5 && /^(タイム|人気|単勝|オッズ|着順|騎手|斤量)/.test(s.t));
      const d = row.map(s => Math.abs(s.cx - hdr.cx)).sort((a, b) => a - b)[0];
      hdrHalf = d ? d / 2 : hdr.h * 2;
    }
    const rows = [];
    names.forEach((nm, i) => {
      // 1頭分の範囲：次の馬名の手前まで（最後の行は馬名の高さの6倍まで。下の払戻しやラップを含めない）
      const top = nm.y0 - nm.h * 0.5, bottom = Math.min(i + 1 < names.length ? names[i + 1].y0 - names[i + 1].h * 0.5 : h, nm.y0 + nm.h * 6);
      const band = segs.filter(s => s.cy >= top && s.cy < bottom && s !== nm);
      const time = band.find(s => /\d:\d{2}\.\d/.test(s.t));
      // 馬体重：「496kg(-6)」（スマホ版）または「478(-2)」（PC版、表の右端）
      const WRE = /(^|[^\d.])(\d{3})\s*(kg)?\s*\(\s*([+\-−]?\d{1,2}|前計不|計不)\s*\)/i;
      const wt = band.find(s => WRE.test(s.t)) || band.find(s => /\d{3}\s*kg/i.test(s.t) && s.x0 < w * 0.6);
      const wtRes = wt && WRE.test(wt.t);
      if (!time && !wtRes) return; // 結果の行ではない（パドック映像のテロップなど）
      const r = { name: (nfkc(nm.t).match(/[ァ-ヺー]{2,}/g) || []).sort((a, b) => b.length - a.length)[0] };
      if (wt) { const m = WRE.exec(wt.t) || /()(\d{3})\s*kg/i.exec(wt.t); if (+m[2] >= 300 && +m[2] <= 700) r.weight = m[2]; }
      // 名前より左の数字：左から 着順・枠・馬番
      const nums = band.filter(s => s.x1 <= nm.x0 + nm.h * 0.3 && /^\d{1,2}$/.test(s.t)).sort((a, b) => a.cx - b.cx);
      const cols = []; nums.forEach(s => { const c = cols.find(c => Math.abs(c.cx - s.cx) < s.h * 0.8); if (!c) cols.push({ cx: s.cx, segs: [s] }); else c.segs.push(s); });
      cols.sort((a, b) => a.cx - b.cx);
      const pick = c => c && c.segs.sort((a, b) => a.cy - b.cy)[0].t;
      if (cols.length >= 3) { r.finish = pick(cols[cols.length - 3]); r.umaban = pick(cols[cols.length - 1]); }
      else if (cols.length === 2) {
        // 着順の列には「着」が並ぶ。なければ「枠・馬番」とみなす
        const chaku = band.find(s => /^着$|^\d{1,2}着$/.test(s.t) && Math.abs(s.cx - cols[0].cx) < s.h);
        if (chaku) { r.finish = pick(cols[0]); r.umaban = pick(cols[1]); } else r.umaban = pick(cols[1]);
      } else if (cols.length === 1) r.umaban = pick(cols[0]);
      const fin = band.find(s => /^(\d{1,2})着$/.test(s.t)); if (!r.finish && fin) r.finish = /^(\d{1,2})/.exec(fin.t)[1];
      const stop = band.find(s => /^(中止|除外|取消|失格)$/.test(s.t) && s.x1 <= nm.x0); if (stop) r.finish = stop.t;
      if (r.umaban && !(+r.umaban >= 1 && +r.umaban <= 18)) delete r.umaban;
      if (r.finish && /^\d+$/.test(r.finish) && !(+r.finish >= 1 && +r.finish <= 18)) delete r.finish;
      if (!r.umaban && !r.finish) return; // 着順も馬番もない行は結果の行とみなさない
      // 着差：PC版は「着差」の列、スマホ版はタイムの真下（上がり3F「(36.0)」より上）
      if (hdr && time) {
        const mg = band.filter(s => Math.abs(s.cx - hdr.cx) < hdrHalf && MARGIN.test(s.t)).sort((a, b) => Math.abs(a.cx - hdr.cx) - Math.abs(b.cx - hdr.cx));
        r.margin = mg.length ? mg[0].t.replace(/^大$/, "大差") : "";
        r.hasTime = true;
      } else if (time) {
        const half = (time.x1 - time.x0) * 0.75 + time.h;
        const up = band.find(s => /^\(\d{2}\.\d\)$/.test(s.t) && Math.abs(s.cx - time.cx) < half);
        const mg = band.filter(s => s !== time && s.cy > time.cy + time.h * 0.4 && (!up || s.cy < up.cy - up.h * 0.4) && Math.abs(s.cx - time.cx) < half && MARGIN.test(s.t))
          .sort((a, b) => a.cy - b.cy);
        r.margin = mg.length ? mg[0].t.replace(/^大$/, "大差") : "";
        r.hasTime = true;
      }
      // 性齢「牡4」「セ4」
      const sx = band.find(s => /^(牡|牝|セ|騸)\s*\d{1,2}$/.test(s.t) || /^(牡|牝|セ|騸)\d/.test(s.t));
      if (sx) r.sex = { "牡": "牡", "牝": "牝", "セ": "セン", "騸": "セン" }[sx.t[0]];
      rows.push(r);
    });
    return rows;
  }
  /** images: [{words, w, h}] → { race: {...}, rows: [{umaban, name, finish, margin, weight, sex}] } */
  function parseResultImages(images) {
    const race = {}, byKey = new Map();
    images.forEach(im => {
      const segs = toSegments(im.words || []);
      const hd = parseRaceHeader(segs, im.w, im.h);
      Object.keys(hd).forEach(k => { if (hd[k] && !race[k]) race[k] = hd[k]; });
      parseResultRows(segs, im.w, im.h).forEach(r => {
        // 同じ馬（2枚に分かれて写った行）は馬名でまとめる。馬番の読み間違いで別の馬を混ぜないため
        const key = r.name ? "n" + normName(r.name) : "u" + r.umaban;
        const old = byKey.get(key);
        if (!old) byKey.set(key, r);
        else Object.keys(r).forEach(k => { if (r[k] && !old[k]) old[k] = r[k]; }); // 2枚に分かれた行は足し合わせる
      });
    });
    const rows = [...byKey.values()].sort((a, b) => (+a.finish || 99) - (+b.finish || 99) || (+a.umaban || 99) - (+b.umaban || 99));
    return { race, rows };
  }

  // 手入力・貼り付けしたラップを「12.5-10.9-…」の形にそろえる
  function normLap(s) { const ns = lapNums(nfkc(String(s || "")).replace(/[‐－―–—ー]/g, "-")); return ns.map(v => v.toFixed(1)).join("-"); }

  window.Paddock = { VENUES, parsePaddock, normName, matchHorse, parseResultImages, inferDate, normLap };
})();
