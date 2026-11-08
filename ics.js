// Parser mínimo de iCalendar (suficiente para el export de ILIAS)
function unfold(text) { return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
function unescape(v) { return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }

function parseDate(value, params) {
  if (!value) return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) { const t = Date.parse(value); return isNaN(t) ? null : t; }
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  if (z) return Date.UTC(+y, mo - 1, +d, +h, +mi, +s);
  // Hora local (TZID o sin zona): se interpreta como Europe/Berlin
  const tz = (params.match(/TZID=([^;:]+)/) || [])[1] || "Europe/Berlin";
  const guess = Date.UTC(+y, mo - 1, +d, +h, +mi, +s);
  let off = 0;
  try {
    const dt = new Date(guess);
    off = (new Date(dt.toLocaleString("en-US", { timeZone: tz })) - new Date(dt.toLocaleString("en-US", { timeZone: "UTC" }))) / 60000;
  } catch { /* zona desconocida */ }
  return guess - off * 60000;
}

function parseICS(text) {
  const lines = unfold(text).split("\n");
  const events = []; let ev = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { ev = {}; continue; }
    if (line === "END:VEVENT") { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const left = line.slice(0, i), value = line.slice(i + 1);
    const [name, ...p] = left.split(";"); const params = p.join(";");
    switch (name.toUpperCase()) {
      case "UID": ev.uid = value; break;
      case "SUMMARY": ev.summary = unescape(value); break;
      case "DESCRIPTION": ev.description = unescape(value); break;
      case "LOCATION": ev.location = unescape(value); break;
      case "URL": ev.url = value; break;
      case "DTSTART": ev.start = parseDate(value, params); ev.allDay = /VALUE=DATE(?!-)/.test(params); break;
      case "DTEND": ev.end = parseDate(value, params); break;
    }
  }
  for (const e of events) if (!e.uid) e.uid = (e.summary || "") + "@" + e.start;
  return events;
}

const SUBJECTS = [
  ["SuS", /signale|\bsus\b|systeme\b/i],
  ["EEN", /energienetz|\been\b/i],
  ["HEF", /hybrid|\bhef\b|\bhev\b|fahrzeug/i],
  ["MSUP", /msup|mechatron|workshop/i],
];
function classify(ev) {
  const t = `${ev.summary || ""} ${ev.description || ""}`;
  const subject = (SUBJECTS.find(([, re]) => re.test(t)) || [null])[0];
  let kind = "cita";
  if (/abgabe|deadline|frist|einreich|submission|due|übungsblatt|aufgabenblatt|hausaufgabe|exercise|assignment|test|quiz|anmeld|klausur|prüfung|exam/i.test(t)) kind = "entrega";
  return { kind, subject };
}

module.exports = { parseICS, classify };
