"use strict";
// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = { SuS: "var(--SuS)", EEN: "var(--EEN)", HEF: "var(--HEF)", MSUP: "var(--MSUP)", Otro: "var(--Otro)" };
const col = s => COLORS[s] || "var(--Otro)";
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
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); }

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
$("#startBtn").onclick = async () => {
  const btn = $("#startBtn"); btn.disabled = true;
  try {
    if (stats?.pause) {
      await api("/timer/resume", { method: "POST" });
      toast("De vuelta a " + (stats.pause.note || stats.pause.subject));
      runShortcut(settings.focus.on);
    } else if (stats?.active) {
      await api("/timer/stop", { method: "POST", body: { note: $("#note").value } });
      toast("Sesión guardada: " + fmtHM((Date.now() - new Date(stats.active.started_at)) / 60000));
      runShortcut(settings.focus.off);
      $("#note").value = "";
    } else {
      await api("/timer/start", { method: "POST", body: { subject: selSubject, note: $("#note").value } });
      runShortcut(settings.focus.on);
    }
    await loadStats();
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
};
async function startPause(minutes) {
  try {
    await api("/timer/pause", { method: "POST", body: { minutes, note: $("#note").value } });
    toast(`Pausa de ${minutes} min. La tarea queda guardada.`);
    runShortcut(settings.focus.off);
    await loadStats();
  } catch (e) { toast(e.message); }
}
async function customPause() {
  const r = await modal("Pausa", `<label>Minutos<input type="number" name="m" min="1" max="240" value="10" required inputmode="numeric"></label>`, [["cancel", "Cancelar"], ["ok", "Empezar pausa", "primary"]]);
  if (r) startPause(Math.round(Number(r.data.m)) || 10);
}
function renderPauseRow() {
  const el = $("#pauseRow");
  if (stats?.pause) {
    el.innerHTML = `<button class="btn" data-ext="5">+5 min</button><button class="btn" data-ext="10">+10 min</button><button class="btn" id="endPause">Terminar sesión</button>`;
    el.querySelectorAll("[data-ext]").forEach(b => b.onclick = async () => { await api("/timer/pause/extend", { method: "POST", body: { minutes: +b.dataset.ext } }); pauseAlerted = false; loadStats(); });
    $("#endPause").onclick = async () => { await api("/timer/pause/end", { method: "POST" }); $("#note").value = ""; toast("Sesión terminada"); loadStats(); };
  } else if (stats?.active) {
    el.innerHTML = `<span class="lbl">Pausa:</span>${[5, 10, 15].map(m => `<button class="btn" data-p="${m}">${m} min</button>`).join("")}<button class="btn" id="pCustom">Otra…</button>`;
    el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => startPause(+b.dataset.p));
    $("#pCustom").onclick = customPause;
  } else el.innerHTML = "";
}

let noteT; $("#note").oninput = () => { clearTimeout(noteT); if (stats?.active) noteT = setTimeout(() => api(`/sessions/${stats.active.id}`, { method: "PATCH", body: { note: $("#note").value } }), 700); };

async function loadStats() {
  try { stats = await api("/stats"); } catch { return; }
  stats._fetched = Date.now(); stats._serverNow = new Date(stats.now).getTime();
  if (stats.active) { selSubject = stats.active.subject; if (document.activeElement !== $("#note")) $("#note").value = stats.active.note || ""; }
  if (stats.pause) { selSubject = stats.pause.subject; if (document.activeElement !== $("#note")) $("#note").value = stats.pause.note || ""; }
  renderChips(); renderStats(); renderPauseRow(); tick();
}
function nowMs() { return stats ? stats._serverNow + (Date.now() - stats._fetched) : Date.now(); }
let lastPhase = null, pauseAlerted = false;
function tick() {
  if (!stats) return;
  const a = stats.active, card = $("#timerCard"), btn = $("#startBtn"), p = stats.pause;
  card.classList.toggle("running", !!a); card.classList.toggle("paused", !!p);
  btn.textContent = p ? "Reanudar" : a ? "Parar" : "Empezar"; btn.classList.toggle("stop", !!a); btn.classList.toggle("resume", !!p);
  $("#clock").classList.remove("over");
  if (p) {
    const total = new Date(p.until) - new Date(p.started_at), left = new Date(p.until) - nowMs();
    const s = Math.abs(Math.round(left / 1000));
    $("#clock").textContent = (left < 0 ? "+" : "") + `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    $("#clock").classList.toggle("over", left < 0);
    $("#clockSub").textContent = left < 0 ? "Pausa terminada · vuelve cuando quieras" : `Pausa · luego: ${p.note || p.subject}`;
    $("#ringFg").style.stroke = "#e8a33d";
    $("#ringFg").style.strokeDashoffset = 553 * Math.min(1, Math.max(0, 1 - left / total));
    if (left <= 0 && !pauseAlerted) { pauseAlerted = true; beep(); setTimeout(beep, 700); navigator.vibrate?.([300, 200, 300]); toast("¡Se acabó la pausa! Dale a Reanudar."); }
    if (left > 0) pauseAlerted = false;
    $("#focusHint").textContent = settings.focus?.enabled ? `Al reanudar se activa «${settings.focus.on}»` : "";
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
  $("#focusHint").textContent = settings.focus?.enabled ? (a ? `Al parar: «${settings.focus.off}»` : `Al empezar se activa «${settings.focus.on}»`) : "";
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

async function loadBoard() { board = await api(`/boards/${boardId}`); renderBoard(); }
function renderBoard() {
  const el = $("#board"); const today = startOfDay();
  el.innerHTML = board.lists.map(l => `
    <div class="list" data-id="${l.id}">
      <div class="list-h"><input value="${esc(l.name)}" data-list="${l.id}"><button class="icon-btn" data-del-list="${l.id}" title="Borrar lista">×</button></div>
      <div class="cards" data-list="${l.id}">${l.cards.map(c => cardHTML(c, today)).join("")}</div>
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
  $$(".kcard").forEach(c => c.onclick = () => editCard(+c.dataset.id));

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
  return `<div class="kcard" data-id="${c.id}">${c.label ? `<div class="lbl" style="background:${esc(c.label)}"></div>` : ""}${esc(c.title)}
    ${(due || c.description) ? `<div class="meta">${due ? `<span class="${late ? "late" : ""}">📅 ${fmtDate(due)}</span>` : ""}${c.description ? "<span>☰</span>" : ""}</div>` : ""}</div>`;
}
function addCardInline(btn) {
  const listId = btn.dataset.add, wrap = document.createElement("div");
  wrap.innerHTML = `<textarea rows="2" placeholder="Título de la tarjeta… (Enter para añadir)"></textarea>`;
  btn.replaceWith(wrap); const ta = wrap.querySelector("textarea"); ta.focus();
  let finished = false;
  const done = async save => {
    if (finished) return; finished = true;
    const t = ta.value.trim();
    if (save && t) { await api("/cards", { method: "POST", body: { list_id: listId, title: t } }); await loadBoard(); const nb = $(`[data-add="${listId}"]`); if (nb) addCardInline(nb); }
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
    <label>Etiqueta<input type="hidden" name="label" value="${esc(c.label || "")}" id="lblIn"><div class="labels">${LABELS.map(x => `<button type="button" data-c="${x}" class="${x === c.label ? "on" : ""}" style="background:${x}"></button>`).join("")}<button type="button" data-c="" style="background:var(--soft)" class="${!c.label ? "on" : ""}" title="Sin etiqueta"></button></div></label>`,
    undefined, ["delete", "Borrar"]);
  if (!r) return;
  if (r.action === "delete") await api(`/cards/${id}`, { method: "DELETE" });
  else {
    const body = { title: r.data.title, description: r.data.description, due: r.data.due || null, label: r.data.label || null };
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
let tasks = [];
async function loadTasks() {
  tasks = await api("/tasks");
  const f = $("#taskFilter"), cur = f.value;
  f.innerHTML = `<option value="">Todas</option>` + settings.subjects.map(s => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
  try { $("#showCitas").checked = localStorage.getItem("uni:citas") === "1"; } catch { }
  renderTasks();
  const s = settings;
  $("#iliasInfo").textContent = !s.ilias_url ? "ILIAS sin conectar: pega tu enlace iCal en Ajustes." :
    s.ilias_last_error ? "⚠️ Última sincronización falló: " + s.ilias_last_error :
    s.ilias_last_sync ? "ILIAS sincronizado " + new Date(s.ilias_last_sync).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
}
$("#showCitas").onchange = () => { try { localStorage.setItem("uni:citas", $("#showCitas").checked ? "1" : "0"); } catch { } renderTasks(); };
$("#taskFilter").onchange = renderTasks;
function renderTasks() {
  const showCitas = $("#showCitas").checked, sub = $("#taskFilter").value;
  const now = new Date(), t0 = startOfDay(), wEnd = new Date(t0.getTime() + 7 * 864e5);
  const list = tasks.filter(t => (showCitas || t.kind !== "cita") && (!sub || t.subject === sub));
  const groups = [["Vencidas", t => !t.done && t.due && new Date(t.due) < t0], ["Hoy", t => !t.done && t.due && new Date(t.due) >= t0 && new Date(t.due) < new Date(t0.getTime() + 864e5)],
    ["Próximos 7 días", t => !t.done && t.due && new Date(t.due) >= new Date(t0.getTime() + 864e5) && new Date(t.due) < wEnd], ["Más adelante", t => !t.done && t.due && new Date(t.due) >= wEnd],
    ["Sin fecha", t => !t.done && !t.due], ["Hechas", t => t.done]];
  const html = groups.map(([name, fn]) => { const items = list.filter(fn); if (!items.length) return ""; if (name === "Hechas") items.splice(15); return `<div class="tgroup"><h3>${name} · ${items.length}</h3>${items.map(taskHTML).join("")}</div>`; }).join("");
  $("#tasks").innerHTML = html || `<p class="muted">No hay tareas. Añade una o conecta ILIAS en Ajustes.</p>`;
  $$("#tasks .task input").forEach(i => i.onchange = async () => { await api(`/tasks/${i.dataset.id}`, { method: "PATCH", body: { done: i.checked } }); const t = tasks.find(x => x.id == i.dataset.id); t.done = i.checked; renderTasks(); });
  $$("#tasks .task .body").forEach(b => b.onclick = () => editTask(tasks.find(x => x.id == b.dataset.id)));
}
function taskHTML(t) {
  const late = !t.done && t.due && new Date(t.due) < new Date();
  const due = t.due ? new Date(t.due) : null;
  const dueTxt = due ? fmtDate(due) + (due.getHours() || due.getMinutes() ? " " + fmtTime(due) : "") : "";
  return `<div class="task ${t.done ? "done" : ""}"><input type="checkbox" data-id="${t.id}" ${t.done ? "checked" : ""}>
    <div class="body" data-id="${t.id}"><div class="tt">${esc(t.title)}</div><div class="tm">
    ${t.subject ? `<span class="badge" style="background:${col(t.subject)}">${esc(t.subject)}</span>` : ""}
    ${dueTxt ? `<span class="${late ? "late" : ""}">${dueTxt}</span>` : ""}
    ${t.source === "ilias" ? `<span class="badge src">ILIAS${t.kind === "cita" ? " · cita" : ""}</span>` : ""}
    ${t.notes ? "<span>☰</span>" : ""}</div></div></div>`;
}
async function editTask(t = {}) {
  const subOpts = `<option value="">—</option>` + settings.subjects.map(s => `<option ${s === t.subject ? "selected" : ""}>${esc(s)}</option>`).join("");
  const r = await modal(t.id ? "Tarea" : "Nueva tarea", `
    <label>Título<input name="title" value="${esc(t.title || "")}" required></label>
    <div class="row2"><label>Asignatura<select name="subject">${subOpts}</select></label><label>Fecha límite<input type="datetime-local" name="due" value="${t.due ? toLocalInput(t.due) : ""}"></label></div>
    <label>Tipo<select name="kind"><option value="tarea" ${t.kind === "tarea" ? "selected" : ""}>Tarea</option><option value="entrega" ${t.kind === "entrega" ? "selected" : ""}>Entrega</option><option value="cita" ${t.kind === "cita" ? "selected" : ""}>Cita</option></select></label>
    <label>Notas<textarea name="notes" rows="4">${esc(t.notes || "")}</textarea></label>
    ${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener" class="small">Abrir en ILIAS ↗</a>` : ""}`,
    undefined, t.id ? ["delete", t.source === "ilias" ? "Ocultar" : "Borrar"] : null);
  if (!r) return;
  try {
    if (r.action === "delete") await api(`/tasks/${t.id}`, { method: "DELETE" });
    else {
      const body = { title: r.data.title, subject: r.data.subject || null, due: r.data.due ? new Date(r.data.due).toISOString() : null, notes: r.data.notes, kind: r.data.kind };
      await api(t.id ? `/tasks/${t.id}` : "/tasks", { method: t.id ? "PATCH" : "POST", body });
    }
    loadTasks();
  } catch (e) { toast(e.message); }
}
$("#newTask").onclick = () => editTask({ kind: "tarea" });
$("#syncIlias").onclick = async () => {
  try { const r = await api("/ilias/sync", { method: "POST" }); settings = await api("/settings"); toast(r.skipped ? "Primero pega el enlace iCal en Ajustes" : `ILIAS: ${r.added} nuevas, ${r.updated} actualizadas`); loadTasks(); }
  catch (e) { settings = await api("/settings"); toast(e.message); loadTasks(); }
};

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
