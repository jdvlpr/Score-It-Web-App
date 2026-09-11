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

  /* ---------------- state ---------------- */

  const fresh = () => ({
    players: [newPlayer("Player 1", 0), newPlayer("Player 2", 1)],
    log: [],
    cursor: 0,
    settings: { steps: 12, step: 1, haptics: true, sound: false },
  });

  let uid = Date.now() % 1e6;
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
      raw.settings = Object.assign({ steps: 12, step: 1, haptics: true, sound: false }, raw.settings || {});
      if (!STEPS.includes(+raw.settings.step)) raw.settings.step = 1;
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
  }
  // Phones kill backgrounded tabs without warning — never leave a score in the debounce.
  addEventListener("pagehide", writeNow);
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") writeNow(); });

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const byId = (id) => state.players.find((p) => p.id === id);
  const displayName = (p, i) => p.name.trim() || "Player " + (i + 1);

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

  const app = $(".app"), dial = $("#dial"), dotsEl = $("#dots"), trailEl = $("#trail"),
        readout = $("#readout"), topEl = $("#labels-top"), botEl = $("#labels-bottom");

  const labelEls = new Map();
  const dotEls = new Map();

  function render() {
    settle();                      // never rebuild the dots out from under a live gesture
    const n = state.players.length;
    const seats = state.players.map((p, i) => ({ p, i, a: seatAngle(i, n) }));

    // Sizing: dots shrink to fit the ring, labels shrink to fit the screen.
    const slot = C / n;
    const dotPct = Math.max(6.5, Math.min(16, slot * 0.74));
    const k = Math.max(0.72, Math.min(1.12, window.innerHeight / 780));
    const size = n <= 2 ? [150, 56, 17] : n <= 4 ? [128, 46, 16]
               : n <= 6 ? [112, 39, 15] : n <= 8 ? [98, 33, 14] : [88, 28, 13];
    const root = document.documentElement.style;
    root.setProperty("--dot-pct", dotPct.toFixed(2));
    root.setProperty("--label-span", Math.round(size[0] * k) + "px");
    root.setProperty("--score-fs", Math.round(size[1] * k) + "px");
    root.setProperty("--name-fs", Math.round(size[2] * k) + "px");

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
    fillLabels(topEl, top);
    fillLabels(botEl, bottom);
    clearTrail();
  }

  function fillLabels(host, group) {
    const cols = group.length <= 3 ? Math.max(1, group.length) : group.length === 4 ? 2 : 3;
    for (const s of group) {
      const el = document.createElement("button");
      el.className = "label";
      el.dataset.id = s.p.id;
      el.style.setProperty("--col", (100 / cols).toFixed(3) + "%");
      el.style.color = s.p.color;
      el.setAttribute("aria-label", `${displayName(s.p, s.i)}: ${s.p.score}. Tap to rotate.`);
      const inner = document.createElement("span");
      inner.className = "label-inner";
      inner.style.transform = `rotate(${s.p.rot}deg)`;
      const nm = document.createElement("span");
      nm.className = "name";
      nm.textContent = displayName(s.p, s.i);
      const sc = document.createElement("span");
      sc.className = "score";
      sc.textContent = s.p.score;
      inner.append(nm, sc);
      el.appendChild(inner);
      host.appendChild(el);
      labelEls.set(s.p.id, { el, score: sc, inner });
    }
  }

  function setScoreText(id, text) {
    const l = labelEls.get(id);
    if (l) l.score.textContent = text;
  }

  // How far behind the dot the trail keeps its full strength before easing back a shade.
  const FADE = 360;

  function clearTrail() { trailEl.style.background = "none"; }

  // The trail runs back from the dot toward the player's seat. A conic gradient is the
  // only thing that can fade *along* an arc; the mask makes it a band. Past a full lap
  // it simply stays a closed ring rather than starting the sweep over.
  function drawTrail(seat, off, strong, faint) {
    const mag = Math.abs(off);
    if (mag < 0.2) return clearTrail();
    const m = Math.min(mag, 360);
    const fade = Math.min(m, FADE);
    const cw = off >= 0;
    const dot = seat + off;
    const from = (cw ? dot - m : dot) + 90;     // CSS conic 0deg is twelve o'clock
    const stops = cw
      ? `${faint} 0deg, ${faint} ${(m - fade).toFixed(2)}deg, ${strong} ${m.toFixed(2)}deg, transparent ${m.toFixed(2)}deg`
      : `${strong} 0deg, ${faint} ${fade.toFixed(2)}deg, ${faint} ${m.toFixed(2)}deg, transparent ${m.toFixed(2)}deg`;
    trailEl.style.background = `conic-gradient(from ${from.toFixed(2)}deg, ${stops})`;
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
  let readoutTimer = 0, rafId = 0;

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
    drawTrail(anim.seat, anim.shown, anim.strong, anim.faint);
  }

  // Land the dot back in its seat and give the ring back to everybody.
  function settle() {
    if (!anim) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    clearTimeout(anim.rw && anim.rw.guard);
    const el = dotEls.get(anim.id);
    if (el) { el.style.transform = ""; el.classList.remove("is-active"); }
    labelEls.get(anim.id)?.el.classList.remove("is-active");
    clearTrail();
    dial.classList.remove("is-dragging");
    anim = null;
  }

  dial.addEventListener("pointerdown", (e) => {
    const dot = e.target.closest(".dot");
    if (!dot || drag) return;
    const p = byId(dot.dataset.id);
    if (!p) return;
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
      strong: `color-mix(in srgb, ${p.color} 55%, transparent)`,
      faint: `color-mix(in srgb, ${p.color} 0%, transparent)`,
    };
    dial.classList.add("is-dragging");
    dial.style.setProperty("--live-color", p.color);
    dot.classList.add("is-active");
    labelEls.get(p.id)?.el.classList.add("is-active");
    clearTimeout(readoutTimer);
    showReadout(0);
    setScoreText(p.id, p.score);   // the label previews the resulting total, not the delta
    clearTrail();
  });

  // move/up live on window, not the dial: with pointer capture the events still bubble here,
  // and without it (capture can fail) they arrive from wherever the finger actually is.
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) drag.moved = true;
    const r = dial.getBoundingClientRect();
    advance(drag, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    anim.shown = drag.acc;
    paint();
    const next = Math.round(drag.acc / (360 / state.settings.steps));
    if (next === drag.pending) return;
    drag.pending = next;
    const p = byId(drag.id);
    showReadout(next * state.settings.step);
    setScoreText(drag.id, p.score + next * state.settings.step);
    feedback();
  }, { passive: false });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    const delta = (d.moved ? d.pending : 1) * state.settings.step;   // a tap with no swipe is one step
    if (delta) {
      commit(d.id, delta);
      feedback(true);
      showReadout(delta);
      readoutTimer = setTimeout(() => readout.classList.remove("show"), 620);
    } else {
      readout.classList.remove("show");
    }
    const p = byId(d.id);
    setScoreText(d.id, p ? p.score : 0);
    labelEls.get(d.id)?.score.classList.remove("pop");
    void labelEls.get(d.id)?.score.offsetWidth;
    if (delta) labelEls.get(d.id)?.score.classList.add("pop");
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
    render();
    if (sheetOpen === "history") renderHistory();
  });

  function showReadout(v) {
    readout.textContent = fmt(v);
    readout.classList.add("show");
  }

  /* haptics + tick */
  let actx = null;
  function feedback(strong) {
    if (state.settings.haptics && navigator.vibrate) navigator.vibrate(strong ? 16 : 7);
    if (!state.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine";
      o.frequency.value = strong ? 440 : 680;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(strong ? 0.16 : 0.09, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.09);
    } catch (_) {}
  }

  /* tap a name to rotate it toward whoever is sitting there */
  const rotate = (e) => {
    const el = e.target.closest(".label");
    if (!el) return;
    const p = byId(el.dataset.id);
    if (!p) return;
    p.rot = (p.rot + 90) % 360;
    labelEls.get(p.id).inner.style.transform = `rotate(${p.rot}deg)`;
    if (state.settings.haptics && navigator.vibrate) navigator.vibrate(7);
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
    setTimeout(() => { if (!sheetOpen) { scrim.hidden = true; s.hidden = true; } }, 420);
  }

  $("#open-players").onclick = () => openSheet("players");
  $("#open-history").onclick = () => openSheet("history");
  scrim.onclick = closeSheet;
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeSheet));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePicker(); closeSheet(); } });

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
    save(); render(); renderPlayers();
  };

  const optH = $("#opt-haptics"), optS = $("#opt-sound"), optSteps = $("#opt-steps"), optStepsVal = $("#opt-steps-val");
  optH.checked = state.settings.haptics;
  optS.checked = state.settings.sound;
  optSteps.value = state.settings.steps;
  const stepsLabel = () => (optStepsVal.textContent = state.settings.steps + " stops");
  stepsLabel();
  optH.onchange = () => { state.settings.haptics = optH.checked; save(); };
  optS.onchange = () => { state.settings.sound = optS.checked; if (optS.checked) feedback(); save(); };
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
      state.log.forEach((e, idx) => {
        const p = byId(e.playerId);
        const i = state.players.indexOf(p);
        const row = document.createElement("div");
        row.className = "entry" + (idx >= state.cursor ? " undone" : "");
        row.style.color = p ? p.color : "#8b8b92";
        row.innerHTML = `<span class="bead" style="--c:${p ? p.color : "#8b8b92"}"></span>` +
          `<span class="who">${escapeHtml(p ? displayName(p, i) : "—")}</span>` +
          `<span class="delta">${fmt(e.delta)}</span>`;
        logEl.prepend(row);
      });
    }
    $("#undo").disabled = state.cursor === 0;
    $("#redo").disabled = state.cursor >= state.log.length;
  }


  $("#undo").onclick = () => { if (undo()) { render(); renderHistory(); feedback(); } };
  $("#redo").onclick = () => { if (redo()) { render(); renderHistory(); feedback(); } };

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

  document.addEventListener("gesturestart", (e) => e.preventDefault());
  let rAF = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(rAF); rAF = requestAnimationFrame(render); });
  window.addEventListener("orientationchange", () => setTimeout(render, 250));

  render();

  // Fade the wordmark out once the board is in use.
  if (state.log.length) $("#brand").style.opacity = "0";
})();
