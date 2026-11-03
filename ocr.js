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
    const telopLine = bottom.find(l => /\d{3}\s*kg/i.test(nfkc(l.text)));
    out.telop = !!telopLine;

    // 開催場：左上テロップ優先、なければ全体
    const findVenue = ls => { for (const l of ls) { const t = nfkc(l.text); const v = VENUES.find(x => t.includes(x)); if (v) return v; } return ""; };
    out.venue = findVenue(top) || (out.telop ? findVenue(rest) : "");

    // レース番号：「11R」の形。左上テロップ優先、なければゼッケン
    const findRace = ls => { for (const l of ls) { const m = /(\d{1,2})\s*R\b/i.exec(nfkc(l.text)); if (m && +m[1] >= 1 && +m[1] <= 12) return String(+m[1]); } return ""; };
    out.raceNo = findRace(top) || findRace(rest);

    if (telopLine) {
      const t = nfkc(telopLine.text);
      // 馬体重
      const wm = /(\d{3})\s*kg/i.exec(t); if (wm) out.weight = wm[1];
      // 馬番：テロップ行の左端の数字
      const first = telopLine.items.find(i => /^\d{1,2}$/.test(nfkc(i.t)));
      if (first && first.x0 < telopLine.x0 + (telopLine.x1 - telopLine.x0) * 0.25 && +nfkc(first.t) >= 1 && +nfkc(first.t) <= 18) out.umaban = String(+nfkc(first.t));
      // 馬名：テロップ行のカタカナ
      out.name = longestKatakana(telopLine.items.filter(i => !/kg/i.test(i.t)).map(i => i.t).join(""));
      if (!out.name) { const near = bottom.filter(l => l !== telopLine).map(l => longestKatakana(l.text)).find(Boolean); out.name = near || ""; }
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

  window.Paddock = { VENUES, parsePaddock, normName, matchHorse };
})();
