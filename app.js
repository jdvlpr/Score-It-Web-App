/* Score It — swipe the ring to score. No dependencies, no build. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const KEY = "score-it.v1";
  const R = 38;                       // ring radius in viewBox units
  const C = 2 * Math.PI * R;          // ring circumference
  const MAX_PLAYERS = 12;
  const MAX_LOG = 250;
  const STEPS = [1, 5, 10, 25, 50];   // points added per stop on the ring

  const PALETTE = [
    "#ff3b30", "#0a3cff", "#ffe814", "#35e63a", "#45e6ff", "#ff3fdd",
    "#e05a4e", "#4aa3e8", "#f0b429", "#6fbf5e", "#ef8b3c", "#8d5fb0",
    "#e8407a", "#2f6fdb", "#e8d24a", "#4fc9a0", "#ef5b32", "#6a5ae0",
    "#ef9aa0", "#3fa8a0", "#a06a30", "#8e8e93", "#ffffff",
  ];  // 23 presets + the custom chip = a clean 4x6 grid
  const PICK_ORDER = [0, 3, 2, 1, 5, 4, 16, 11, 13, 9, 12, 19];

  const CROWN = '<svg viewBox="0 0 24 18" aria-hidden="true">' +
      '<path d="M2.9 13.2 1.4 2.4 7.3 8.2 12 0.8 16.7 8.2 22.6 2.4 21.1 13.2Z"/>' +
      '<rect x="2.2" y="13.3" width="19.6" height="3.4" rx="1.6"/>' +
      '<rect x="2.2" y="13.3" width="19.6" height="3.4" fill="#e5983e"/>' +
      '</svg>';

  /* ---------------- state ---------------- */

  const fresh = () => ({
    players: [newPlayer("Player 1", 0), newPlayer("Player 2", 1), newPlayer("Player 3", 2), newPlayer("Player 4", 3)],
    log: [],
    cursor: 0,
    settings: { steps: 12, step: 1, haptics: true, sound: true },
  });

  let uid = Date.now();   // not modulo anything: a wrapping counter re-issues ids across sessions
  function newPlayer(name, seat) {
    return { id: "p" + (uid++).toString(36), name, color: PALETTE[PICK_ORDER[seat % 12]], score: 0, rot: 0 };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw || !Array.isArray(raw.players) || !raw.players.length) return fresh();
      raw.players = raw.players.slice(0, MAX_PLAYERS).map((p, i) => ({
        id: String(p.id ?? "p" + i),
        name: String(p.name ?? ""),
        color: /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : PALETTE[i % PALETTE.length],
        score: Number.isFinite(+p.score) ? +p.score : 0,
        rot: [0, 90, 180, 270].includes(+p.rot) ? +p.rot : 0,
      }));
      raw.log = Array.isArray(raw.log) ? raw.log.filter((e) => e && Number.isFinite(+e.delta)) : [];
      raw.cursor = Math.max(0, Math.min(raw.log.length, +raw.cursor || 0));
      const st = Object.assign({ steps: 12, step: 1, haptics: true, sound: false }, raw.settings || {});
      // Numbers, not strings: syncStep compares with === and steps is a divisor.
      st.step = STEPS.includes(+st.step) ? +st.step : 1;
      st.steps = +st.steps >= 6 && +st.steps <= 24 ? Math.round(+st.steps / 2) * 2 : 12;
      st.haptics = !!st.haptics;
      st.sound = !!st.sound;
      raw.settings = st;
      return raw;
    } catch (_) {
      return fresh();
    }
  }

  const state = load();
  let saveTimer = 0;
  function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 160);
    syncBrand();   // every change to the log passes through here, and that is all the wordmark watches
  }
  // Phones kill backgrounded tabs without warning — never leave a score in the debounce.
  addEventListener("pagehide", writeNow);
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") writeNow(); });

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const byId = (id) => state.players.find((p) => p.id === id);
  const displayName = (p, i) => p.name.trim() || "Player " + (i + 1);
  const labelAria = (p, i, crowned) =>
    `${displayName(p, i)}: ${p.score}.${crowned ? " Leading." : ""} Tap to rotate.`;

  function commit(id, delta) {
    const p = byId(id);
    if (!p || !delta) return;
    state.log.length = state.cursor;              // a new move drops the redo tail
    state.log.push({ playerId: id, delta, at: Date.now() });
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
    state.cursor = state.log.length;
    p.score += delta;
    save();
  }

  function undo() {
    if (!state.cursor) return false;
    const e = state.log[--state.cursor];
    const p = byId(e.playerId);
    if (p) p.score -= e.delta;
    save();
    return true;
  }

  function redo() {
    if (state.cursor >= state.log.length) return false;
    const e = state.log[state.cursor++];
    const p = byId(e.playerId);
    if (p) p.score += e.delta;
    save();
    return true;
  }

  /* ---------------- geometry ---------------- */

  // Seats run clockwise, straddling the top so nobody sits under the notch.
  function seatAngle(i, n) {
    if (n === 1) return 90;
    if (n === 2) return i === 0 ? -90 : 90;
    return -90 - 180 / n + (i * 360) / n;
  }

  /* ---------------- rendering ---------------- */

  const app = $(".app"), dial = $("#dial"), barEl = $(".topbar"),
        dotsEl = $("#dots"), trailEl = $("#trail"),
        topEl = $("#labels-top"), botEl = $("#labels-bottom");

  const labelEls = new Map();
  const dotEls = new Map();

  /* --- pure sizing: tools/check-sizes.mjs evaluates this block on its own --- */

  // [label height, score size, name size] at scale 1, by player count.
  function baseSize(n) {
    return n <= 2 ? [150, 88, 17] : n <= 4 ? [128, 78, 16]
         : n <= 6 ? [112, 71, 15] : n <= 8 ? [98, 65, 14] : [88, 60, 13];
  }

  // Columns for one row of labels. A group gets a single clean row whenever the
  // width is there: on a wide screen that is what turns label rows back into dial
  // height, which is the axis that is actually scarce.
  function colsFor(len, rowW, cellW) {
    if (len <= 0) return 1;
    if (len <= 3) return len;
    const fit = Math.max(1, Math.floor(rowW / (cellW + 4)));
    if (len <= fit) return len;
    if (len === 4) return 2;   // 2x2 reads better than 3 + 1
    return Math.min(3, fit);
  }

  // Totals are tabular, so the widest one on the board sets the size for everybody —
  // a scoreboard whose numbers are different sizes reads as broken.
  //
  // 0.65em is what one of those digits costs. Measured out of SFNS.ttf rather than
  // guessed: a tabular figure at weight 800 advances .661em at display optical sizes
  // and .680em at text ones, and the -.035em tracking on .score comes back off. The
  // text end is the wide end, so that is the one to budget for. A minus sign is
  // narrower than a digit, so counting it as one is on the safe side. The 10px is the
  // gap left between two columns of numbers.
  const DIGIT_EM = 0.65;
  function fitScore(fs, colW, chars) {
    return Math.max(12, Math.min(fs, Math.floor((colW - 10) / (Math.max(1, chars) * DIGIT_EM))));
  }

  // Everything the layout needs, from the viewport and the two label groups.
  // flexH is the height the label rows and the dial share between them.
  // padX is the column's own left + right padding, safe-area insets included; chars is
  // the length of the longest total on the board.
  function metrics(vw, vh, nTop, nBot, flexH, padX, chars) {
    const n = nTop + nBot;
    // The dial is a square in a height-bound column, so the column's width follows
    // the height it has to fill rather than the width of the screen it sits on.
    // Past 920px a bigger donut stops being easier to swipe and starts being a walk.
    const appW = Math.min(vw, Math.max(560, Math.min(920, Math.round(vh * 0.82))));
    const rowW = Math.max(200, appW - padX);
    const base = baseSize(n);
    // Type is measured against a 360x780 phone and grows with the smaller axis, so a
    // tall narrow window never gets numbers too wide for it.
    const k = Math.max(0.72, Math.min(1.45, Math.min(vh / 780, vw / 360)));
    const labelW = Math.round(base[0] * k);
    const cols = [colsFor(nTop, rowW, labelW), colsFor(nBot, rowW, labelW)];
    const rows = Math.ceil(nTop / cols[0]) + Math.ceil(nBot / cols[1]);
    // Labels never take much more than half the column — the dial is the point. Only
    // the height is capped: label-inner keeps its full width, so a short window shrinks
    // the digits instead of clipping the names. 0.56 is where the guard starts to bite
    // on a small phone at eight players, which is the layout it was set against.
    const span = rows ? Math.min(labelW, Math.floor((flexH * 0.56) / rows)) : labelW;
    const kEff = span / base[0];
    // The height above says how big a total may be; the column says how big it can be.
    const colW = rowW / Math.max(cols[0], cols[1]);
    const scoreFs = Math.round(base[1] * kEff);
    return {
      appW, cols, rows, span, labelW, colW, scoreFs,
      scoreFit: fitScore(scoreFs, colW, chars),
      nameFs: Math.round(base[2] * kEff),
      dial: Math.max(0, Math.min(rowW, flexH - rows * span)),
    };
  }

  /* --- end pure sizing --- */

  // The longest total currently on the board, in characters — a leading minus counts.
  function scoreChars() {
    let c = 1;
    for (const p of state.players) c = Math.max(c, String(p.score).length);
    return c;
  }

  // A total gaining a digit has to make room for itself or the columns run together.
  // Only the type is touched: rebuilding the labels here would swallow the score's pop.
  let fit = null;
  function fitType() {
    const chars = scoreChars();
    if (!fit || chars === fit.chars) return;
    fit.chars = chars;
    document.documentElement.style.setProperty("--score-fs", fitScore(fit.fs, fit.colW, chars) + "px");
  }

  // What the shell leaves for everything else. The height is derived from the shell
  // rather than measured off the labels, so it doesn't move when the labels resize;
  // the padding is read rather than assumed, because the safe-area insets are in it.
  function shell() {
    const cs = getComputedStyle(app);
    const gap = parseFloat(cs.rowGap) || 0;   // four children, so three gaps
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return {
      flexH: Math.max(160, app.clientHeight - padY - barEl.offsetHeight - gap * 3),
      padX: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
    };
  }


  function render() {
    settle();                      // never rebuild the dots out from under a live gesture
    const box = shell();           // read before anything below writes a size back
    const n = state.players.length;
    const seats = state.players.map((p, i) => ({ p, i, a: seatAngle(i, n) }));

    // Split the seats into the row above the dial and the row below, by where they sit.
    const sin = (s) => Math.sin((s.a * Math.PI) / 180);
    const cos = (s) => Math.cos((s.a * Math.PI) / 180);
    const top = [], bottom = [], level = [];
    for (const s of seats) (sin(s) < -1e-6 ? top : sin(s) > 1e-6 ? bottom : level).push(s);
    // Seats exactly level with the hub belong to neither row — deal them out to keep the rows even.
    level.sort((a, b) => cos(b) - cos(a));
    for (const s of level) (top.length <= bottom.length ? top : bottom).push(s);
    const leftToRight = (a, b) => cos(a) - cos(b);
    top.sort(leftToRight);
    bottom.sort(leftToRight);

    // Sizing: dots shrink to fit the ring; the column, the labels and the type all
    // grow with the screen, so a tablet or a desktop gets a bigger board, not a
    // phone-sized one parked in the middle of it.
    const dotPct = Math.max(6.5, Math.min(16, (C / n) * 0.74));
    const chars = scoreChars();
    const m = metrics(window.innerWidth, window.innerHeight, top.length, bottom.length, box.flexH, box.padX, chars);
    fit = { fs: m.scoreFs, colW: m.colW, chars };
    const root = document.documentElement.style;
    root.setProperty("--dot-pct", dotPct.toFixed(2));
    root.setProperty("--app-w", m.appW + "px");
    root.setProperty("--label-span", m.span + "px");
    root.setProperty("--label-w", m.labelW + "px");
    root.setProperty("--score-fs", m.scoreFit + "px");
    root.setProperty("--name-fs", m.nameFs + "px");

    dotsEl.textContent = "";
    dotEls.clear();
    labelEls.clear();
    topEl.textContent = "";
    botEl.textContent = "";

    for (const s of seats) {
      const rad = (s.a * Math.PI) / 180;
      const b = document.createElement("button");
      b.className = "dot";
      b.dataset.id = s.p.id;
      b.style.cssText = `--c:${s.p.color};left:${(50 + R * Math.cos(rad)).toFixed(3)}%;top:${(50 + R * Math.sin(rad)).toFixed(3)}%`;
      b.setAttribute("aria-label", `Score for ${displayName(s.p, s.i)}`);
      b.innerHTML = '<span class="dot-fill"></span>';
      dotsEl.appendChild(b);
      dotEls.set(s.p.id, b);
    }

    fillLabels(topEl, top, m.cols[0]);
    fillLabels(botEl, bottom, m.cols[1]);
    updateCrowns();
    clearTrail();
  }

  function fillLabels(host, group, cols) {
    for (const s of group) {
      const el = document.createElement("button");
      el.className = "label";
      el.dataset.id = s.p.id;
      el.style.setProperty("--col", (100 / cols).toFixed(3) + "%");
      el.style.color = s.p.color;
      el.setAttribute("aria-label", labelAria(s.p, s.i, false));   // updateCrowns has the last word
      const inner = document.createElement("span");
      inner.className = "label-inner";
      inner.style.transform = `rotate(${s.p.rot}deg)`;
      const crown = document.createElement("span");
      crown.className = "crown";
      crown.setAttribute("aria-hidden", "true");
      crown.innerHTML = CROWN;
      const nm = document.createElement("span");
      nm.className = "name";
      nm.textContent = displayName(s.p, s.i);
      const sc = document.createElement("span");
      sc.className = "score";
      sc.textContent = s.p.score;
      // The live swipe value rides above the running total, which shrinks out of its way.
      const dl = document.createElement("span");
      dl.className = "delta";
      dl.setAttribute("aria-live", "polite");
      const stack = document.createElement("span");
      stack.className = "score-stack";
      stack.append(sc, dl);
      inner.append(crown, nm, stack);
      el.appendChild(inner);
      host.appendChild(el);
      labelEls.set(s.p.id, { el, score: sc, delta: dl, inner });
    }
  }

  function setScoreText(id, text) {
    const l = labelEls.get(id);
    if (l) l.score.textContent = text;
  }

  function setDeltaText(id, text) {
    const l = labelEls.get(id);
    if (l) l.delta.textContent = text;
  }

  // Nobody is "in first" until somebody is actually ahead: a board where every score is
  // still level — two fresh players on 0, say — wears no crowns at all. A tie for the
  // lead over anyone else crowns all of the tied players.
  function leaders() {
    const out = new Set();
    if (state.players.length < 2) return out;
    let hi = -Infinity, lo = Infinity;
    for (const p of state.players) {
      if (p.score > hi) hi = p.score;
      if (p.score < lo) lo = p.score;
    }
    if (hi === lo) return out;
    for (const p of state.players) if (p.score === hi) out.add(p.id);
    return out;
  }

  function updateCrowns() {
    const lead = leaders();
    state.players.forEach((p, i) => {
      const l = labelEls.get(p.id);
      if (!l) return;
      const on = lead.has(p.id);
      l.el.classList.toggle("is-crowned", on);
      l.el.setAttribute("aria-label", labelAria(p, i, on));
    });
  }

  // Scores changed but the board did not: reuse the labels rather than rebuilding them,
  // so the crown can transition between players instead of snapping.
  function refreshScores() {
    fitType();
    state.players.forEach((p) => setScoreText(p.id, p.score));
    updateCrowns();
  }

  function clearTrail() { trailEl.style.background = "none"; }

  // The trail runs back from the dot toward the player's seat. A conic gradient is the
  // only thing that can fade *along* an arc; the mask makes it a band. Past a full lap
  // it simply stays a closed ring rather than starting the sweep over.
  function drawTrail(seat, off) {
    const mag = Math.abs(off);
    if (mag < 0.2) return clearTrail();
    anim.strongPercent = Math.min(35 + mag/8, 100);
    anim.faintPercent = Math.min(0 + mag / 360, 50);
    const m = Math.min(mag, 360);
    const cw = off >= 0;
    const from = (cw ? seat + off - m : seat + off) + 90;   // CSS conic 0deg is twelve o'clock
    const end = m.toFixed(2);
    const stops = cw
      ? `${anim.faint} 0deg, ${anim.strong} ${end}deg, transparent ${end}deg`
      : `${anim.strong} 0deg, ${anim.faint} ${end}deg, transparent ${end}deg`;
    trailEl.style.background = `conic-gradient(in oklch from ${from.toFixed(2)}deg, ${stops})`;
  }

  // Only the active dot ever leaves its seat, and only by a transform — the seat
  // percentages that the whole 1-12 layout rests on are never touched.
  function placeDot(id, seat, off, rr) {
    const el = dotEls.get(id);
    if (!el) return;
    const a = ((seat + off) * Math.PI) / 180, s = (seat * Math.PI) / 180;
    const dx = rr * (Math.cos(a) - Math.cos(s)), dy = rr * (Math.sin(a) - Math.sin(s));
    el.style.transform = `translate(-50%, -50%) translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
  }

  const fmt = (d) => (d > 0 ? "+" + d : String(d));

  /* ---------------- the swipe dial ---------------- */

  let drag = null;      // the gesture: what the finger is doing
  let anim = null;      // the picture: where the dot actually is on screen
  let rafId = 0;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const HUB = 0.2;      // inside this fraction of the dial, the dial stops amplifying
  const SLACK = 1.06;   // headroom so a normal arc on the track is never clipped

  // Accumulate the angle the finger has swept, walking the segment in small steps and
  // capping each one at what its travel could plausibly sweep at that radius. Far out
  // the cap never bites and this is exactly the shortest-arc difference; near the hub
  // it keeps a millimetre of wobble from spinning the dial, so the finger can cross the
  // middle, or leave the dial entirely, and the dot just keeps going.
  function advance(d, x1, y1) {
    const dist = Math.hypot(x1 - d.lx, y1 - d.ly);
    const n = Math.min(48, Math.max(1, Math.ceil(dist / 4)));
    const floor = d.rad * HUB;
    let px = d.lx, py = d.ly, a0 = Math.atan2(py, px);
    for (let i = 1; i <= n; i++) {
      const qx = d.lx + (x1 - d.lx) * (i / n), qy = d.ly + (y1 - d.ly) * (i / n);
      const a1 = Math.atan2(qy, qx);
      let da = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const cap = (SLACK * Math.hypot(qx - px, qy - py)) / Math.max(Math.hypot(qx, qy), floor);
      if (da > cap) da = cap; else if (da < -cap) da = -cap;
      d.acc += (da * 180) / Math.PI;
      a0 = a1; px = qx; py = qy;
    }
    d.lx = x1; d.ly = y1;
  }

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Only the rewind is animated. While the finger is down the dot is written straight
  // to the finger's angle, so it can never lag behind it.
  function loop(t) {
    rafId = 0;
    if (!anim || !anim.rw) return;
    const k = Math.min(1, (t - anim.rw.t0) / anim.rw.dur);
    anim.shown = anim.rw.from * (1 - easeInOut(k));
    paint();
    if (k >= 1) return settle();
    rafId = requestAnimationFrame(loop);
  }

  function paint() {
    placeDot(anim.id, anim.seat, anim.shown, anim.rr);
    drawTrail(anim.seat, anim.shown);
  }

  // Land the dot back in its seat and give the ring back to everybody. This also drops the
  // gesture: render() settles mid-swipe, and a live drag with no anim behind it would throw.
  function settle() {
    drag = null;
    if (!anim) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    clearTimeout(anim.rw && anim.rw.guard);
    const el = dotEls.get(anim.id);
    if (el) { el.style.transform = ""; el.classList.remove("is-active"); }
    labelEls.get(anim.id)?.el.classList.remove("is-active");
    clearTrail();
    dial.classList.remove("is-dragging");
    app.classList.remove("is-dragging");
    anim = null;
  }

  dial.addEventListener("pointerdown", (e) => {
    const dot = e.target.closest(".dot");
    if (!dot || drag) return;
    const p = byId(dot.dataset.id);
    if (!p) return;
    unlockAudio();
    e.preventDefault();
    settle();                                  // a rewind still in flight lands now
    try { dial.setPointerCapture(e.pointerId); } catch (_) {}
    const r = dial.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const seat = seatAngle(state.players.indexOf(p), state.players.length);
    drag = {
      pid: e.pointerId, id: p.id, seat, acc: 0, pending: 0, moved: false,
      x: e.clientX, y: e.clientY,
      lx: e.clientX - cx, ly: e.clientY - cy, rad: r.width / 2,
    };
    anim = {
      id: p.id, seat, shown: 0, rw: null, rr: r.width * (R / 100),
      strongPercent: 35,
      get strong() {
          return `color-mix(in srgb, ${p.color} ${this.strongPercent}%, transparent)`;
      },
      faintPercent: 0,
      get faint() {
          return `color-mix(in srgb, ${p.color} ${this.faintPercent}%, transparent)`;
      },
    };
    dial.classList.add("is-dragging");
    app.classList.add("is-dragging");   // every other player's score steps back
    dot.classList.add("is-active");
    labelEls.get(p.id)?.el.classList.add("is-active");
    labelEls.get(p.id)?.score.classList.remove("pop");   // a spent pop would keep its own transform-origin
    setDeltaText(p.id, fmt(0));
    setScoreText(p.id, p.score);   // the total keeps previewing the result, under the delta
    clearTrail();
  });

  // move/up live on window, not the dial: with pointer capture the events still bubble here,
  // and without it (capture can fail) they arrive from wherever the finger actually is.
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) drag.moved = true;
    const r = dial.getBoundingClientRect();
    drag.rad = r.width / 2;   // the window can be resized mid-drag on a desktop
    anim.rr = r.width * (R / 100);
    advance(drag, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    anim.shown = drag.acc;
    paint();
    const next = Math.round(drag.acc / (360 / state.settings.steps));
    if (next === drag.pending) return;
    drag.pending = next;
    const p = byId(drag.id);
    setDeltaText(drag.id, fmt(next * state.settings.step));
    setScoreText(drag.id, p.score + next * state.settings.step);
    feedback();
  }, { passive: false });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    const delta = (d.moved ? d.pending : 0) * state.settings.step;   // a tap with no swipe is no steps
    if (delta) {
      commit(d.id, delta);
      feedback(true);
    }
    const p = byId(d.id);
    const l = labelEls.get(d.id);
    fitType();   // the swipe may have pushed this total into another digit
    setScoreText(d.id, p ? p.score : 0);
    // The label hands the number back at release, not when the dot finishes winding home.
    l?.el.classList.remove("is-active");
    app.classList.remove("is-dragging");
    updateCrowns();   // batched with the line above, so the crown animates out of the drag state
    l?.score.classList.remove("pop");
    void l?.score.offsetWidth;
    if (delta) l?.score.classList.add("pop");
    // The score is already banked; the dot just winds itself home. Everyone else stays
    // faded until it lands, so it never flies through a dot that is fading back in.
    if (anim && !reduced.matches && Math.abs(anim.shown) > 0.5) {
      const dur = Math.min(560, 240 + (Math.abs(anim.shown) / 360) * 220);
      const rw = anim.rw = { from: anim.shown, t0: performance.now(), dur, guard: 0 };
      // A frame callback that never arrives (hidden tab) must not strand the dot.
      rw.guard = setTimeout(() => { if (anim && anim.rw === rw) settle(); }, dur + 400);
      rafId = requestAnimationFrame(loop);
    } else {
      settle();
    }
    if (sheetOpen === "history") renderHistory();
  };
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);

  // Keyboard: a dot is a real button, so Enter/Space should score +1 too.
  dotsEl.addEventListener("click", (e) => {
    if (e.detail !== 0) return;                 // detail 0 == not a pointer click
    const dot = e.target.closest(".dot");
    if (!dot) return;
    commit(dot.dataset.id, state.settings.step);
    refreshScores();
    if (sheetOpen === "history") renderHistory();
  });

  /* haptics + tick */
  let actx = null;
  let audioReady = null;

  function unlockAudio() {
    if (!state.settings.sound) return;

    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (actx.state === "running") {
        audioReady = Promise.resolve();
      } else {
        audioReady = actx.resume();
      }
    } catch (_) {
      audioReady = null;
    }
  }

  const buzz = (ms) => { if (state.settings.haptics && navigator.vibrate) navigator.vibrate(ms); };

  function feedback(strong) {
    buzz(strong ? 16 : 7);
    if (!state.settings.sound || !actx) return;

    const play = () => {
      try {
        if (actx.state !== "running") return;

        const t = actx.currentTime;
        const o = actx.createOscillator();
        const g = actx.createGain();

        o.type = "sine";
        o.frequency.value = strong ? 440 : 680;

        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(
          strong ? 0.16 : 0.09,
          t + 0.006
        );
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + 0.09);
      } catch (_) {}
    };

    if (actx.state === "running") {
      play();
    } else if (audioReady) {
      audioReady.then(play).catch(() => {});
    }
  }

  /* tap a name to rotate it toward whoever is sitting there */
  const rotate = (e) => {
    const el = e.target.closest(".label");
    if (!el) return;
    const p = byId(el.dataset.id);
    if (!p) return;
    p.rot = (p.rot + 90) % 360;
    labelEls.get(p.id).inner.style.transform = `rotate(${p.rot}deg)`;
    buzz(7);
    save();
  };
  topEl.addEventListener("click", rotate);
  botEl.addEventListener("click", rotate);

  /* ---------------- sheets ---------------- */

  const scrim = $("#scrim");
  const sheets = { players: $("#sheet-players"), history: $("#sheet-history") };
  let sheetOpen = null;

  function openSheet(which) {
    if (sheetOpen) closeSheet();
    sheetOpen = which;
    which === "players" ? renderPlayers() : renderHistory();
    const s = sheets[which];
    scrim.hidden = false;
    s.hidden = false;
    s.style.removeProperty("--drag-y");   // a sheet closed mid-drag leaves this behind
    void s.offsetWidth;            // flush styles synchronously so the slide-in has a start value
    scrim.classList.add("open");
    s.classList.add("open");
  }

  function closeSheet() {
    closePicker();
    const s = sheets[sheetOpen];
    sheetOpen = null;
    scrim.classList.remove("open");
    if (!s) return;
    s.classList.remove("open");
    setTimeout(() => {
      if (sheets[sheetOpen] === s) return;      // reopened while it was still sliding out
      s.hidden = true;
      if (!sheetOpen) scrim.hidden = true;      // ...but the scrim stays if another sheet took over
    }, 420);
  }

  $("#open-players").onclick = () => openSheet("players");
  $("#open-history").onclick = () => openSheet("history");
  scrim.onclick = closeSheet;
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheet));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePicker(); closeSheet(); } });

  // Swipe-down-to-dismiss, like a native sheet. Always draggable from the grab handle
  // and header; draggable from the body too, but only once it's scrolled to the top —
  // otherwise the gesture is just a normal scroll.
  function initSheetDrag(s) {
    const body = s.querySelector(".sheet-body");
    let pid = null, tracking = false, dragging = false, startX = 0, startY = 0, dy = 0;

    s.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("button, input")) return;   // don't steal the slider, switches, Done, etc.
      pid = e.pointerId;
      tracking = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      dy = 0;
    });

    s.addEventListener("pointermove", (e) => {
      if (!tracking || e.pointerId !== pid) return;
      const curDx = e.clientX - startX;
      const curDy = e.clientY - startY;

      if (!dragging) {
        if (Math.abs(curDy) < 6 || Math.abs(curDx) > Math.abs(curDy)) return;
        if (curDy < 0) { tracking = false; return; }   // swiping up isn't our gesture
        const fromHandle = e.target.closest(".sheet-grab, .sheet-head");
        if (!fromHandle && body && body.scrollTop > 0) { tracking = false; return; }   // let it scroll
        dragging = true;
        s.classList.add("dragging");
        try { s.setPointerCapture(pid); } catch (_) {}
      }

      dy = curDy < 0 ? curDy / 3 : curDy;   // a little resistance past fully open
      s.style.setProperty("--drag-y", `${dy}px`);
      e.preventDefault();
    }, { passive: false });

    const endDrag = (e) => {
      if (!tracking || e.pointerId !== pid) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      s.classList.remove("dragging");
      if (dy > Math.min(120, s.offsetHeight * 0.3)) {
        closeSheet();
      } else {
        s.style.setProperty("--drag-y", "0px");
      }
    };
    s.addEventListener("pointerup", endDrag);
    s.addEventListener("pointercancel", endDrag);
  }
  initSheetDrag(sheets.players);
  initSheetDrag(sheets.history);

  /* players sheet */
  const rowsEl = $("#player-rows");

  function renderPlayers() {
    rowsEl.textContent = "";
    state.players.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        `<button class="swatch" style="--c:${p.color}" aria-label="Color for ${escapeHtml(displayName(p, i))}"></button>` +
        `<input class="name-input" maxlength="14" style="--c:${p.color}" value="${escapeHtml(p.name)}" placeholder="Player ${i + 1}">` +
        `<span class="tally">${p.score}</span>` +
        (state.players.length > 1
          ? `<button class="del" aria-label="Remove ${escapeHtml(displayName(p, i))}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`
          : "");
      row.querySelector(".swatch").onclick = (e) => openPicker(e.currentTarget, p);
      const input = row.querySelector(".name-input");
      input.oninput = () => { p.name = input.value; save(); render(); };
      const del = row.querySelector(".del");
      if (del) del.onclick = () => {
        state.players = state.players.filter((x) => x.id !== p.id);
        // Dropping this player's moves shifts the undo cursor by however many sat before it.
        const before = state.log.slice(0, state.cursor).filter((e) => e.playerId === p.id).length;
        state.log = state.log.filter((e) => e.playerId !== p.id);
        state.cursor = Math.max(0, state.cursor - before);
        save(); render(); renderPlayers();
      };
      rowsEl.appendChild(row);
    });
    $("#add-player").disabled = state.players.length >= MAX_PLAYERS;
  }

  $("#add-player").onclick = () => {
    if (state.players.length >= MAX_PLAYERS) return;
    const used = new Set(state.players.map((p) => p.color.toLowerCase()));
    const free = PICK_ORDER.map((i) => PALETTE[i]).find((c) => !used.has(c.toLowerCase()));
    const p = newPlayer("", state.players.length);
    p.color = free || PALETTE[state.players.length % PALETTE.length];
    state.players.push(p);
    save(); render(); renderPlayers();
  };

  $("#reset-scores").onclick = () => {
    state.players.forEach((p) => (p.score = 0));
    state.log = [];
    state.cursor = 0;
    save(); refreshScores(); renderPlayers();
  };

  const optH = $("#opt-haptics"), optS = $("#opt-sound"), optSteps = $("#opt-steps"), optStepsVal = $("#opt-steps-val");
  optH.checked = state.settings.haptics;
  optS.checked = state.settings.sound;
  optSteps.value = state.settings.steps;
  const stepsLabel = () => (optStepsVal.textContent = state.settings.steps + " stops");
  stepsLabel();
  optH.onchange = () => { state.settings.haptics = optH.checked; save(); };
  optS.onchange = () => {
    state.settings.sound = optS.checked;
    if (optS.checked) {
      unlockAudio();
      feedback();
    }
    save();
  };
  optSteps.oninput = () => { state.settings.steps = +optSteps.value; stepsLabel(); save(); };

  const stepSeg = $("#opt-step");
  const syncStep = () => stepSeg.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("on", +b.dataset.v === state.settings.step));
  stepSeg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    state.settings.step = +b.dataset.v;
    syncStep();
    feedback();
    save();
  }));
  syncStep();

  /* history sheet */
  const logEl = $("#log"), standEl = $("#standings");

  function renderHistory() {
    standEl.textContent = "";
    const ranked = state.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    for (const { p, i } of ranked) {
      const s = document.createElement("div");
      s.className = "s";
      s.style.color = p.color;
      s.innerHTML = `<b>${escapeHtml(displayName(p, i))}</b><i>${p.score}</i>`;
      standEl.appendChild(s);
    }
    logEl.textContent = "";
    if (!state.log.length) {
      logEl.innerHTML = '<div class="empty">No moves yet.</div>';
    } else {
      for (let idx = state.log.length - 1; idx >= 0; idx--) {   // newest first
        const e = state.log[idx];
        const p = byId(e.playerId);
        const i = state.players.indexOf(p);
        const row = document.createElement("div");
        row.className = "entry" + (idx >= state.cursor ? " undone" : "");
        row.style.color = p ? p.color : "#8b8b92";
        row.innerHTML = `<span class="bead" style="--c:${p ? p.color : "#8b8b92"}"></span>` +
          `<span class="who">${escapeHtml(p ? displayName(p, i) : "—")}</span>` +
          `<span class="delta">${fmt(e.delta)}</span>`;
        logEl.append(row);
      }
    }
    $("#undo").disabled = state.cursor === 0;
    $("#redo").disabled = state.cursor >= state.log.length;
  }


  $("#undo").onclick = () => { if (undo()) { refreshScores(); renderHistory(); feedback(); } };
  $("#redo").onclick = () => { if (redo()) { refreshScores(); renderHistory(); feedback(); } };

  /* ---------------- color picker ---------------- */

  const pickerEl = $("#picker");
  let pickerFor = null;

  function openPicker(anchor, player) {
    closePicker();
    pickerFor = player;
    pickerEl.textContent = "";
    for (const c of PALETTE) {
      const b = document.createElement("button");
      b.className = "chip" + (c.toLowerCase() === player.color.toLowerCase() ? " sel" : "");
      b.style.setProperty("--c", c);
      b.setAttribute("aria-label", "Use color " + c);
      b.onclick = () => setColor(c, true);
      pickerEl.appendChild(b);
    }
    const custom = document.createElement("div");
    custom.className = "chip custom";
    custom.innerHTML = `<input type="color" value="${player.color.slice(0, 7)}" aria-label="Custom color">`;
    custom.querySelector("input").oninput = (e) => setColor(e.target.value, false);
    pickerEl.appendChild(custom);

    pickerEl.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pickerEl.offsetWidth, h = pickerEl.offsetHeight;
    let left = Math.min(Math.max(10, r.left + r.width / 2 - w / 2), window.innerWidth - w - 10);
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 10);
    pickerEl.style.left = left + "px";
    pickerEl.style.top = top + "px";
    setTimeout(() => document.addEventListener("pointerdown", outsidePicker), 0);
  }

  function setColor(c, close) {
    if (!pickerFor) return;
    pickerFor.color = c;
    save();
    render();
    renderPlayers();
    if (sheetOpen === "history") renderHistory();
    if (close) closePicker();
    else pickerEl.querySelectorAll(".chip").forEach((el) =>
      el.classList.toggle("sel", el.style.getPropertyValue("--c").trim().toLowerCase() === c.toLowerCase()));
  }

  function outsidePicker(e) {
    if (!pickerEl.hidden && !pickerEl.contains(e.target) && !e.target.closest(".swatch")) closePicker();
  }

  function closePicker() {
    pickerFor = null;
    pickerEl.hidden = true;
    document.removeEventListener("pointerdown", outsidePicker);
  }

  /* ---------------- boot ---------------- */

  // Fade the wordmark out once the board is in use, and bring it back on a reset.
  const brandEl = $("#brand");
  const syncBrand = () => { brandEl.style.opacity = state.log.length ? "0" : "1"; };

  document.addEventListener("gesturestart", (e) => e.preventDefault());
  let rAF = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(rAF); rAF = requestAnimationFrame(render); });
  window.addEventListener("orientationchange", () => setTimeout(render, 250));

  render();
  syncBrand();
})();
