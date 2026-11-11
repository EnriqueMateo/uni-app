"use strict";
// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PALETTE = ["#3b5bdb", "#1c7ed6", "#0c8599", "#2b8a3e", "#5c940d", "#f08c00", "#d9480f", "#e03131", "#c2255c", "#7048e8", "#862e9c", "#868e96"];
const col = s => (settings?.subject_colors || {})[s] || "var(--Otro)";
const LABELS = ["#e03131", "#f08c00", "#f2c94c", "#2f9e44", "#1c7ed6", "#7048e8", "#868e96"];
const pad = n => String(n).padStart(2, "0");
const fmtHM = min => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h ${pad(m)}` : `${m} min`; };
const fmtH = min => (min / 60).toFixed(1).replace(".", ",") + " h";
const fmtTime = d => new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fmtDate = d => new Date(d).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
const toLocalInput = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

async function api(path, opts = {}) {
  const r = await fetch("/api" + path, {
    method: opts.method || "GET", credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && !path.startsWith("/login") && !path.startsWith("/passkey")) { showLogin(); throw new Error("No autorizado"); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Error " + r.status);
  return data;
}
// toast con acción opcional (p. ej. «Deshacer»)
function toast(msg, actLabel, actFn) {
  const t = $("#toast"), b = $("#toastAct");
  $("#toastMsg").textContent = msg;
  b.classList.toggle("hidden", !actLabel); b.textContent = actLabel || "";
  b.onclick = () => { t.classList.remove("show"); actFn && actFn(); };
  t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), actLabel ? 5000 : 2600);
}

// modal genérico: devuelve {action, data} o null
function modal(title, inner, actions = [["cancel", "Cancelar"], ["save", "Guardar", "primary"]], left = null) {
  const d = $("#modal"), f = $("#modalForm");
  // Solo la última acción es "submit": así Enter en el teclado guarda (y nunca cancela ni borra)
  const btn = ([v, l, c], submit) => submit
    ? `<button class="btn sm ${c || ""}" value="${v}" type="submit">${l}</button>`
    : `<button class="btn sm ${c || ""}" data-close="${v}" type="button">${l}</button>`;
  f.innerHTML = `<h2>${esc(title)}</h2>${inner}<div class="m-actions"><div>${left ? btn([left[0], left[1], "danger"], false) : ""}</div><div>${actions.map((a, i) => btn(a, i === actions.length - 1)).join("")}</div></div>`;
  return new Promise(res => {
    let action = null;
    f.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { action = b.dataset.close; d.close(); });
    f.onsubmit = e => { e.preventDefault(); if (!f.reportValidity()) return; action = (e.submitter && e.submitter.value) || actions[actions.length - 1][0]; d.close(); };
    d.onclose = () => res(action && action !== "cancel" ? { action, data: Object.fromEntries(new FormData(f)) } : null);
    d.showModal();
    const first = f.querySelector("input:not([type=hidden]),textarea"); if (first && matchMedia("(pointer:fine)").matches) first.focus();
  });
}

// ---------- estado ----------
let settings = null, stats = null, selSubject = "SuS", view = "estudio";

// ---------- login (passkeys) ----------
let me = {};
function showLogin() {
  $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
  const setup = !me.hasPasskeys && !me.hasPassword;
  $("#loginMsg").textContent = setup ? "Primera vez: registra tu Face ID / Touch ID para que solo tú puedas entrar." : "";
  $("#pkBtn").textContent = setup ? "Activar Face ID / Touch ID" : "Entrar con Face ID / Touch ID";
  $("#pkBtn").classList.toggle("hidden", !me.hasPasskeys && !setup);
  $("#loginForm").classList.toggle("hidden", !me.hasPassword);
}
function deviceName() { const u = navigator.userAgent; return /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Mac/.test(u) ? "Mac" : "Dispositivo"; }
async function registerPasskey() {
  const optionsJSON = await api("/passkey/register/options", { method: "POST" });
  const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
  await api("/passkey/register/verify", { method: "POST", body: { response, name: deviceName() } });
}
async function loginPasskey() {
  const optionsJSON = await api("/passkey/login/options", { method: "POST" });
  const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
  await api("/passkey/login/verify", { method: "POST", body: { response } });
}
$("#pkBtn").onclick = async () => {
  $("#loginErr").textContent = "";
  try {
    if (!me.hasPasskeys && !me.hasPassword) await registerPasskey(); else await loginPasskey();
    me = await fetch("/api/me").then(r => r.json());
    $("#login").classList.add("hidden"); boot();
  } catch (e) { $("#loginErr").textContent = e.name === "NotAllowedError" ? "Cancelado. Vuelve a intentarlo." : e.message; }
};
$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  try { await api("/login", { method: "POST", body: { password: $("#pw").value } }); $("#login").classList.add("hidden"); boot(); }
  catch (err) { $("#loginErr").textContent = err.message; }
};
async function loadPasskeys() {
  const list = await api("/passkeys");
  $("#pkList").innerHTML = list.length ? list.map(k => `<div class="sess"><span class="n">🔑 ${esc(k.name || "Dispositivo")}</span><span class="t">${new Date(k.created_at).toLocaleDateString("es-ES")}</span>${list.length > 1 ? `<button class="icon-btn" data-del-pk="${esc(k.id)}" title="Quitar">×</button>` : ""}</div>`).join("") : `<p class="muted">Ninguno todavía.</p>`;
  $$("[data-del-pk]").forEach(b => b.onclick = async () => { await api(`/passkeys/${encodeURIComponent(b.dataset.delPk)}`, { method: "DELETE" }); loadPasskeys(); });
}
$("#addPk").onclick = async () => { try { await registerPasskey(); toast("Dispositivo añadido"); loadPasskeys(); } catch (e) { toast(e.name === "NotAllowedError" ? "Cancelado" : e.message); } };
$("#logout").onclick = async () => { await api("/logout", { method: "POST" }); location.reload(); };

// ---------- navegación ----------
const TITLES = { estudio: "Estudio", tablero: "Tablero", tareas: "Tareas", ajustes: "Ajustes" };
function go(v) {
  view = v;
  $$(".view").forEach(s => s.classList.toggle("hidden", s.id !== "v-" + v));
  $$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.v === v));
  $("#viewTitle").textContent = TITLES[v];
  try { localStorage.setItem("uni:view", v); } catch { }
  if (v === "estudio") loadStats();
  if (v === "tablero") loadBoards();
  if (v === "tareas") loadTasks();
  if (v === "ajustes") { fillSettings(); loadPasskeys(); }
}
$$(".tabs button").forEach(b => b.onclick = () => go(b.dataset.v));

// ---------- ESTUDIO ----------
function renderChips() {
  const subs = settings.subjects;
  $("#subjectChips").innerHTML = subs.map(s => `<button class="chip ${s === selSubject ? "on" : ""}" data-s="${esc(s)}" style="${s === selSubject ? `background:${col(s)}` : `color:${col(s)}`}">${esc(s)}</button>`).join("");
  $$("#subjectChips .chip").forEach(c => c.onclick = () => { selSubject = c.dataset.s; renderChips(); if (stats?.active) api(`/sessions/${stats.active.id}`, { method: "PATCH", body: { subject: selSubject } }).then(loadStats); });
}
function runShortcut(name) {
  if (!settings.focus?.enabled || !name) return;
  if (!/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) return; // Atajos solo existe en Apple
  setTimeout(() => { location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent(name); }, 150);
}
// Botón principal: Empezar → Pausa → Seguir.  Botón secundario: Terminar.
$("#startBtn").onclick = async () => {
  const btn = $("#startBtn"); btn.disabled = true;
  try {
    if (stats?.pause) {
      await api("/timer/resume", { method: "POST" });
      toast("Sigues con " + (stats.pause.note || stats.pause.subject));
    } else if (stats?.active) {
      await api("/timer/pause", { method: "POST", body: { note: $("#note").value } });
      toast("En pausa. La tarea queda guardada.");
    } else {
      await api("/timer/start", { method: "POST", body: { subject: selSubject, note: $("#note").value } });
      runShortcut(settings.focus.on);
    }
    await loadStats();
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
};
$("#endBtn").onclick = async () => {
  const btn = $("#endBtn"); btn.disabled = true;
  try {
    if (stats?.pause) await api("/timer/pause/end", { method: "POST" });
    else if (stats?.active) await api("/timer/stop", { method: "POST", body: { note: $("#note").value } });
    toast("Sesión terminada. Hoy llevas " + fmtHM(stats.today));
    runShortcut(settings.focus.off);
    $("#note").value = "";
    await loadStats();
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
};

let noteT; $("#note").oninput = () => { clearTimeout(noteT); if (stats?.active) noteT = setTimeout(() => api(`/sessions/${stats.active.id}`, { method: "PATCH", body: { note: $("#note").value } }), 700); };

async function loadStats() {
  try { stats = await api("/stats"); } catch { return; }
  stats._fetched = Date.now(); stats._serverNow = new Date(stats.now).getTime();
  if (stats.active) { selSubject = stats.active.subject; if (document.activeElement !== $("#note")) $("#note").value = stats.active.note || ""; }
  if (stats.pause) { selSubject = stats.pause.subject; if (document.activeElement !== $("#note")) $("#note").value = stats.pause.note || ""; }
  renderChips(); renderStats(); tick();
}
function nowMs() { return stats ? stats._serverNow + (Date.now() - stats._fetched) : Date.now(); }
let lastPhase = null;
function tick() {
  if (!stats) return;
  const a = stats.active, card = $("#timerCard"), btn = $("#startBtn"), p = stats.pause;
  card.classList.toggle("running", !!a); card.classList.toggle("paused", !!p);
  btn.textContent = p ? "Seguir" : a ? "Pausa" : "Empezar";
  btn.classList.toggle("pause", !!a); btn.classList.toggle("resume", false); btn.classList.toggle("stop", false);
  $("#endBtn").classList.toggle("hidden", !a && !p);
  $("#clock").classList.remove("over");
  if (p) {
    const s = Math.max(0, Math.round((nowMs() - new Date(p.started_at)) / 1000));
    $("#clock").textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    $("#clockSub").textContent = `En pausa · luego: ${p.note || p.subject}`;
    $("#ringFg").style.stroke = "#e8a33d";
    $("#ringFg").style.strokeDashoffset = 553 * (1 - ((s / 60) % 60) / 60);
    $("#focusHint").textContent = "La pausa no cuenta como estudio";
    return;
  }
  const studyTargets = Object.entries(stats.targets).filter(([k]) => k !== "MSUP").reduce((s, [, v]) => s + Number(v || 0), 0);
  const dailyGoal = Math.max(60, studyTargets * 60 / 6);
  const activeMin = a ? (nowMs() - new Date(a.started_at)) / 60000 : 0;
  let ringPct;
  if (a) {
    const s = Math.floor(activeMin * 60);
    $("#clock").textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    const p = settings.pomodoro;
    if (p?.enabled) {
      const cyc = p.work + p.rest, pos = activeMin % cyc, working = pos < p.work;
      const left = Math.ceil((working ? p.work - pos : cyc - pos));
      $("#clockSub").textContent = working ? `Concentración · pausa en ${left} min` : `Pausa · vuelve en ${left} min`;
      ringPct = working ? pos / p.work : (pos - p.work) / p.rest;
      const phase = working ? "w" : "r";
      if (lastPhase && phase !== lastPhase) { beep(); toast(working ? "¡A trabajar!" : "Pausa de " + p.rest + " min"); navigator.vibrate?.(300); }
      lastPhase = phase;
      $("#ringFg").style.stroke = working ? col(a.subject) : "var(--Otro)";
    } else {
      $("#clockSub").textContent = `${a.subject} · desde ${fmtTime(a.started_at)}`;
      ringPct = (activeMin % 60) / 60; $("#ringFg").style.stroke = col(a.subject);
    }
  } else {
    lastPhase = null;
    $("#clock").textContent = fmtHM(stats.today).replace(" min", "m");
    $("#clockSub").textContent = `hoy · objetivo ~${fmtH(dailyGoal)}`;
    ringPct = Math.min(1, stats.today / dailyGoal); $("#ringFg").style.stroke = "var(--accent)";
  }
  $("#ringFg").style.strokeDashoffset = 553 * (1 - ringPct);
  $("#focusHint").textContent = settings.focus?.enabled ? (a ? `Al terminar: «${settings.focus.off}»` : `Al empezar se activa «${settings.focus.on}»`) : "";
}
setInterval(tick, 1000);
let audioCtx; function beep() { try { audioCtx = audioCtx || new AudioContext(); const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value = 880; g.gain.setValueAtTime(.2, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .6); o.start(); o.stop(audioCtx.currentTime + .6); } catch { } }

function renderStats() {
  $("#todayTotal").textContent = fmtHM(stats.today);
  const list = stats.todaySessions.slice().reverse();
  $("#todayList").innerHTML = list.length ? list.map(s => {
    const end = s.ended_at ? new Date(s.ended_at) : new Date(nowMs());
    return `<div class="sess" data-id="${s.id}"><span class="dot" style="background:${col(s.subject)}"></span><span class="t">${fmtTime(s.started_at)}–${s.ended_at ? fmtTime(s.ended_at) : "ahora"}</span><span class="n">${esc(s.note || s.subject)}</span><span class="d">${fmtHM((end - new Date(s.started_at)) / 60000)}</span></div>`;
  }).join("") : `<p class="muted small">Todavía nada hoy. Dale a «Empezar» cuando te sientes.</p>`;
  $$("#todayList .sess").forEach(el => el.onclick = () => editSession(stats.todaySessions.find(s => s.id == el.dataset.id)));

  const subs = [...new Set([...Object.keys(stats.targets), ...Object.keys(stats.week)])];
  $("#weekBars").innerHTML = subs.map(s => {
    const done = stats.week[s] || 0, tgt = Number(stats.targets[s] || 0) * 60;
    const pct = tgt ? Math.min(100, done / tgt * 100) : (done ? 100 : 0);
    return `<div class="bar-row"><div class="l"><span><span class="dot" style="background:${col(s)}"></span> ${esc(s)}</span><span class="muted">${fmtH(done)}${tgt ? " / " + fmtH(tgt) : ""}</span></div><div class="bar"><i style="width:${pct}%;background:${col(s)}"></i></div></div>`;
  }).join("");
  const max = Math.max(60, ...stats.perDay), wd = (new Date().getDay() + 6) % 7;
  $("#daysBar").innerHTML = ["L", "M", "X", "J", "V", "S", "D"].map((d, i) => `<div class="${i === wd ? "today" : ""}" title="${fmtHM(stats.perDay[i])}"><b style="height:${stats.perDay[i] / max * 52}px"></b>${d}</div>`).join("");
  $("#streak").textContent = stats.streak ? `🔥 ${stats.streak} día${stats.streak > 1 ? "s" : ""}` : "";
  const today0 = startOfDay();
  $("#exams").innerHTML = (settings.exams || []).map(e => { const days = Math.round((new Date(e.date + "T00:00") - today0) / 864e5); return `<div><b style="color:${col(e.subject)}">${days}</b><span class="muted small">días · ${esc(e.subject)}</span></div>`; }).join("");
}

async function editSession(s) {
  const opts = settings.subjects.map(x => `<option ${x === s.subject ? "selected" : ""}>${esc(x)}</option>`).join("");
  const r = await modal("Sesión", `
    <label>Asignatura<select name="subject">${opts}</select></label>
    <label>Qué hiciste<textarea name="note" rows="2">${esc(s.note)}</textarea></label>
    <div class="row2"><label>Inicio<input type="datetime-local" name="started_at" value="${toLocalInput(s.started_at)}" required></label>
    <label>Fin<input type="datetime-local" name="ended_at" value="${s.ended_at ? toLocalInput(s.ended_at) : ""}"></label></div>`,
    undefined, s.id ? ["delete", "Borrar"] : null);
  if (!r) return;
  try {
    if (r.action === "delete") await api(`/sessions/${s.id}`, { method: "DELETE" });
    else {
      const body = { subject: r.data.subject, note: r.data.note, started_at: new Date(r.data.started_at).toISOString(), ended_at: r.data.ended_at ? new Date(r.data.ended_at).toISOString() : null };
      if (!s.id && !body.ended_at) return toast("Pon la hora de fin");
      await api(s.id ? `/sessions/${s.id}` : "/sessions", { method: s.id ? "PATCH" : "POST", body });
    }
    loadStats();
  } catch (e) { toast(e.message); }
}
$("#addManual").onclick = () => { const end = new Date(), start = new Date(end - 3600e3); editSession({ subject: selSubject, note: "", started_at: start, ended_at: end }); };

// ---------- TABLERO ----------
let boards = [], boardId = null, board = null;
async function loadBoards() {
  boards = await api("/boards");
  try { boardId = +localStorage.getItem("uni:board") || null; } catch { }
  if (!boards.find(b => b.id === boardId)) boardId = boards[0]?.id || null;
  $("#boardSel").innerHTML = boards.map(b => `<option value="${b.id}" ${b.id === boardId ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  if (boardId) loadBoard();
}
$("#boardSel").onchange = e => { boardId = +e.target.value; try { localStorage.setItem("uni:board", boardId); } catch { } loadBoard(); };
$("#newBoard").onclick = async () => {
  const r = await modal("Nuevo tablero", `<label>Nombre<input name="name" required placeholder="p. ej. MSUP Workshop"></label>`, [["cancel", "Cancelar"], ["save", "Crear", "primary"]]);
  if (!r) return;
  try {
    const b = await api("/boards", { method: "POST", body: { name: r.data.name } });
    try { localStorage.setItem("uni:board", b.id); } catch { }
    await loadBoards(); boardId = b.id; $("#boardSel").value = String(b.id); await loadBoard();
    toast("Tablero «" + b.name + "» creado");
  } catch (e) { toast("No se pudo crear: " + e.message); }
};
$("#boardMenu").onclick = async () => {
  if (!board) return;
  const r = await modal("Tablero", `<label>Nombre<input name="name" value="${esc(board.name)}" required></label>`, undefined, ["delete", "Borrar tablero"]);
  if (!r) return;
  if (r.action === "delete") { if (boards.length <= 1) return toast("Necesitas al menos un tablero"); await api(`/boards/${board.id}`, { method: "DELETE" }); boardId = null; try { localStorage.removeItem("uni:board"); } catch { } }
  else await api(`/boards/${board.id}`, { method: "PATCH", body: { name: r.data.name } });
  loadBoards();
};

let boardSubFilter = "", showDoneCards = false;
async function loadBoard() { board = await api(`/boards/${boardId}`); renderBoard(); }
const visibleCard = c => (showDoneCards || !c.done) && (!boardSubFilter || c.subject === boardSubFilter);
function renderBoardFilter() {
  const all = board.lists.flatMap(l => l.cards).filter(c => !c.done);
  const n = v => all.filter(c => c.subject === v).length;
  const chip = (v, label, color) => `<button class="fchip ${boardSubFilter === v ? "on" : ""}" data-f="${esc(v)}" style="${boardSubFilter === v ? `background:${color}` : ""}">${v ? `<span class="dot" style="background:${color}"></span>` : ""}${esc(label)} <span class="n">${v ? n(v) : all.length}</span></button>`;
  $("#boardFilter").innerHTML = chip("", "Todas", "var(--ink)") + settings.subjects.map(s => chip(s, s, col(s))).join("");
  $$("#boardFilter .fchip").forEach(b => b.onclick = () => { boardSubFilter = b.dataset.f; renderBoard(); });
  const doneN = board.lists.flatMap(l => l.cards).filter(c => c.done).length;
  $("#doneBar").innerHTML = doneN ? `<span>${doneN} hecha${doneN > 1 ? "s" : ""}</span><button class="btn sm" id="toggleDoneCards">${showDoneCards ? "Ocultar" : "Mostrar"}</button><button class="btn sm" id="clearDoneCards">Borrar hechas</button>` : "";
  if (doneN) {
    $("#toggleDoneCards").onclick = () => { showDoneCards = !showDoneCards; renderBoard(); };
    $("#clearDoneCards").onclick = async () => {
      const r = await api(`/boards/${board.id}/clear-done`, { method: "POST" }); await loadBoard();
      toast(`${r.ids.length} tarjetas hechas borradas`, "Deshacer", async () => { await api("/cards/restore-many", { method: "POST", body: { ids: r.ids } }); loadBoard(); });
    };
  }
}
function renderBoard() {
  const el = $("#board"); const today = startOfDay();
  renderBoardFilter();
  el.innerHTML = board.lists.map(l => `
    <div class="list" data-id="${l.id}">
      <div class="list-h"><input value="${esc(l.name)}" data-list="${l.id}"><button class="icon-btn" data-del-list="${l.id}" title="Borrar lista">×</button></div>
      <div class="cards" data-list="${l.id}">${l.cards.filter(visibleCard).map(c => cardHTML(c, today)).join("")}</div>
      <button class="add-card" data-add="${l.id}">+ Añadir tarjeta</button>
    </div>`).join("") + `<button class="add-list" id="addList">+ Añadir lista</button>`;

  $$(".list-h input").forEach(i => { i.onchange = () => api(`/lists/${i.dataset.list}`, { method: "PATCH", body: { name: i.value } }); i.onkeydown = e => e.key === "Enter" && i.blur(); });
  $$("[data-del-list]").forEach(b => b.onclick = async () => {
    const l = board.lists.find(x => x.id == b.dataset.delList);
    const r = await modal("Borrar lista", `<p>¿Borrar «${esc(l.name)}» y sus ${l.cards.length} tarjetas?</p>`, [["cancel", "Cancelar"], ["ok", "Borrar", "danger"]]);
    if (r) { await api(`/lists/${l.id}`, { method: "DELETE" }); loadBoard(); }
  });
  $$("[data-add]").forEach(b => b.onclick = () => addCardInline(b));
  $("#addList").onclick = async () => {
    const r = await modal("Nueva lista", `<label>Nombre<input name="name" required></label>`, [["cancel", "Cancelar"], ["save", "Crear", "primary"]]);
    if (r) { await api("/lists", { method: "POST", body: { board_id: board.id, name: r.data.name } }); loadBoard(); }
  };
  $$(".kcard").forEach(el => {
    const c = board.lists.flatMap(l => l.cards).find(x => x.id === +el.dataset.id);
    el.onclick = e => { if (!e.target.closest("button")) editCard(c.id); };
    el.querySelector(".k-done").onclick = async e => {
      e.stopPropagation(); const val = !c.done;
      if (val && !showDoneCards) { el.classList.add("leaving"); await new Promise(r => setTimeout(r, 300)); }
      c.done = val; renderBoard();
      api(`/cards/${c.id}`, { method: "PATCH", body: { done: val } });
      if (val) toast("Tarjeta hecha ✓", "Deshacer", () => { c.done = false; renderBoard(); api(`/cards/${c.id}`, { method: "PATCH", body: { done: false } }); });
    };
    el.querySelector(".k-del").onclick = async e => {
      e.stopPropagation(); el.classList.add("leaving"); await new Promise(r => setTimeout(r, 300));
      board.lists.forEach(l => l.cards = l.cards.filter(x => x !== c)); renderBoard();
      await api(`/cards/${c.id}`, { method: "DELETE" });
      toast("Tarjeta eliminada", "Deshacer", async () => { await api(`/cards/${c.id}/restore`, { method: "POST" }); loadBoard(); });
    };
    el.querySelector(".sub-pill").onclick = e => { e.stopPropagation(); subPicker(e.currentTarget, c.subject, async v => { c.subject = v; renderBoard(); await api(`/cards/${c.id}`, { method: "PATCH", body: { subject: v } }); }); };
  });

  if (window.Sortable) {
    $$(".cards").forEach(c => Sortable.create(c, {
      group: "cards", animation: 150, delay: 180, delayOnTouchOnly: true, ghostClass: "sortable-ghost",
      onEnd: async ev => {
        const lists = new Set([ev.from, ev.to]);
        for (const lst of lists) await api(`/lists/${lst.dataset.list}/order`, { method: "POST", body: { card_ids: [...lst.children].map(x => +x.dataset.id) } });
        loadBoard();
      },
    }));
    Sortable.create(el, {
      animation: 150, handle: ".list-h", draggable: ".list", delay: 180, delayOnTouchOnly: true, filter: "input,button", preventOnFilter: false,
      onEnd: () => api(`/boards/${board.id}/order`, { method: "POST", body: { list_ids: $$(".list").map(x => +x.dataset.id) } }),
    });
  }
}
function cardHTML(c, today) {
  const due = c.due ? new Date(c.due.slice(0, 10) + "T00:00") : null;
  const late = due && due < today;
  const border = c.subject ? col(c.subject) : (c.label || "var(--line)");
  return `<div class="kcard ${c.done ? "done" : ""}" data-id="${c.id}" style="border-left-color:${esc(border)}">
    <div class="acts"><button class="k-done" title="${c.done ? "Marcar como pendiente" : "Marcar como hecha"}">✓</button><button class="k-del" title="Eliminar">🗑</button></div>
    ${pillHTML(c.subject)}<div class="ktitle">${esc(c.title)}</div>
    ${(due || c.description) ? `<div class="meta">${due ? `<span class="${late && !c.done ? "late" : ""}">📅 ${fmtDate(due)}</span>` : ""}${c.description ? "<span>☰</span>" : ""}</div>` : ""}</div>`;
}
function addCardInline(btn) {
  const listId = btn.dataset.add, wrap = document.createElement("div");
  wrap.innerHTML = `<textarea rows="2" placeholder="Título de la tarjeta… (Enter para añadir)"></textarea>`;
  btn.replaceWith(wrap); const ta = wrap.querySelector("textarea"); ta.focus();
  let finished = false;
  const done = async save => {
    if (finished) return; finished = true;
    const t = ta.value.trim();
    if (save && t) { const nc = await api("/cards", { method: "POST", body: { list_id: listId, title: t } }); if (boardSubFilter) await api(`/cards/${nc.id}`, { method: "PATCH", body: { subject: boardSubFilter } }); await loadBoard(); const nb = $(`[data-add="${listId}"]`); if (nb) addCardInline(nb); }
    else loadBoard();
  };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(true); } if (e.key === "Escape") done(false); };
  ta.onblur = () => setTimeout(() => done(true), 100);
}
async function editCard(id) {
  const c = board.lists.flatMap(l => l.cards).find(x => x.id === id);
  const listOpts = board.lists.map(l => `<option value="${l.id}" ${l.id === c.list_id ? "selected" : ""}>${esc(l.name)}</option>`).join("");
  const r = await modal("Tarjeta", `
    <label>Título<input name="title" value="${esc(c.title)}" required></label>
    <label>Descripción<textarea name="description" rows="4">${esc(c.description)}</textarea></label>
    <div class="row2"><label>Fecha<input type="date" name="due" value="${c.due ? c.due.slice(0, 10) : ""}"></label><label>Lista<select name="list_id">${listOpts}</select></label></div>
    <label>Asignatura<select name="subject"><option value="">—</option>${settings.subjects.map(s => `<option ${s === c.subject ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
    <label class="toggle"><input type="checkbox" name="done" ${c.done ? "checked" : ""}> Hecha</label>`,
    undefined, ["delete", "Eliminar"]);
  if (!r) return;
  if (r.action === "delete") { await api(`/cards/${id}`, { method: "DELETE" }); toast("Tarjeta eliminada", "Deshacer", async () => { await api(`/cards/${id}/restore`, { method: "POST" }); loadBoard(); }); }
  else {
    const body = { title: r.data.title, description: r.data.description, due: r.data.due || null, subject: r.data.subject || null, done: !!r.data.done };
    if (+r.data.list_id !== c.list_id) { body.list_id = +r.data.list_id; body.position = 9999; }
    await api(`/cards/${id}`, { method: "PATCH", body });
  }
  loadBoard();
}
document.addEventListener("click", e => {
  const b = e.target.closest(".labels button"); if (!b) return;
  b.parentElement.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on");
  $("#lblIn").value = b.dataset.c;
});

// ---------- TAREAS ----------
let tasks = [], taskFilter = "", qaSubject = null, showDone = false;
async function loadTasks() {
  tasks = await api("/tasks");
  try { $("#showCitas").checked = localStorage.getItem("uni:citas") === "1"; } catch { }
  renderQaSub(); renderTasks();
  const s = settings;
  $("#iliasInfo").textContent = !s.ilias_url ? "ILIAS sin conectar: pega tu enlace iCal en Ajustes." :
    s.ilias_last_error ? "⚠️ Última sincronización falló: " + s.ilias_last_error :
    s.ilias_last_sync ? "ILIAS sincronizado " + new Date(s.ilias_last_sync).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
}
$("#showCitas").onchange = () => { try { localStorage.setItem("uni:citas", $("#showCitas").checked ? "1" : "0"); } catch { } renderTasks(); };

function pillHTML(sub, extra = "") {
  return sub ? `<button type="button" class="sub-pill" ${extra} style="background:${col(sub)}">${esc(sub)}</button>`
             : `<button type="button" class="sub-pill none" ${extra}>+ asignatura</button>`;
}
function renderQaSub() { const b = $("#qaSub"); b.textContent = qaSubject || "Asignatura"; b.className = "sub-pill" + (qaSubject ? "" : " none"); b.style.background = qaSubject ? col(qaSubject) : ""; }
$("#qaSub").onclick = e => subPicker(e.currentTarget, qaSubject, v => { qaSubject = v; renderQaSub(); $("#qaTitle").focus(); });
$("#quickAdd").onsubmit = async e => {
  e.preventDefault();
  const title = $("#qaTitle").value.trim(); if (!title) return;
  const d = $("#qaDue").value;
  try {
    const t = await api("/tasks", { method: "POST", body: { title, subject: qaSubject || (taskFilter || null), due: d ? new Date(d + "T23:59").toISOString() : null, kind: "tarea" } });
    tasks.push(t); $("#qaTitle").value = ""; $("#qaDue").value = ""; renderTasks();
  } catch (err) { toast(err.message); }
};

// Popover para elegir asignatura (como las etiquetas de Trello)
function subPicker(anchor, current, onPick) {
  const pop = $("#subPop");
  if (pop._close) document.removeEventListener("click", pop._close);
  pop.innerHTML = settings.subjects.map(s => `<button data-v="${esc(s)}"><span class="sw" style="background:${col(s)}"></span>${esc(s)}${s === current ? " ✓" : ""}</button>`).join("")
    + `<button data-v=""><span class="sw" style="background:var(--soft)"></span>Sin asignatura${!current ? " ✓" : ""}</button><hr><button data-manage="1">🎨 Editar asignaturas…</button>`;
  const r = anchor.getBoundingClientRect();
  pop.classList.remove("hidden");
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  pop.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + "px";
  pop.querySelectorAll("button").forEach(b => b.onclick = ev => {
    ev.stopPropagation(); pop.classList.add("hidden"); document.removeEventListener("click", pop._close);
    if (b.dataset.manage) manageSubjects(); else onPick(b.dataset.v || null);
  });
  pop._close = ev => { if (!pop.contains(ev.target)) { pop.classList.add("hidden"); document.removeEventListener("click", pop._close); } };
  setTimeout(() => document.addEventListener("click", pop._close), 0);
}

function renderFilter(list) {
  const counts = {}; list.filter(t => !t.done).forEach(t => counts[t.subject || ""] = (counts[t.subject || ""] || 0) + 1);
  const total = list.filter(t => !t.done).length;
  const chip = (v, label, color) => `<button class="fchip ${taskFilter === v ? "on" : ""}" data-f="${esc(v)}" style="${taskFilter === v ? `background:${color}` : ""}">${color && v ? `<span class="dot" style="background:${color}"></span>` : ""}${esc(label)} <span class="n">${v ? (counts[v] || 0) : total}</span></button>`;
  $("#subFilter").innerHTML = chip("", "Todas", "var(--ink)") + settings.subjects.map(s => chip(s, s, col(s))).join("");
  $$("#subFilter .fchip").forEach(b => b.onclick = () => { taskFilter = b.dataset.f; renderTasks(); });
}
function renderTasks() {
  const showCitas = $("#showCitas").checked;
  const base = tasks.filter(t => showCitas || t.kind !== "cita");
  renderFilter(base);
  const list = base.filter(t => !taskFilter || t.subject === taskFilter);
  const t0 = startOfDay(), d1 = new Date(t0.getTime() + 864e5), wEnd = new Date(t0.getTime() + 7 * 864e5);
  const due = t => t.due ? new Date(t.due) : null;
  const groups = [["Vencidas", t => due(t) && due(t) < t0], ["Hoy", t => due(t) && due(t) >= t0 && due(t) < d1],
    ["Próximos 7 días", t => due(t) && due(t) >= d1 && due(t) < wEnd], ["Más adelante", t => due(t) && due(t) >= wEnd], ["Sin fecha", t => !due(t)]];
  const open = list.filter(t => !t.done), done = list.filter(t => t.done);
  let html = groups.map(([name, fn]) => { const items = open.filter(fn); return items.length ? `<div class="tgroup"><h3>${name} · ${items.length}</h3>${items.map(taskHTML).join("")}</div>` : ""; }).join("");
  if (!open.length) html = `<p class="muted" style="text-align:center;padding:24px 0">${done.length ? "🎉 Todo hecho" : "No hay tareas. Escribe una arriba."}</p>`;
  if (done.length) html += `<div class="tgroup"><h3><button class="done-toggle" id="doneToggle">${showDone ? "▾" : "▸"} Hechas · ${done.length}</button><button class="btn sm" id="clearDone">Borrar hechas</button></h3>${showDone ? done.slice(0, 30).map(taskHTML).join("") : ""}</div>`;
  $("#tasks").innerHTML = html;

  $$("#tasks .task").forEach(el => {
    const t = tasks.find(x => x.id == el.dataset.id);
    el.querySelector(".chk").onclick = () => toggleDone(t, el);
    el.querySelector(".del").onclick = () => deleteTask(t, el);
    el.querySelector(".body").onclick = e => { if (!e.target.closest(".sub-pill")) editTask(t); };
    el.querySelector(".sub-pill").onclick = e => { e.stopPropagation(); subPicker(e.currentTarget, t.subject, async v => { t.subject = v; renderTasks(); await api(`/tasks/${t.id}`, { method: "PATCH", body: { subject: v } }); }); };
  });
  const dt = $("#doneToggle"); if (dt) dt.onclick = () => { showDone = !showDone; renderTasks(); };
  const cd = $("#clearDone"); if (cd) cd.onclick = clearDone;
}
function taskHTML(t) {
  const late = !t.done && t.due && new Date(t.due) < new Date();
  const due = t.due ? new Date(t.due) : null;
  const dueTxt = due ? fmtDate(due) + (due.getHours() || due.getMinutes() ? (due.getHours() === 23 && due.getMinutes() === 59 ? "" : " " + fmtTime(due)) : "") : "";
  return `<div class="task ${t.done ? "done" : ""}" data-id="${t.id}" style="border-left-color:${t.subject ? col(t.subject) : "var(--line)"}">
    <button class="chk" title="${t.done ? "Marcar como pendiente" : "Marcar como hecha"}">✓</button>
    <div class="body"><div class="tt">${esc(t.title)}</div><div class="tm">
      ${pillHTML(t.subject)}
      ${dueTxt ? `<span class="${late ? "late" : ""}">📅 ${dueTxt}</span>` : ""}
      ${t.source === "ilias" ? `<span class="badge src">ILIAS${t.kind === "cita" ? " · cita" : ""}</span>` : ""}
      ${t.notes ? "<span>☰</span>" : ""}</div></div>
    <button class="del" title="Eliminar">🗑</button></div>`;
}
function animateOut(el) { return new Promise(r => { el.classList.add("leaving"); setTimeout(r, 350); }); }
async function toggleDone(t, el) {
  const val = !t.done;
  if (val) { el.classList.add("done"); await animateOut(el); }
  t.done = val; renderTasks();
  api(`/tasks/${t.id}`, { method: "PATCH", body: { done: val } }).catch(e => toast(e.message));
  if (val) toast("Hecha ✓", "Deshacer", () => { t.done = false; renderTasks(); api(`/tasks/${t.id}`, { method: "PATCH", body: { done: false } }); });
}
async function deleteTask(t, el) {
  await animateOut(el);
  tasks = tasks.filter(x => x !== t); renderTasks();
  await api(`/tasks/${t.id}`, { method: "DELETE" }).catch(e => toast(e.message));
  toast("Tarea eliminada", "Deshacer", async () => { const r = await api(`/tasks/${t.id}/restore`, { method: "POST" }); tasks.push(r); renderTasks(); });
}
async function clearDone() {
  const r = await api("/tasks/clear-done", { method: "POST" });
  const removed = tasks.filter(t => t.done); tasks = tasks.filter(t => !t.done); renderTasks();
  toast(`${r.ids.length} hechas borradas`, "Deshacer", async () => { await api("/tasks/restore-many", { method: "POST", body: { ids: r.ids } }); tasks.push(...removed); renderTasks(); });
}
async function editTask(t = {}) {
  const subOpts = `<option value="">—</option>` + settings.subjects.map(s => `<option ${s === t.subject ? "selected" : ""}>${esc(s)}</option>`).join("");
  const r = await modal(t.id ? "Tarea" : "Nueva tarea", `
    <label>Título<input name="title" value="${esc(t.title || "")}" required></label>
    <div class="row2"><label>Asignatura<select name="subject">${subOpts}</select></label><label>Fecha límite<input type="datetime-local" name="due" value="${t.due ? toLocalInput(t.due) : ""}"></label></div>
    <label>Tipo<select name="kind"><option value="tarea" ${t.kind === "tarea" ? "selected" : ""}>Tarea</option><option value="entrega" ${t.kind === "entrega" ? "selected" : ""}>Entrega</option><option value="cita" ${t.kind === "cita" ? "selected" : ""}>Cita</option></select></label>
    <label>Notas<textarea name="notes" rows="4">${esc(t.notes || "")}</textarea></label>
    ${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener" class="small">Abrir en ILIAS ↗</a>` : ""}`,
    undefined, t.id ? ["delete", "Eliminar"] : null);
  if (!r) return;
  try {
    if (r.action === "delete") { await api(`/tasks/${t.id}`, { method: "DELETE" }); toast("Tarea eliminada", "Deshacer", async () => { await api(`/tasks/${t.id}/restore`, { method: "POST" }); loadTasks(); }); }
    else {
      const body = { title: r.data.title, subject: r.data.subject || null, due: r.data.due ? new Date(r.data.due).toISOString() : null, notes: r.data.notes, kind: r.data.kind };
      await api(t.id ? `/tasks/${t.id}` : "/tasks", { method: t.id ? "PATCH" : "POST", body });
    }
    loadTasks();
  } catch (e) { toast(e.message); }
}
$("#syncIlias").onclick = async () => {
  try { const r = await api("/ilias/sync", { method: "POST" }); settings = await api("/settings"); toast(r.skipped ? "Primero pega el enlace iCal en Ajustes" : `ILIAS: ${r.added} nuevas, ${r.updated} actualizadas`); loadTasks(); }
  catch (e) { settings = await api("/settings"); toast(e.message); loadTasks(); }
};

// Editor de asignaturas: nombre + color
async function manageSubjects() {
  let rows = settings.subjects.map(s => ({ orig: s, name: s, color: col(s).startsWith("#") ? col(s) : PALETTE[11] }));
  const d = $("#modal"), f = $("#modalForm");
  const draw = () => {
    f.innerHTML = `<h2>Asignaturas</h2><div class="subs-edit">${rows.map((r, i) => `<div class="row"><span class="sub-pill" style="background:${r.color}">${esc(r.name || "…")}</span><input data-i="${i}" value="${esc(r.name)}" placeholder="Nombre"><button type="button" class="icon-btn" data-rm="${i}" title="Quitar">×</button><div class="pal">${PALETTE.map(c => `<button type="button" data-i="${i}" data-c="${c}" class="${c === r.color ? "on" : ""}" style="background:${c}"></button>`).join("")}</div></div>`).join("")}</div>
      <button type="button" class="btn sm" id="addSub">+ Añadir asignatura</button>
      <div class="m-actions"><div></div><div><button type="button" class="btn sm" id="subCancel">Cancelar</button><button type="button" class="btn sm primary" id="subSave">Guardar</button></div></div>`;
    f.querySelectorAll("input[data-i]").forEach(inp => inp.oninput = () => { rows[inp.dataset.i].name = inp.value; inp.previousElementSibling.textContent = inp.value || "…"; });
    f.querySelectorAll(".pal button").forEach(b => b.onclick = () => { rows[b.dataset.i].color = b.dataset.c; draw(); });
    f.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { rows.splice(+b.dataset.rm, 1); draw(); });
    $("#addSub").onclick = () => { rows.push({ orig: null, name: "", color: PALETTE[rows.length % PALETTE.length] }); draw(); f.querySelector(`input[data-i="${rows.length - 1}"]`).focus(); };
    $("#subCancel").onclick = () => d.close();
    $("#subSave").onclick = async () => {
      const clean = rows.map(r => ({ ...r, name: r.name.trim() })).filter(r => r.name);
      const names = clean.map(r => r.name);
      if (new Set(names).size !== names.length) return toast("Hay dos asignaturas con el mismo nombre");
      for (const r of clean) if (r.orig && r.orig !== r.name) await api("/subjects/rename", { method: "POST", body: { from: r.orig, to: r.name } });
      for (const s of settings.subjects) if (!clean.find(r => r.orig === s)) await api("/subjects/rename", { method: "POST", body: { from: s, to: null } });
      const colors = Object.fromEntries(clean.map(r => [r.name, r.color]));
      const targets = {}; for (const r of clean) { const old = settings.targets[r.orig ?? r.name]; if (old !== undefined) targets[r.name] = old; }
      settings = await api("/settings", { method: "PUT", body: { subjects: names, subject_colors: colors, targets } });
      d.close(); toast("Asignaturas guardadas");
      if (view === "tareas") loadTasks(); if (view === "tablero") loadBoard(); if (view === "estudio") loadStats(); if (view === "ajustes") fillSettings();
    };
  };
  f.onsubmit = e => e.preventDefault();
  draw(); d.onclose = null; d.showModal();
}
$("#manageSubs").onclick = manageSubjects;
$("#manageSubs2").onclick = manageSubjects;
$("#manageSubs3").onclick = manageSubjects;

// ---------- AJUSTES ----------
function fillSettings() {
  const f = $("#settingsForm"), s = settings;
  f.focusEnabled.checked = !!s.focus?.enabled; f.focusOn.value = s.focus?.on || ""; f.focusOff.value = s.focus?.off || "";
  f.pomoEnabled.checked = !!s.pomodoro?.enabled; f.pomoWork.value = s.pomodoro?.work || 50; f.pomoRest.value = s.pomodoro?.rest || 10;
  f.ilias.value = s.ilias_url || "";
  $("#targetsInputs").innerHTML = Object.entries(s.targets).map(([k, v]) => `<label>${esc(k)}<input type="number" step="0.5" min="0" data-t="${esc(k)}" value="${v}"></label>`).join("");
}
$("#settingsForm").onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  const targets = {}; $$("#targetsInputs input").forEach(i => targets[i.dataset.t] = Number(i.value) || 0);
  settings = await api("/settings", { method: "PUT", body: {
    focus: { enabled: f.focusEnabled.checked, on: f.focusOn.value.trim(), off: f.focusOff.value.trim() },
    pomodoro: { enabled: f.pomoEnabled.checked, work: Math.max(5, +f.pomoWork.value || 50), rest: Math.max(1, +f.pomoRest.value || 10) },
    ilias_url: f.ilias.value.trim(), targets,
  } });
  toast("Guardado");
  if (settings.ilias_url) api("/ilias/sync", { method: "POST" }).then(r => toast(`ILIAS: ${r.added} nuevas`)).catch(err => toast("ILIAS: " + err.message));
};

// ---------- arranque ----------
async function boot() {
  try { settings = await api("/settings"); } catch { return; }
  $("#app").classList.remove("hidden");
  let v = "estudio"; try { v = localStorage.getItem("uni:view") || "estudio"; } catch { }
  go(TITLES[v] ? v : "estudio");
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && settings) { if (view === "estudio") loadStats(); if (view === "tareas") loadTasks(); } });
(async () => {
  me = await fetch("/api/me").then(r => r.json()).catch(() => ({ authed: false }));
  // Sin passkey ni contraseña: obliga a registrar Face ID / Touch ID antes de usar la app
  if (me.authed && (me.hasPasskeys || me.hasPassword)) boot(); else showLogin();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
})();
