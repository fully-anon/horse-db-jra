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
// スマホで撮ったPC版（上端に端末の時計の日付、下にメモ欄がある）
{
  const f = "netkeiba-pc-result-3-iphone.json", r = P.parseResultImages(fx(f), "result");
  eq(f + " レース", [r.race.venue, r.race.raceNo, r.race.raceName, r.race.cls, r.race.surface, r.race.distance, r.race.going], ["京都", "10", "三年坂S", "3勝", "芝", "1600", "良"]);
  eq(f + " 端末の時計の日付（11/7）を候補に入れない", r.race.dateOptions, ["2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11", "2026-10-12"]);
  eq(f + " 日付タブの位置（10/11）", r.race.dateBoxes.find(b => b.date === "2026-10-11").x0, 471);
  eq(f + " 着順/馬番", r.rows.map(x => x.finish + "/" + x.umaban).join(" "), WANT_FIN);
  eq(f + " 15着ノクナレアの着差（タイムとくっついた「33.12」）", r.rows[14].margin, "2");
  eq(f + " ラップ", r.race.lap, WANT_LAP);
}
// 出馬表（レース前）：スマホで撮ったPC版。2行ぶんの数字が「45」「78」とまとめて読まれている
{
  const f = "netkeiba-pc-card-1-iphone.json", r = P.parseResultImages(fx(f), "card");
  eq(f + " レース", [r.race.date, r.race.venue, r.race.raceNo, r.race.raceName, r.race.cls, r.race.surface, r.race.distance], ["2026-10-11", "京都", "11", "太秦S", "OP", "ダート", "1800"]);
  eq(f + " 馬番と馬名", r.rows.map(x => x.umaban + ":" + x.name).join(" "),
    "1:モックモック 2:パシアンジャン 3:バスタードサフラン 4:ハナウマビーチ 5:タガノバビロン 6:ブルーサン 7:ヴィンセンシオ 8:シュラック 9:ベルウェザー 10:レアンダー 11:マリオロード 12:ペイシャモノノフ 13:メルカントゥール 14:ミッキークレスト");
  eq(f + " 着順は入らない", r.rows.every(x => !x.finish), true);
}
// 出馬表 2件目：3行ぶんの馬番が「567」と1つにまとめて読まれている（18頭）
{
  const f = "netkeiba-pc-card-2-iphone.json", r = P.parseResultImages(fx(f), "card");
  eq(f + " レース", [r.race.date, r.race.venue, r.race.raceNo, r.race.raceName, r.race.cls, r.race.surface, r.race.distance], ["2026-11-08", "京都", "12", "3歳以上1勝クラス", "1勝", "芝", "1400"]);
  eq(f + " 馬番と馬名", r.rows.map(x => x.umaban + ":" + x.name).join(" "),
    "1:コスモレッド 2:モルティフレーバー 3:メイショウハッケイ 4:エグジスタンス 5:キシャール 6:ブルズアイプリンス 7:アラビアンジョイ 8:ダノンブランニュー 9:ナクソス 10:ニシノトリビュート 11:サリュエ 12:ジャンヌローサ 13:タイガーロード 14:スウィッチインラヴ 15:クールフラン 16:メイクワンズデイ 17:スマッシング 18:フロンティエール");
  eq(f + " 性別", r.rows.map(x => x.sex).join(""), "牝牝牝牡牝牡牝牡セン牡牡牝牡牝牝牡牝牡");
}
// 出馬表 3件目（2件目と同じレース）：右端の「+」ボタン3行ぶんが「++++」と1つに読まれ、13・14番が抜けていた
{
  const f = "netkeiba-pc-card-3-iphone.json", r = P.parseResultImages(fx(f), "card");
  eq(f + " 18頭・馬番1〜18", r.rows.map(x => x.umaban).join(","), Array.from({ length: 18 }, (_, i) => i + 1).join(","));
  eq(f + " 13・14番", r.rows.filter(x => +x.umaban === 13 || +x.umaban === 14).map(x => x.name), ["タイガーロード", "スウィッチインラヴ"]);
}
// 結果 4件目：「タイムレスキス」を見出しの「タイム」と間違えていた／2着の「2」が読めていない
{
  const f = "netkeiba-pc-result-4-iphone.json", r = P.parseResultImages(fx(f), "result");
  eq(f + " レース", [r.race.venue, r.race.raceNo, r.race.raceName, r.race.cls, r.race.surface, r.race.distance, r.race.going], ["京都", "12", "3歳以上1勝クラス", "1勝", "芝", "1600", "良"]);
  eq(f + " 着順/馬番/馬名", r.rows.map(x => x.finish + "/" + x.umaban + "/" + x.name).join(" "),
    "1/3/ダークマルス 2/1/メイショウトウコウ 3/4/ペイシャシス 4/5/サトノセプター 5/8/エグジスタンス 6/13/ドーギッド 7/2/タイムレスキス 8/12/レインボーステート 9/7/ウォーターデライト 10/6/ルートサーティーン 11/10/ルディシャ 12/9/ミッキーコンドル 13/16/ウインラウダ 14/14/エスティヴァリス 15/15/ニシノイツキムスメ 16/11/マゲバスピード");
  eq(f + " 2着は推定", r.rows[1].finishGuessed, true);
  eq(f + " ラップ", r.race.lap, "200m:12.0,400m:10.5,600m:11.0,800m:11.8,1000m:11.9,1200m:11.9,1400m:11.6,1600m:11.6");
}
// 名寄せ：読み違い（トミーバローズ）を登録済みの馬の候補に出す
eq("名寄せ 長音の抜け・濁点", P.matchHorse("トミーバローズ", [{ id: 1, name: "トーミーパローズ" }]).candidates.length, 1);
eq("名寄せ 別の馬は候補にしない", P.matchHorse("アヴィオン", [{ id: 1, name: "トーミーパローズ" }]).candidates.length, 0);
// ラップの距離
eq("ラップ 1150m", P.normLap("6.9 10.7 11.2 11.5 11.8 12.4", 1150), "150m:6.9,350m:10.7,550m:11.2,750m:11.5,950m:11.8,1150m:12.4");

console.log(fail ? `\n${fail}件 失敗` : "\nすべて成功");
// 結果5件目：4着の「4」に「st」が重なって読まれた／2着同着（2頭）の次は4着／8着が「80」
{
  const f = "netkeiba-pc-result-5-iphone.json", r = P.parseResultImages(fx(f), "result");
  eq(f + " レース", [r.race.venue, r.race.raceNo, r.race.cls, r.race.surface, r.race.distance, r.race.going], ["京都", "12", "1勝", "芝", "1400", "良"]);
  eq(f + " 着順/馬番", r.rows.map(x => x.finish + "/" + x.umaban).join(" "), "1/5 2/7 2/10 4/12 5/13 6/1 7/4 8/6 9/16 10/2 11/3 12/18 13/11 14/9 15/15 16/14 17/8 18/17");
  eq(f + " 同着", r.rows[2].margin, "同着");
}
process.exit(fail ? 1 : 0);
