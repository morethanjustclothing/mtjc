import { CONFIG, isRequestOnly, keyOf, fmtDur, fmtRange, fmtDate, fmtCode } from "./config.mjs";
import { makeCalendar, today } from "./calendar.mjs";

const $ = id => document.getElementById(id);
const KEY = "mtjc-owner";
const local = {
  get() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; } },
  set(v, remember) { try { (remember ? localStorage : sessionStorage).setItem(KEY, v); } catch {} },
  clear() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch {} }
};

const state = { key: local.get(), requests: [], blocked: {}, taken: {}, filter: "pending", busy: false, reviews: [], invites: [], revFilter: "pending" };
const reviewUrl = code => `${location.origin}/review?code=${fmtCode(code)}`;

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
  $("loginView").hidden = false; $("dash").hidden = true; $("revDash").hidden = true; $("signOut").hidden = true;
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
  if (r.status === "approved") {
    const rmsg = `Hi ${r.name.split(" ")[0]}, thanks for visiting ${CONFIG.name}! If you have a minute, I'd love a review: ${reviewUrl(r.code)}`;
    reach.append(
      link("Text review link", `sms:${digits}?&body=${encodeURIComponent(rmsg)}`),
      btn("Copy review link", async () => { try { await navigator.clipboard.writeText(rmsg); toast("Review message copied."); } catch { toast(reviewUrl(r.code)); } })
    );
  }
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
  $("loginView").hidden = true; $("dash").hidden = false; $("revDash").hidden = false; $("signOut").hidden = false;
  load(); loadReviews(); clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden && state.key) { load(); loadReviews(); } }, 30000);
}
if (state.key) {
  fetch("/api/owner/check", { headers: { "x-owner-key": state.key }, cache: "no-store" })
    .then(r => r.ok ? start() : r.status === 401 ? signOut("Please sign in again.") : r.json().then(d => showLogin(d.error)))
    .catch(() => showLogin("Couldn't reach the site. Check your connection."));
} else showLogin();

/* ---------- reviews ---------- */
async function loadReviews() {
  try {
    const d = await api("reviews");
    state.reviews = d.reviews; state.invites = d.invites;
    renderReviews();
  } catch (e) { if (e.status) $("revList").textContent = e.message; }
}
document.querySelectorAll("#revTabs button").forEach(b => b.onclick = () => {
  state.revFilter = b.dataset.f;
  document.querySelectorAll("#revTabs button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderReviews();
});
function stars(n) {
  const s = document.createElement("span"); s.className = "starline"; s.setAttribute("aria-label", `${n} out of 5 stars`);
  s.innerHTML = "★".repeat(n) + `<span class="dim">${"★".repeat(5 - n)}</span>`; return s;
}
function renderReviews() {
  const pending = state.reviews.filter(r => r.status === "pending").length;
  $("revTabs").querySelector('[data-f="pending"]').textContent = pending ? `Waiting for you (${pending})` : "Waiting for you";
  const f = state.revFilter;
  if (f === "links") {
    const list = [...state.invites].sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) { $("revList").innerHTML = '<p class="muted">No unused links. Links disappear from here once someone uses them.</p>'; return; }
    $("revList").replaceChildren(...list.map(inv => {
      const c = document.createElement("div"); c.className = "req";
      const t = document.createElement("strong"); t.textContent = inv.label || "Review link";
      const m = document.createElement("span"); m.className = "muted";
      m.textContent = `Created ${new Date(inv.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      c.append(t, m, linkBox(inv.code));
      const a = document.createElement("div"); a.className = "actions";
      const del = document.createElement("button"); del.className = "btn2 small"; del.textContent = "Cancel link";
      del.onclick = async () => { try { await api("invite-delete", { code: inv.code }); toast("Link cancelled."); loadReviews(); } catch (e) { toast(e.message); } };
      a.append(del); c.append(a);
      return c;
    }));
    return;
  }
  const list = state.reviews.filter(r => r.status === f).sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) {
    $("revList").innerHTML = `<p class="muted">${{ pending: "No new reviews. They show up here when a shopper uses a review link.", published: "No published reviews yet. Published reviews appear at the bottom of the website.", hidden: "No hidden reviews." }[f]}</p>`;
    return;
  }
  $("revList").replaceChildren(...list.map(r => {
    const c = document.createElement("div"); c.className = "req";
    const top = document.createElement("div"); top.className = "top2";
    const who = document.createElement("strong"); who.textContent = r.name;
    top.append(stars(r.rating), who);
    const t = document.createElement("p"); t.textContent = r.text;
    const m = document.createElement("span"); m.className = "muted";
    m.textContent = `Sent ${new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` +
      (r.visitDate ? ` · visit on ${fmtDate(r.visitDate)}` : " · walk-in link");
    const a = document.createElement("div"); a.className = "actions";
    const b = (label, fn) => { const x = document.createElement("button"); x.type = "button"; x.className = "btn2 small"; x.textContent = label; x.onclick = fn; return x; };
    const set = status => async () => { try { await api("review", { code: r.code, status }); toast(status === "published" ? "Published. It's now on the website." : status === "hidden" ? "Hidden from the website." : "Moved back to waiting."); loadReviews(); } catch (e) { toast(e.message); } };
    if (r.status !== "published") a.append(b("Publish", set("published")));
    if (r.status !== "hidden") a.append(b("Hide", set("hidden")));
    const del = b("Delete", () => {
      if (del.dataset.confirm) return api("review-delete", { code: r.code }).then(() => { toast("Review deleted."); loadReviews(); }).catch(e => toast(e.message));
      del.dataset.confirm = "1"; del.textContent = "Tap again to delete"; del.classList.add("err");
      setTimeout(() => { del.dataset.confirm = ""; del.textContent = "Delete"; del.classList.remove("err"); }, 4000);
    });
    del.style.marginLeft = "auto"; a.append(del);
    c.append(top, t, m, a);
    return c;
  }));
}
function linkBox(code) {
  const url = reviewUrl(code);
  const box = document.createElement("div"); box.className = "linkbox";
  const inp = document.createElement("input"); inp.readOnly = true; inp.value = url; inp.setAttribute("aria-label", "Review link"); inp.onclick = () => inp.select();
  const msg = `Thanks for shopping at ${CONFIG.name}! If you have a minute, I'd love a review: ${url}`;
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "btn2 small"; copy.textContent = "Copy link";
  copy.onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { inp.select(); toast("Selected. Press copy on your device."); } };
  const text = document.createElement("a"); text.className = "btn2 small"; text.style.cssText = "text-decoration:none;color:inherit"; text.textContent = "Text it"; text.href = `sms:?&body=${encodeURIComponent(msg)}`;
  const mail = document.createElement("a"); mail.className = "btn2 small"; mail.style.cssText = "text-decoration:none;color:inherit"; mail.textContent = "Email it";
  mail.href = `mailto:?subject=${encodeURIComponent("Thanks for visiting " + CONFIG.name)}&body=${encodeURIComponent(msg)}`;
  box.append(inp, copy, text, mail);
  return box;
}
$("inviteForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const d = await api("invite", { label: $("f-label").value.trim() });
    $("f-label").value = "";
    const out = $("inviteOut"); out.replaceChildren();
    const p = document.createElement("p"); p.className = "muted"; p.style.marginTop = "12px"; p.textContent = "Here's your link. Send it to the shopper:";
    out.append(p, linkBox(d.code));
    loadReviews();
  } catch (err) { toast(err.message); }
});
