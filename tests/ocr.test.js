// 読み取りルールの回帰テスト（実際の Vision の読み取り結果を使う）
// 実行：node tests/ocr.test.js
global.window = {};
require("../ocr.js");
const P = window.Paddock;
const fx = name => require("./fixtures/" + name);
let fail = 0;
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log((ok ? "ok   " : "NG   ") + label + (ok ? "" : `\n     期待: ${JSON.stringify(want)}\n     結果: ${JSON.stringify(got)}`)); };

// netkeiba PC版 結果ページ（2026年10月 京都10R 三年坂S）
const WANT_FIN = "1/4 2/7 3/11 4/1 5/8 6/3 7/15 8/17 9/12 10/16 11/9 12/13 13/2 14/5 15/14 16/10 17/6";
const WANT_LAP = "200m:12.2,400m:11.2,600m:11.6,800m:11.6,1000m:11.5,1200m:11.3,1400m:11.1,1600m:11.3";
for (const f of ["netkeiba-pc-result-1.json", "netkeiba-pc-result-2.json"]) {
  const r = P.parseResultImages(fx(f), "result");
  eq(f + " レース", [r.race.venue, r.race.raceNo, r.race.raceName, r.race.cls, r.race.surface, r.race.distance, r.race.going], ["京都", "10", "三年坂S", "3勝", "芝", "1600", "良"]);
  eq(f + " 日付の候補", r.race.dateOptions && r.race.dateOptions.includes("2026-10-11"), true);
  eq(f + " 着順/馬番", r.rows.map(x => x.finish + "/" + x.umaban).join(" "), WANT_FIN);
  eq(f + " 着差（1着・2着・17着）", [r.rows[0].diff, r.rows[1].diff, r.rows[16].diff], ["0.0", "0.1", "2.0"]);
  eq(f + " 性別", r.rows.every(x => x.sex), true);
  eq(f + " ラップ", r.race.lap, WANT_LAP);
  eq(f + " 出馬表として読んでも17頭", P.parseResultImages(fx(f), "card").rows.length, 17);
}
// 名寄せ：読み違い（トミーバローズ）を登録済みの馬の候補に出す
eq("名寄せ 長音の抜け・濁点", P.matchHorse("トミーバローズ", [{ id: 1, name: "トーミーパローズ" }]).candidates.length, 1);
eq("名寄せ 別の馬は候補にしない", P.matchHorse("アヴィオン", [{ id: 1, name: "トーミーパローズ" }]).candidates.length, 0);
// ラップの距離
eq("ラップ 1150m", P.normLap("6.9 10.7 11.2 11.5 11.8 12.4", 1150), "150m:6.9,350m:10.7,550m:11.2,750m:11.5,950m:11.8,1150m:12.4");

console.log(fail ? `\n${fail}件 失敗` : "\nすべて成功");
process.exit(fail ? 1 : 0);
