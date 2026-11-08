// Uni App — cronómetro de estudio, tablero y tareas (ILIAS) para WS 2026/27
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");
const { parseICS, classify } = require("./ics");
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require("@simplewebauthn/server");

const PORT = process.env.PORT || 3000;
const TZ = "Europe/Berlin";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
let SECRET = process.env.SESSION_SECRET || null; // si no se define, se genera una vez y se guarda en la base de datos
const API_TOKEN = process.env.API_TOKEN || "";
const PROD = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;

if (!process.env.DATABASE_URL) { console.error("Falta DATABASE_URL"); process.exit(1); }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
});
const q = (text, params) => pool.query(text, params);

// ---------- Esquema ----------
async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY, subject TEXT NOT NULL DEFAULT 'Otro', note TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ);
  CREATE TABLE IF NOT EXISTS boards (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, position INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS lists (
    id SERIAL PRIMARY KEY, board_id INT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL, position INT NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY, list_id INT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', label TEXT, due DATE,
    position INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY, source TEXT NOT NULL DEFAULT 'manual', ext_uid TEXT UNIQUE,
    kind TEXT NOT NULL DEFAULT 'tarea', title TEXT NOT NULL, subject TEXT, due TIMESTAMPTZ,
    notes TEXT NOT NULL DEFAULT '', link TEXT, done BOOLEAN NOT NULL DEFAULT false,
    hidden BOOLEAN NOT NULL DEFAULT false, edited BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY, public_key BYTEA NOT NULL, counter BIGINT NOT NULL DEFAULT 0, transports JSONB,
    name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used TIMESTAMPTZ);
  CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at);
  `);
  if (!SECRET) {
    const r = await q("SELECT value FROM settings WHERE key='_secret'");
    if (r.rows[0]) SECRET = r.rows[0].value;
    else { SECRET = crypto.randomBytes(32).toString("hex"); await q("INSERT INTO settings(key,value) VALUES ('_secret',$1)", [JSON.stringify(SECRET)]); }
  }
  // Recuperación: con PASSKEY_RESET=1 se borran los passkeys al arrancar (quítala después de registrar el nuevo)
  if (process.env.PASSKEY_RESET === "1") { await q("DELETE FROM passkeys"); console.warn("PASSKEY_RESET: passkeys borrados"); }
  await refreshPasskeyCount();
  const { rows } = await q("SELECT count(*)::int AS n FROM boards");
  if (rows[0].n === 0) {
    const b = await q("INSERT INTO boards(name) VALUES ('Uni') RETURNING id");
    let i = 0;
    for (const n of ["Por hacer", "Haciendo", "Hecho"]) await q("INSERT INTO lists(board_id,name,position) VALUES ($1,$2,$3)", [b.rows[0].id, n, i++]);
  }
}

const DEFAULT_SETTINGS = {
  targets: { SuS: 10, EEN: 5.5, HEF: 4, MSUP: 10 },
  subjects: ["SuS", "EEN", "HEF", "MSUP", "Otro"],
  focus: { enabled: true, on: "Universidad ON", off: "Universidad OFF" },
  pomodoro: { enabled: false, work: 50, rest: 10 },
  ilias_url: process.env.ILIAS_ICAL_URL || "",
  ilias_last_sync: null, ilias_last_error: null,
  exams: [{ subject: "EEN", date: "2027-03-03" }, { subject: "SuS", date: "2027-03-17" }, { subject: "HEF", date: "2027-03-24" }],
};
async function getSettings() {
  const { rows } = await q("SELECT key, value FROM settings");
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) if (!r.key.startsWith("_")) s[r.key] = r.value;
  return s;
}
async function setSetting(key, value) {
  await q("INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(value)]);
}

// ---------- Fechas en Europe/Berlin ----------
function tzOffsetMin(date) {
  const a = new Date(date.toLocaleString("en-US", { timeZone: TZ }));
  const b = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return (a - b) / 60000;
}
function berlinYMD(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) };
}
function berlinMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMin(new Date(guess)) * 60000);
}
function dayStart(date = new Date()) { const { y, m, d } = berlinYMD(date); return berlinMidnight(y, m, d); }
function weekStart(date = new Date()) { const { y, m, d, wd } = berlinYMD(date); return berlinMidnight(y, m, d - wd); }

// ---------- Auth ----------
const sign = v => v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
function verify(tok) {
  if (!tok || !tok.includes(".")) return false;
  const v = tok.slice(0, tok.lastIndexOf("."));
  const a = Buffer.from(sign(v)), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}
let passkeyCount = 0;
async function refreshPasskeyCount() { passkeyCount = (await q("SELECT count(*)::int AS n FROM passkeys")).rows[0].n; }
// Hace falta identificarse si hay contraseña o si ya hay algún passkey registrado
const authRequired = () => !!APP_PASSWORD || passkeyCount > 0;
function authed(req) {
  if (!authRequired()) return true;
  const h = req.headers.authorization || "";
  if (API_TOKEN && h === "Bearer " + API_TOKEN) return true;
  return verify(cookies(req).uni);
}
function setSessionCookie(res) {
  const tok = sign("u:" + Date.now());
  res.setHeader("Set-Cookie", `uni=${encodeURIComponent(tok)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${PROD ? "; Secure" : ""}`);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });

app.post("/api/login", (req, res) => {
  const pw = String(req.body?.password || "");
  const ok = APP_PASSWORD && pw.length === APP_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(APP_PASSWORD));
  if (!ok) return res.status(401).json({ error: "Contraseña incorrecta" });
  setSessionCookie(res); res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { res.setHeader("Set-Cookie", "uni=; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/me", (req, res) => res.json({ authed: authed(req), hasPasskeys: passkeyCount > 0, hasPassword: !!APP_PASSWORD }));

// ---------- Passkeys (Face ID / Touch ID) ----------
const challenges = new Map(); // nonce -> {challenge, exp}
function rp(req) { const host = req.get("host"); return { rpID: host.split(":")[0], origin: `${req.protocol}://${host}` }; }
function saveChallenge(res, challenge) {
  const nonce = crypto.randomBytes(16).toString("hex");
  challenges.set(nonce, { challenge, exp: Date.now() + 5 * 60e3 });
  for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k);
  res.setHeader("Set-Cookie", `unichal=${nonce}; Path=/api/passkey; Max-Age=300; HttpOnly; SameSite=Strict${PROD ? "; Secure" : ""}`);
}
function takeChallenge(req) {
  const n = cookies(req).unichal; const c = n && challenges.get(n); if (n) challenges.delete(n);
  return c && c.exp > Date.now() ? c.challenge : null;
}
async function allCreds() {
  return (await q("SELECT * FROM passkeys")).rows.map(r => ({ id: r.id, publicKey: new Uint8Array(r.public_key), counter: Number(r.counter), transports: r.transports || undefined }));
}
app.post("/api/passkey/register/options", wrap(async (req, res) => {
  // El primer passkey se puede crear sin estar dentro; los siguientes, solo con sesión iniciada
  if (passkeyCount > 0 && !authed(req)) return res.status(401).json({ error: "No autorizado" });
  const { rpID } = rp(req);
  const opts = await generateRegistrationOptions({
    rpName: "Uni", rpID, userName: "enrique", userDisplayName: "Enrique",
    attestationType: "none",
    excludeCredentials: (await allCreds()).map(c => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  saveChallenge(res, opts.challenge); res.json(opts);
}));
app.post("/api/passkey/register/verify", wrap(async (req, res) => {
  if (passkeyCount > 0 && !authed(req)) return res.status(401).json({ error: "No autorizado" });
  const expectedChallenge = takeChallenge(req); if (!expectedChallenge) return res.status(400).json({ error: "El reto caducó, vuelve a intentarlo" });
  const { rpID, origin } = rp(req);
  const v = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!v.verified) return res.status(400).json({ error: "No se pudo verificar" });
  const c = v.registrationInfo.credential;
  await q("INSERT INTO passkeys(id, public_key, counter, transports, name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
    [c.id, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports || []), String(req.body.name || "Dispositivo").slice(0, 60)]);
  await refreshPasskeyCount(); setSessionCookie(res); res.json({ ok: true });
}));
app.post("/api/passkey/login/options", wrap(async (req, res) => {
  const { rpID } = rp(req);
  const opts = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: (await allCreds()).map(c => ({ id: c.id, transports: c.transports })) });
  saveChallenge(res, opts.challenge); res.json(opts);
}));
app.post("/api/passkey/login/verify", wrap(async (req, res) => {
  const expectedChallenge = takeChallenge(req); if (!expectedChallenge) return res.status(400).json({ error: "El reto caducó, vuelve a intentarlo" });
  const cred = (await allCreds()).find(c => c.id === req.body.response?.id);
  if (!cred) return res.status(401).json({ error: "Este dispositivo no está registrado" });
  const { rpID, origin } = rp(req);
  const v = await verifyAuthenticationResponse({ response: req.body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, credential: cred, requireUserVerification: true });
  if (!v.verified) return res.status(401).json({ error: "No se pudo verificar" });
  await q("UPDATE passkeys SET counter=$1, last_used=now() WHERE id=$2", [v.authenticationInfo.newCounter, cred.id]);
  setSessionCookie(res); res.json({ ok: true });
}));

app.use("/api", (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "No autorizado" })));
app.get("/api/passkeys", wrap(async (req, res) => res.json((await q("SELECT id, name, created_at, last_used FROM passkeys ORDER BY created_at")).rows)));
app.delete("/api/passkeys/:id", wrap(async (req, res) => {
  if (passkeyCount <= 1) return res.status(400).json({ error: "No puedes borrar el último dispositivo" });
  await q("DELETE FROM passkeys WHERE id=$1", [req.params.id]); await refreshPasskeyCount(); res.json({ ok: true });
}));

// ---------- Cronómetro / sesiones ----------
const minutes = (r, now) => Math.max(0, ((r.ended_at ? new Date(r.ended_at) : now) - new Date(r.started_at)) / 60000);

app.get("/api/stats", wrap(async (req, res) => {
  const now = new Date(), ws = weekStart(now), ds = dayStart(now);
  const settings = await getSettings();
  const { rows } = await q("SELECT * FROM sessions WHERE started_at >= $1 OR ended_at IS NULL ORDER BY started_at", [ws]);
  const week = {}; let today = 0; const perDay = [0, 0, 0, 0, 0, 0, 0];
  for (const r of rows) {
    const m = minutes(r, now);
    week[r.subject] = (week[r.subject] || 0) + m;
    if (new Date(r.started_at) >= ds) today += m;
    const wd = berlinYMD(new Date(r.started_at)).wd; perDay[wd] += m;
  }
  const active = rows.find(r => !r.ended_at) || null;
  const todaySessions = rows.filter(r => new Date(r.started_at) >= ds);
  const { rows: streakRows } = await q(`SELECT DISTINCT (started_at AT TIME ZONE '${TZ}')::date AS d FROM sessions WHERE started_at > now() - interval '120 days' ORDER BY d DESC`);
  let streak = 0; const days = new Set(streakRows.map(r => r.d.toISOString().slice(0, 10)));
  for (let i = 0; i < 120; i++) {
    const { y, m, d } = berlinYMD(new Date(now.getTime() - i * 864e5));
    const k = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (days.has(k)) streak++; else if (i > 0) break;
  }
  res.json({ now, active, today, week, perDay, todaySessions, targets: settings.targets, streak });
}));

app.get("/api/sessions", wrap(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : weekStart();
  const { rows } = await q("SELECT * FROM sessions WHERE started_at >= $1 ORDER BY started_at DESC LIMIT 500", [from]);
  res.json(rows);
}));
app.post("/api/timer/start", wrap(async (req, res) => {
  await q("UPDATE sessions SET ended_at = now() WHERE ended_at IS NULL");
  const { rows } = await q("INSERT INTO sessions(subject,note) VALUES ($1,$2) RETURNING *", [req.body.subject || "Otro", req.body.note || ""]);
  res.json(rows[0]);
}));
app.post("/api/timer/stop", wrap(async (req, res) => {
  const { rows } = await q("UPDATE sessions SET ended_at = now(), note = COALESCE($1, note) WHERE ended_at IS NULL RETURNING *", [req.body?.note ?? null]);
  res.json(rows[0] || null);
}));
app.post("/api/sessions", wrap(async (req, res) => {
  const { subject, note, started_at, ended_at } = req.body;
  const { rows } = await q("INSERT INTO sessions(subject,note,started_at,ended_at) VALUES ($1,$2,$3,$4) RETURNING *", [subject || "Otro", note || "", started_at, ended_at]);
  res.json(rows[0]);
}));
app.patch("/api/sessions/:id", wrap(async (req, res) => {
  const f = pick(req.body, ["subject", "note", "started_at", "ended_at"]);
  res.json(await update("sessions", req.params.id, f));
}));
app.delete("/api/sessions/:id", wrap(async (req, res) => { await q("DELETE FROM sessions WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));

// ---------- Helpers CRUD ----------
function pick(o, keys) { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k] === "" && ["due", "label", "link", "subject"].includes(k) ? null : o[k]; return r; }
async function update(table, id, f) {
  const ks = Object.keys(f); if (!ks.length) return (await q(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0];
  const sets = ks.map((k, i) => `${k}=$${i + 2}`).join(",");
  return (await q(`UPDATE ${table} SET ${sets} WHERE id=$1 RETURNING *`, [id, ...ks.map(k => f[k])])).rows[0];
}

// ---------- Tableros ----------
app.get("/api/boards", wrap(async (req, res) => res.json((await q("SELECT * FROM boards ORDER BY position, id")).rows)));
app.post("/api/boards", wrap(async (req, res) => {
  const b = (await q("INSERT INTO boards(name,position) VALUES ($1,(SELECT COALESCE(max(position),0)+1 FROM boards)) RETURNING *", [req.body.name || "Nuevo tablero"])).rows[0];
  let i = 0; for (const n of ["Por hacer", "Haciendo", "Hecho"]) await q("INSERT INTO lists(board_id,name,position) VALUES ($1,$2,$3)", [b.id, n, i++]);
  res.json(b);
}));
app.patch("/api/boards/:id", wrap(async (req, res) => res.json(await update("boards", req.params.id, pick(req.body, ["name", "position"])))));
app.delete("/api/boards/:id", wrap(async (req, res) => { await q("DELETE FROM boards WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));
app.get("/api/boards/:id", wrap(async (req, res) => {
  const board = (await q("SELECT * FROM boards WHERE id=$1", [req.params.id])).rows[0];
  if (!board) return res.status(404).json({ error: "No existe" });
  const lists = (await q("SELECT * FROM lists WHERE board_id=$1 ORDER BY position, id", [board.id])).rows;
  const cards = (await q("SELECT c.* FROM cards c JOIN lists l ON l.id=c.list_id WHERE l.board_id=$1 ORDER BY c.position, c.id", [board.id])).rows;
  for (const l of lists) l.cards = cards.filter(c => c.list_id === l.id);
  res.json({ ...board, lists });
}));
app.post("/api/boards/:id/order", wrap(async (req, res) => {
  const ids = req.body.list_ids || [];
  for (let i = 0; i < ids.length; i++) await q("UPDATE lists SET position=$1 WHERE id=$2 AND board_id=$3", [i, ids[i], req.params.id]);
  res.json({ ok: true });
}));
app.post("/api/lists", wrap(async (req, res) => res.json((await q("INSERT INTO lists(board_id,name,position) VALUES ($1,$2,(SELECT COALESCE(max(position),0)+1 FROM lists WHERE board_id=$1)) RETURNING *", [req.body.board_id, req.body.name || "Lista"])).rows[0])));
app.patch("/api/lists/:id", wrap(async (req, res) => res.json(await update("lists", req.params.id, pick(req.body, ["name"])))));
app.delete("/api/lists/:id", wrap(async (req, res) => { await q("DELETE FROM lists WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));
app.post("/api/lists/:id/order", wrap(async (req, res) => {
  const ids = req.body.card_ids || [];
  for (let i = 0; i < ids.length; i++) await q("UPDATE cards SET position=$1, list_id=$2 WHERE id=$3", [i, req.params.id, ids[i]]);
  res.json({ ok: true });
}));
app.post("/api/cards", wrap(async (req, res) => res.json((await q("INSERT INTO cards(list_id,title,position) VALUES ($1,$2,(SELECT COALESCE(max(position),0)+1 FROM cards WHERE list_id=$1)) RETURNING *", [req.body.list_id, req.body.title || "Tarjeta"])).rows[0])));
app.patch("/api/cards/:id", wrap(async (req, res) => res.json(await update("cards", req.params.id, pick(req.body, ["title", "description", "label", "due", "list_id", "position"])))));
app.delete("/api/cards/:id", wrap(async (req, res) => { await q("DELETE FROM cards WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));

// ---------- Tareas ----------
app.get("/api/tasks", wrap(async (req, res) => res.json((await q("SELECT * FROM tasks WHERE hidden=false ORDER BY done, due NULLS LAST, id")).rows)));
app.post("/api/tasks", wrap(async (req, res) => {
  const f = pick(req.body, ["title", "subject", "due", "notes", "link", "kind", "source", "ext_uid"]);
  f.title = f.title || "Tarea";
  const ks = Object.keys(f);
  const sql = `INSERT INTO tasks(${ks.join(",")}) VALUES (${ks.map((_, i) => "$" + (i + 1)).join(",")})
    ON CONFLICT (ext_uid) DO UPDATE SET title=CASE WHEN tasks.edited THEN tasks.title ELSE EXCLUDED.title END RETURNING *`;
  res.json((await q(sql, ks.map(k => f[k]))).rows[0]);
}));
app.patch("/api/tasks/:id", wrap(async (req, res) => {
  const f = pick(req.body, ["title", "subject", "due", "notes", "link", "done", "hidden", "kind"]);
  if (["title", "subject", "due", "notes", "kind"].some(k => k in f)) f.edited = true;
  res.json(await update("tasks", req.params.id, f));
}));
app.delete("/api/tasks/:id", wrap(async (req, res) => {
  // Las de ILIAS se ocultan (para que no vuelvan en la próxima sincronización)
  await q("UPDATE tasks SET hidden=true WHERE id=$1 AND ext_uid IS NOT NULL", [req.params.id]);
  await q("DELETE FROM tasks WHERE id=$1 AND ext_uid IS NULL", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- ILIAS (iCal) ----------
async function syncIlias() {
  const s = await getSettings();
  if (!s.ilias_url) return { skipped: true };
  try {
    const r = await fetch(s.ilias_url, { headers: { "User-Agent": "uni-app/1.0" } });
    if (!r.ok) throw new Error("ILIAS respondió " + r.status);
    const events = parseICS(await r.text());
    const from = Date.now() - 2 * 864e5, to = Date.now() + 150 * 864e5;
    let added = 0, updated = 0;
    for (const ev of events) {
      if (!ev.start || ev.start < from || ev.start > to) continue;
      const { kind, subject } = classify(ev);
      const uid = "ilias:" + ev.uid + ":" + ev.start;
      const due = new Date(ev.end && kind === "entrega" ? ev.end : ev.start);
      const r2 = await q(`INSERT INTO tasks(source,ext_uid,kind,title,subject,due,notes,link)
        VALUES ('ilias',$1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (ext_uid) DO UPDATE SET
          title = CASE WHEN tasks.edited THEN tasks.title ELSE EXCLUDED.title END,
          due = CASE WHEN tasks.edited THEN tasks.due ELSE EXCLUDED.due END,
          link = COALESCE(EXCLUDED.link, tasks.link)
        RETURNING (xmax = 0) AS inserted`, [uid, kind, ev.summary || "(sin título)", subject, due, ev.description || "", ev.url || null]);
      r2.rows[0].inserted ? added++ : updated++;
    }
    await setSetting("ilias_last_sync", new Date().toISOString());
    await setSetting("ilias_last_error", null);
    return { added, updated, total: events.length };
  } catch (e) {
    await setSetting("ilias_last_error", e.message);
    throw e;
  }
}
app.post("/api/ilias/sync", wrap(async (req, res) => res.json(await syncIlias())));

// ---------- Ajustes ----------
app.get("/api/settings", wrap(async (req, res) => res.json(await getSettings())));
app.put("/api/settings", wrap(async (req, res) => {
  for (const k of ["targets", "subjects", "focus", "pomodoro", "ilias_url", "exams"]) if (req.body[k] !== undefined) await setSetting(k, req.body[k]);
  res.json(await getSettings());
}));
app.get("/api/export", wrap(async (req, res) => {
  const out = {};
  for (const t of ["sessions", "boards", "lists", "cards", "tasks"]) out[t] = (await q(`SELECT * FROM ${t}`)).rows;
  out.settings = (await q("SELECT * FROM settings WHERE key NOT LIKE '\\_%'")).rows;
  res.setHeader("Content-Disposition", "attachment; filename=uni-app-export.json");
  res.json(out);
}));

// ---------- Estáticos ----------
app.use("/vendor/webauthn.min.js", (req, res) => res.sendFile(path.join(__dirname, "node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js")));
app.use("/vendor/sortable.min.js", (req, res) => res.sendFile(require.resolve("sortablejs/Sortable.min.js")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: PROD ? "1h" : 0 }));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

migrate().then(() => {
  app.listen(PORT, () => console.log("Uni App en el puerto " + PORT));
  const tick = () => syncIlias().then(r => r.skipped || console.log("ILIAS:", r)).catch(e => console.error("ILIAS:", e.message));
  setTimeout(tick, 5000);
  setInterval(tick, 3 * 3600 * 1000); // cada 3 horas
}).catch(e => { console.error(e); process.exit(1); });
