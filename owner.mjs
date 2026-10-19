import { CONFIG, isRequestOnly, keyOf, fmtDur, fmtRange, fmtDate, fmtCode } from "./config.mjs";
import { makeCalendar, today } from "./calendar.mjs";

const $ = id => document.getElementById(id);
const KEY = "mtjc-owner";
const local = {
  get() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; } },
  set(v, remember) { try { (remember ? localStorage : sessionStorage).setItem(KEY, v); } catch {} },
  clear() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch {} }
};

const state = { key: local.get(), requests: [], blocked: {}, taken: {}, filter: "pending", busy: false };

async function api(path, body) {
  const r = await fetch("/api/owner/" + path, {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { "x-owner-key": state.key || "", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut("Your password changed or expired. Please sign in again."); throw new Error(d.error); }
  if (!r.ok) { const e = new Error(d.error || "Something went wrong."); e.status = r.status; e.data = d; throw e; }
  return d;
}

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500);
}

/* ---------- sign in ---------- */
function showLogin(msg) {
  $("loginView").hidden = false; $("dash").hidden = true; $("signOut").hidden = true;
  $("loginErr").textContent = msg || ""; $("f-pass").focus();
}
function signOut(msg) { local.clear(); state.key = null; showLogin(msg); }
$("signOut").onclick = () => signOut();

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pass = $("f-pass").value;
  if (!pass) return $("loginErr").textContent = "Enter your password.";
  state.key = pass; $("loginBtn").disabled = true;
  try {
    const r = await fetch("/api/owner/check", { headers: { "x-owner-key": pass }, cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { state.key = null; $("loginErr").textContent = d.error || "Couldn't sign in."; return; }
    local.set(pass, $("f-remember").checked);
    $("f-pass").value = "";
    start();
  } catch { $("loginErr").textContent = "Couldn't reach the site. Check your connection and try again."; }
  finally { $("loginBtn").disabled = false; }
});

/* ---------- calendar ---------- */
const cal = makeCalendar({
  els: { days: $("days"), month: $("monthLabel"), prev: $("prev"), next: $("next"), dows: $("dows") },
  mode: "owner",
  getAvail: () => ({ blocked: state.blocked, taken: state.taken }),
  countFor: k => state.requests.filter(r => r.status === "approved" && r.date === k).length,
  onPick: async k => {
    const closed = !state.blocked[k];
    if (closed) state.blocked[k] = true; else delete state.blocked[k];
    cal.render();
    try {
      const d = await api("block", { date: k, closed });
      state.blocked = d.blocked; cal.render();
      toast(`${fmtDate(k)} ${closed ? "closed" : "reopened"}.`);
    } catch (e) { toast(e.message); load(); }
  }
});

/* ---------- requests ---------- */
async function load() {
  try {
    const d = await api("requests");
    state.requests = d.requests; state.blocked = d.blocked; state.taken = d.taken;
    $("updated").textContent = `Updated ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Refreshes on its own every 30 seconds.`;
    render();
  } catch (e) { if (e.status) $("updated").textContent = e.message; }
}

const isPast = r => r.date < keyOf(today());
function render() {
  cal.render();
  const up = state.requests.filter(r => !isPast(r));
  const n = s => up.filter(r => r.status === s).length;
  $("counts").innerHTML = "";
  for (const [label, v] of [["Pending", n("pending")], ["Upcoming visits", n("approved")]]) {
    const d = document.createElement("div"); d.innerHTML = `<b></b><div class="muted"></div>`;
    d.querySelector("b").textContent = v; d.querySelector("div").textContent = label; $("counts").append(d);
  }
  const f = state.filter;
  let list = f === "past" ? state.requests.filter(isPast) : up.filter(r => r.status === f);
  list.sort((a, b) => f === "past" ? (b.date + b.time).localeCompare(a.date + a.time) : (a.date + a.time).localeCompare(b.date + b.time));
  if (!list.length) {
    const p = document.createElement("p"); p.className = "muted";
    p.textContent = { pending: "No pending requests. New ones show up here as soon as they come in.", approved: "No upcoming approved visits.", declined: "No declined requests.", past: "No past visits yet." }[f];
    $("list").replaceChildren(p); return;
  }
  $("list").replaceChildren(...list.map(card));
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  state.filter = b.dataset.f;
  document.querySelectorAll("#tabs button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  render();
});

function messageFor(r, status, note) {
  const when = `${fmtDate(r.date)}, ${fmtRange(r.time, r.duration)}`;
  const first = r.name.split(" ")[0];
  if (status === "approved") return `Hi ${first}, your visit to ${CONFIG.name} on ${when} is confirmed.${note ? " " + note : ""} I'll send the address and arrival details shortly. Your request code is ${fmtCode(r.code)}.`;
  if (status === "declined") return `Hi ${first}, thanks for your request for ${when}. Unfortunately that time doesn't work.${note ? " " + note : ""} Feel free to request another time on the website.`;
  return `Hi ${first}, this is ${CONFIG.name} about your visit request for ${when}.`;
}

function card(r) {
  const c = document.createElement("div"); c.className = "req";
  const top = document.createElement("div"); top.className = "top2";
  const w = document.createElement("span"); w.className = "when"; w.textContent = `${fmtDate(r.date)} · ${fmtRange(r.time, r.duration)}`;
  const p = document.createElement("span"); p.className = "pill " + r.status; p.textContent = r.status;
  top.append(w, p); c.append(top);

  const who = document.createElement("div");
  const nm = document.createElement("strong"); nm.textContent = r.name;
  const meta = document.createElement("span"); meta.className = "muted";
  meta.textContent = ` · ${fmtDur(r.duration)} · ${r.size} ${r.size === "1" ? "person" : "people"} · prefers ${r.contact.toLowerCase()}${isRequestOnly(r.date) ? " · weekend request" : ""}`;
  const contact = document.createElement("div"); contact.className = "muted contact-line"; contact.textContent = `${r.phone} · ${r.email}`;
  const sent = document.createElement("div"); sent.className = "muted";
  sent.textContent = `Code ${fmtCode(r.code)} · sent ${new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  who.append(nm, meta, contact, sent); c.append(who);
  if (r.notes) { const n = document.createElement("p"); n.className = "muted"; n.textContent = `“${r.notes}”`; c.append(n); }

  const a = document.createElement("div"); a.className = "actions";
  const ta = document.createElement("textarea"); ta.rows = 1; ta.id = "note-" + r.code; ta.value = r.ownerNote || "";
  ta.placeholder = "Note they'll see (optional), e.g. “Can you do 2 PM instead?”";
  const btn = (label, fn, disabled) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn2 small"; b.textContent = label; b.disabled = !!disabled; b.onclick = fn; return b; };
  a.append(ta,
    btn(r.status === "approved" ? "Approved" : "Approve", () => decide(r, "approved", ta.value), r.status === "approved"),
    btn(r.status === "declined" ? "Declined" : "Decline", () => decide(r, "declined", ta.value), r.status === "declined"));
  if (r.status !== "pending") a.append(btn("Back to pending", () => decide(r, "pending", ta.value)));
  c.append(a);

  // reach out
  const reach = document.createElement("div"); reach.className = "actions";
  const msg = messageFor(r, r.status, r.ownerNote);
  const digits = r.phone.replace(/[^\d+]/g, "");
  const link = (label, href) => { const l = document.createElement("a"); l.className = "btn2 small"; l.style.textDecoration = "none"; l.style.color = "inherit"; l.textContent = label; l.href = href; return l; };
  reach.append(
    link("Text", `sms:${digits}?&body=${encodeURIComponent(msg)}`),
    link("Call", `tel:${digits}`),
    link("Email", `mailto:${r.email}?subject=${encodeURIComponent(`Your visit to ${CONFIG.name}`)}&body=${encodeURIComponent(msg)}`),
    btn("Copy message", async ev => {
      try { await navigator.clipboard.writeText(msg); toast("Message copied."); } catch { toast(msg); }
    })
  );
  const del = btn("Delete", () => {
    if (del.dataset.confirm) return remove(r);
    del.dataset.confirm = "1"; del.textContent = "Tap again to delete"; del.classList.add("err");
    setTimeout(() => { del.dataset.confirm = ""; del.textContent = "Delete"; del.classList.remove("err"); }, 4000);
  });
  del.style.marginLeft = "auto";
  reach.append(del);
  c.append(reach);
  return c;
}

async function decide(r, status, note, force) {
  try {
    await api("decide", { code: r.code, status, note, force });
    toast(status === "approved" ? `Approved ${r.name}. Use Text or Email to let them know.` : status === "declined" ? `Declined ${r.name}.` : "Moved back to pending.");
    await load();
  } catch (e) {
    if (e.data?.conflict) {
      toast(e.message + " Decline the other one first, or tap Approve again to double-book.");
      if (decide.pending === r.code) { decide.pending = null; return decide(r, status, note, true); }
      decide.pending = r.code; setTimeout(() => { decide.pending = null; }, 6000);
    } else toast(e.message);
  }
}
async function remove(r) {
  try { await api("delete", { code: r.code }); toast("Request deleted."); load(); } catch (e) { toast(e.message); }
}

/* ---------- start ---------- */
let timer;
function start() {
  $("loginView").hidden = true; $("dash").hidden = false; $("signOut").hidden = false;
  load(); clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && state.key) load(); }, 30000);
}
if (state.key) {
  fetch("/api/owner/check", { headers: { "x-owner-key": state.key }, cache: "no-store" })
    .then(r => r.ok ? start() : r.status === 401 ? signOut("Please sign in again.") : r.json().then(d => showLogin(d.error)))
    .catch(() => showLogin("Couldn't reach the site. Check your connection."));
} else showLogin();
