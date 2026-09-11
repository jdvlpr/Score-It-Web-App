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

  const app = $(".app"), dial = $("#dial"), dotsEl = $("#dots"), arcEl = $("#ring-arc"),
        readout = $("#readout"), topEl = $("#labels-top"), botEl = $("#labels-bottom");

  const labelEls = new Map();
  const dotEls = new Map();

  function render() {
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
    drawArc(null, 0);
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

  function drawArc(player, pending) {
    if (!player || !pending) {
      arcEl.setAttribute("stroke-dasharray", `0 ${C}`);
      return;
    }
    const steps = state.settings.steps;
    const mag = Math.abs(pending);
    const frac = mag % steps === 0 ? 1 : (mag % steps) / steps;
    const len = frac * C;
    const seat = seatAngle(state.players.indexOf(player), state.players.length);
    const start = pending >= 0 ? seat : seat - frac * 360;
    arcEl.setAttribute("stroke-dasharray", `${len.toFixed(2)} ${(C - len).toFixed(2)}`);
    arcEl.setAttribute("transform", `rotate(${start.toFixed(2)} 50 50)`);
  }

  const fmt = (d) => (d > 0 ? "+" + d : String(d));

  /* ---------------- the swipe dial ---------------- */

  let drag = null;
  let readoutTimer = 0;

  function angleAt(e) {
    const r = dial.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    return { deg: (Math.atan2(y, x) * 180) / Math.PI, dist: Math.hypot(x, y) / (r.width / 2) };
  }

  dial.addEventListener("pointerdown", (e) => {
    const dot = e.target.closest(".dot");
    if (!dot || drag) return;
    const p = byId(dot.dataset.id);
    if (!p) return;
    e.preventDefault();
    try { dial.setPointerCapture(e.pointerId); } catch (_) {}
    const a = angleAt(e);
    drag = { pid: e.pointerId, id: p.id, last: a.deg, acc: 0, pending: 0, moved: false, x: e.clientX, y: e.clientY };
    dial.classList.add("is-dragging");
    dial.style.setProperty("--arc-color", p.color);
    dot.classList.add("is-active");
    labelEls.get(p.id)?.el.classList.add("is-active");
    clearTimeout(readoutTimer);
    showReadout(0);
    setScoreText(p.id, p.score);   // the label previews the resulting total, not the delta
    drawArc(p, 0);
  });

  // move/up live on window, not the dial: with pointer capture the events still bubble here,
  // and without it (capture can fail) they arrive from wherever the finger actually is.
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) drag.moved = true;
    const a = angleAt(e);
    if (a.dist < 0.16) { drag.last = null; return; }   // dead zone: angles go wild near the hub
    if (drag.last === null) { drag.last = a.deg; return; }
    drag.acc += ((a.deg - drag.last + 540) % 360) - 180; // shortest arc — never jumps the seam
    drag.last = a.deg;
    const next = Math.round(drag.acc / (360 / state.settings.steps));
    if (next === drag.pending) return;
    drag.pending = next;
    const p = byId(drag.id);
    showReadout(next * state.settings.step);
    setScoreText(drag.id, p.score + next * state.settings.step);
    drawArc(p, next);
    feedback();
  }, { passive: false });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    dial.classList.remove("is-dragging");
    dotEls.get(d.id)?.classList.remove("is-active");
    labelEls.get(d.id)?.el.classList.remove("is-active");
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
    drawArc(null, 0);
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
