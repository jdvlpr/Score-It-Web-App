/* Prints the layout table for a spread of screens. The sizing math lives in app.js
   and is lifted out of it verbatim here, so this can never drift from what ships.
     node tools/check-sizes.mjs                                                    */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "app.js"), "utf8");
const block = src.split("/* --- pure sizing")[1]?.split("/* --- end pure sizing")[0];
if (!block) throw new Error("app.js: pure sizing block not found");
const { metrics } = new Function(block.slice(block.indexOf("*/") + 2) + "\nreturn { metrics };")();

// The real cost of a digit, so this checks the fit against the font rather than against
// the app's own assumption. SF Pro's tabular figures at weight 800 advance .6797em at
// text optical sizes (the widest they get), less the -.035em tracking on .score. Read
// straight out of /System/Library/Fonts/SFNS.ttf.
const REAL_EM = 0.6797 - 0.035;

// Seat split, mirroring render(): seats straddle the top, above the hub or below it.
const seatAngle = (i, n) => (n === 1 ? 90 : n === 2 ? (i === 0 ? -90 : 90) : -90 - 180 / n + (i * 360) / n);
function split(n) {
  let top = 0, bottom = 0, level = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.sin((seatAngle(i, n) * Math.PI) / 180);
    if (s < -1e-6) top++; else if (s > 1e-6) bottom++; else level++;
  }
  for (let i = 0; i < level; i++) (top <= bottom ? top++ : bottom++);
  return [top, bottom];
}

const SCREENS = [
  ["iPhone SE", 375, 667], ["iPhone 14 Pro", 393, 852], ["iPhone 16 Pro Max", 440, 956],
  ["iPhone 14 Pro sideways", 852, 393],
  ["iPad portrait", 820, 1180], ["iPad landscape", 1180, 820],
  ["MacBook", 1440, 900], ["Studio Display", 2560, 1440],
];
const COUNTS = Array.from({ length: 12 }, (_, i) => i + 1);
const CHARS = [1, 3, 5];   // "7", "343", "12500"

// app.js measures these off the live shell; offline this is the same budget on paper:
// the column minus its padding, the top bar and the three 6px gaps between the rows.
const flexOf = (vh) => vh - 40 - 18 - 14;
const PAD_X = 28;

let bad = 0;
for (const [label, vw, vh] of SCREENS) {
  console.log(`\n${label}  ${vw}x${vh}`);
  console.log("   n   app   label  rows  cols    colW   score 1/3/5   name   dial");
  for (const n of COUNTS) {
    const [t, b] = split(n);
    const flexH = flexOf(vh);
    const m = metrics(vw, vh, t, b, flexH, PAD_X, 3);
    const fits = CHARS.map((c) => metrics(vw, vh, t, b, flexH, PAD_X, c).scoreFit);
    const labelsH = m.rows * m.span;
    const problems = [];
    if (labelsH > flexH) problems.push("labels overflow");
    if (m.dial < 120) problems.push("dial tiny");   // a phone held sideways is a squeeze whatever we do
    if (m.span < 40) problems.push("label squashed");
    if (m.appW > vw) problems.push("wider than screen");
    if (Math.max(m.cols[0], m.cols[1]) * m.labelW > m.appW - PAD_X + 2) problems.push("labels wider than row");
    CHARS.forEach((c, i) => {
      if (c * REAL_EM * fits[i] > m.colW - 4) problems.push(`${c}-digit totals collide`);
      if (fits[i] < 20) problems.push(`${c}-digit totals unreadable`);
    });
    bad += problems.length;
    console.log(
      `  ${String(n).padStart(2)}  ${String(m.appW).padStart(4)}  ${String(m.span).padStart(4)}px` +
      `  ${String(m.rows).padStart(4)}  ${String(m.cols.join("+")).padStart(4)}` +
      `  ${String(Math.round(m.colW)).padStart(6)}  ${fits.map((f) => String(f).padStart(4)).join("/")}` +
      `  ${String(m.nameFs).padStart(5)}  ${String(m.dial).padStart(5)}` +
      (problems.length ? "   <-- " + [...new Set(problems)].join(", ") : "")
    );
  }
}
console.log(bad ? `\n${bad} problem(s).` : "\nNo problems.");
