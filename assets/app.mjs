import {
  CONFIG, ALL_SLOTS, DURATIONS, fits, isRequestOnly, upcomingAway, keyOf,
  fmtTime, fmtDur, fmtRange, fmtDate, fmtCode
} from "./config.mjs";
import { makeCalendar } from "./calendar.mjs";

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const state = { avail: { blocked: {}, taken: {} }, selDay: null, selTime: null, duration: CONFIG.minDuration, online: true };

/* ---------- static text ---------- */
$("brand").textContent = CONFIG.name; $("heroName").textContent = CONFIG.name;
$("foot").textContent = `${CONFIG.name} · By appointment only · ${CONFIG.phone} · ${CONFIG.email}`;
$("hoursText").textContent = `Hours: Mon–Fri, ${fmtTime(CONFIG.openFrom)} – ${fmtTime(CONFIG.openUntil)}. Weekends by request.`;
const durLabel = d => { const h = Math.floor(d / 60), m = d % 60; return [h ? `${h} hour${h > 1 ? "s" : ""}` : "", m ? `${m} minutes` : ""].filter(Boolean).join(" "); };
$("f-dur").replaceChildren(...DURATIONS.map(d => { const o = document.createElement("option"); o.value = d; o.textContent = durLabel(d); return o; }));
try { if (localStorage.getItem("mtjc-owner")) $("ownerBar").hidden = false; } catch {}

/* ---------- away notice ---------- */
(function awayNotice() {
  const away = upcomingAway(keyOf(new Date()));
  if (!away.length) return;
  const n = document.createElement("p"); n.className = "notice"; n.style.marginBottom = "20px";
  n.textContent = away.map(r => r.message).join(" ");
  document.querySelector("#book .book").before(n);
})();

/* ---------- calendar ---------- */
const cal = makeCalendar({
  els: { days: $("days"), month: $("monthLabel"), prev: $("prev"), next: $("next"), dows: $("dows") },
  mode: "visitor",
  getAvail: () => state.avail,
  getSelected: () => state.selDay,
  onPick: selectDay
});

async function loadAvailability() {
  try {
    const r = await fetch("/api/availability", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    state.avail = await r.json(); state.online = true;
  } catch { state.online = false; }
  cal.render(); renderSlots();
}

function selectDay(k) {
  state.selDay = k; state.selTime = null; $("result").replaceChildren();
  $("pickPrompt").hidden = true; $("pickArea").hidden = false; $("reqForm").hidden = false;
  $("pickDate").textContent = fmtDate(k);
  $("wkNote").hidden = !isRequestOnly(k);
  renderSlots(); cal.render();
}

function renderSlots() {
  const k = state.selDay, box = $("slots"); box.replaceChildren();
  if (!k) return;
  if (state.selTime && !fits(k, state.selTime, state.duration, state.avail)) state.selTime = null;
  for (const t of ALL_SLOTS) {
    const b = document.createElement("button"); b.type = "button"; b.className = "slot";
    b.textContent = fmtTime(t); b.disabled = !fits(k, t, state.duration, state.avail);
    b.title = b.disabled ? "Not available for this length" : fmtRange(t, state.duration);
    b.setAttribute("aria-pressed", String(state.selTime === t));
    b.onclick = () => { state.selTime = t; renderSlots(); };
    box.append(b);
  }
  const msg = text => { const p = document.createElement("p"); p.className = "muted"; p.style.flexBasis = "100%"; p.textContent = text; box.append(p); };
  if (state.selTime) msg(`Your visit: ${fmtRange(state.selTime, state.duration)} (${fmtDur(state.duration)})`);
  const anyShort = ALL_SLOTS.some(t => fits(k, t, CONFIG.minDuration, state.avail));
  if (!anyShort) msg("This day just filled up. Please pick another.");
  else if (!ALL_SLOTS.some(t => fits(k, t, state.duration, state.avail))) msg("No openings that long on this day. Try a shorter visit or another day.");
}
$("f-dur").addEventListener("change", e => { state.duration = Number(e.target.value); renderSlots(); });

/* ---------- send a request ---------- */
$("reqForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("formErr"); err.textContent = "";
  const item = {
    date: state.selDay, time: state.selTime, duration: state.duration,
    name: $("f-name").value.trim(), phone: $("f-phone").value.trim(), email: $("f-email").value.trim(),
    contact: $("f-contact").value, size: $("f-size").value, notes: $("f-notes").value.trim(),
    website: $("f-website").value
  };
  if (!item.time) return err.textContent = "Pick a start time above.";
  if (!item.name) { $("f-name").focus(); return err.textContent = "Add your name so I know who's coming."; }
  if (item.phone.replace(/\D/g, "").length < 10) { $("f-phone").focus(); return err.textContent = "Add a phone number with area code so I can reach you."; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) { $("f-email").focus(); return err.textContent = "Add a valid email address, like name@gmail.com."; }

  $("sendBtn").disabled = true; $("sendBtn").textContent = "Sending…";
  let res, data;
  try {
    res = await fetch("/api/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
    data = await res.json().catch(() => ({}));
  } catch { res = null; }
  $("sendBtn").disabled = false; $("sendBtn").textContent = "Send request";

  if (res && res.ok) {
    if (data.code) { notifyOwner(item, data.code); rememberCode(data.code); }
    showSent(item, data.code);
    loadAvailability();
  } else if (res && res.status === 409) {
    if (data.availability) state.avail = data.availability;
    err.textContent = data.error; cal.render(); renderSlots();
  } else if (res && res.status < 500) {
    err.textContent = data.error || "Something went wrong. Please check the form and try again.";
  } else {
    showFallback(item);
  }
});

// Email alert to the owner through Netlify Forms (set up in the Netlify dashboard).
function notifyOwner(i, code) {
  const body = new URLSearchParams({
    "form-name": "appointment-request", code: fmtCode(code), date: fmtDate(i.date),
    time: fmtRange(i.time, i.duration), length: fmtDur(i.duration), name: i.name, phone: i.phone,
    email: i.email, contact: i.contact, people: i.size, notes: i.notes
  });
  fetch("/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }).catch(() => {});
}

function showSent(item, code) {
  const r = $("result"); r.replaceChildren();
  const box = document.createElement("div"); box.className = "notice ok";
  const h = document.createElement("strong"); h.textContent = "Request sent.";
  const p = document.createElement("p"); p.className = "muted"; p.style.marginTop = "4px";
  p.textContent = `${fmtDate(item.date)}, ${fmtRange(item.time, item.duration)}. This isn't confirmed yet. You'll hear back by ${item.contact.toLowerCase()} once it is.`;
  box.append(h, p);
  if (code) {
    const c1 = document.createElement("p"); c1.style.marginTop = "10px"; c1.textContent = "Your request code:";
    const c2 = document.createElement("div"); c2.className = "code"; c2.textContent = fmtCode(code);
    const c3 = document.createElement("p"); c3.className = "muted"; c3.textContent = "Save it to check your status below. This device will remember it too.";
    box.append(c1, c2, c3);
  }
  r.append(box);
  $("reqForm").reset(); $("pickArea").hidden = true;
  $("pickPrompt").hidden = false; $("pickPrompt").textContent = "Want to book another visit? Choose a day on the calendar.";
  state.selDay = null; cal.render();
  state.selTime = null; state.duration = CONFIG.minDuration; $("f-dur").value = String(CONFIG.minDuration);
  renderSlots();
}

function requestText(i) {
  return `Appointment request for ${CONFIG.name}
Day: ${fmtDate(i.date)}
Time: ${fmtRange(i.time, i.duration)} (${fmtDur(i.duration)})
Name: ${i.name}
People: ${i.size}
Phone: ${i.phone}
Email: ${i.email}
Best way to reach me: ${i.contact}${i.notes ? "\nNotes: " + i.notes : ""}`;
}

// If the server can't be reached, let them send the request by text or email instead.
function showFallback(item) {
  const r = $("result"); r.replaceChildren();
  const box = document.createElement("div"); box.className = "notice";
  box.innerHTML = `<strong>The request didn't go through. You can send it to me directly.</strong>
    <p class="muted" style="margin-top:4px">Copy the message below and text or email it. I'll confirm or suggest another time.</p>
    <pre class="msg"></pre>
    <div class="actions"><button class="btn2 small" type="button">Copy message</button><span class="muted"></span></div>
    <p style="margin-top:10px">Text: <span class="contact-line"></span><br>Email: <span class="contact-line"></span></p>`;
  const pre = box.querySelector("pre"); pre.textContent = requestText(item);
  const cl = box.querySelectorAll(".contact-line"); cl[0].textContent = CONFIG.phone; cl[1].textContent = CONFIG.email;
  const state2 = box.querySelector(".actions .muted");
  box.querySelector(".actions button").onclick = async () => {
    try { await navigator.clipboard.writeText(requestText(item)); state2.textContent = "Copied"; }
    catch { const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(rg); state2.textContent = "Selected. Press copy on your device."; }
  };
  r.append(box);
}

/* ---------- status lookup ---------- */
function rememberCode(code) {
  const codes = (store.get("mtjc-codes") || []).filter(c => c !== code);
  codes.unshift(code); store.set("mtjc-codes", codes.slice(0, 5));
  showStatuses();
}
function statusCard(r) {
  const c = document.createElement("div"); c.className = "req";
  const top = document.createElement("div"); top.className = "top2";
  const w = document.createElement("span"); w.className = "when"; w.textContent = `${fmtDate(r.date)} · ${fmtRange(r.time, r.duration)}`;
  const p = document.createElement("span"); p.className = "pill " + r.status; p.textContent = r.status === "approved" ? "confirmed" : r.status;
  top.append(w, p);
  const code = document.createElement("span"); code.className = "muted"; code.textContent = `Code ${fmtCode(r.code)}`;
  c.append(top, code);
  const msg = document.createElement("p");
  if (r.ownerNote) msg.textContent = "Message: " + r.ownerNote;
  else if (r.status === "pending") { msg.className = "muted"; msg.textContent = "Waiting for confirmation."; }
  else if (r.status === "approved") msg.textContent = "You're confirmed. See you then!";
  else msg.textContent = "This time didn't work out. Feel free to request another.";
  c.append(msg);
  return c;
}
async function lookup(code) {
  const r = await fetch(`/api/status?code=${encodeURIComponent(code)}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Couldn't check that code right now.");
  return d;
}
async function showStatuses(extra) {
  const codes = store.get("mtjc-codes") || [];
  const list = extra ? [extra, ...codes.filter(c => c !== extra)] : codes;
  if (!list.length) return;
  const out = $("statusOut");
  const results = await Promise.all(list.map(c => lookup(c).catch(e => ({ error: e.message, code: c }))));
  out.replaceChildren(...results.map(r => {
    if (r.error) { const p = document.createElement("p"); p.className = "err"; p.textContent = `${fmtCode(r.code)}: ${r.error}`; return p; }
    return statusCard(r);
  }));
}
$("codeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("f-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) { $("statusOut").innerHTML = '<p class="err">Enter the 8-character code from your request.</p>'; return; }
  try { await lookup(code); rememberCode(code); }
  catch (err) { const p = document.createElement("p"); p.className = "err"; p.textContent = err.message; $("statusOut").replaceChildren(p); }
});

/* ---------- map: real Google map on the live site ---------- */
(function map() {
  const f = document.createElement("iframe");
  f.src = "https://maps.google.com/maps?q=East+Greenville,+PA+18041&z=13&output=embed";
  f.title = "Map of East Greenville, PA"; f.loading = "lazy"; f.referrerPolicy = "no-referrer-when-downgrade";
  $("mapFallback").hidden = true; $("mapBox").append(f);
})();

/* ---------- gallery ---------- */
const PHOTOS = [
  ["p4331", "Leather Jackets", "A long rack of brown, tan and black leather jackets"],
  ["p4329", "Denim", "A full rack of vintage jeans in every wash"],
  ["p4321", "Camo & work pants", "Camouflage, khaki and denim trousers on wooden hangers"],
  ["p4324", "Graphic Tees & Outerwear", "Leather jackets and graphic tees on a round wagon-wheel rack"],
  ["p4325", "Parkas & bombers", "Fur-trimmed parkas, flight jackets and fleece"],
  ["p4328", "Patagonia", "Sherpa, fleece and wool coats packed tight on the rack"],
  ["p4322", "Rain shells & windbreakers", "Bright outdoor jackets and windbreakers along the aisle"],
  ["p4340", "Chambray & knits", "Faded chambray shirts beside chunky knit sweaters"],
  ["p4335", "Canvas totes", "Heavy canvas tote bags in green, blue and natural"],
  ["p4338", "Fresh pickups", "A pile of new camo and canvas finds waiting to be hung"],
  ["p4339", "", "Rows of plaid, gingham and solid button-up shirts"],
  ["p4336", "", "A worn-in red Lifeguard tee"],
  ["p4334", "", "A green number 36 jersey, a vintage clock and a stretching chart under an American flag"],
  ["p4337", "", "A black denim vest layered over a hoodie on a display stand"],
  ["p4333", "", "Varsity jackets and suede coats by the ladder rack"],
  ["p4332", "", "Workwear jackets and hoodies along the back wall"]
];
(function buildGallery() {
  const g = $("gallery");
  PHOTOS.forEach(([f, name, alt], i) => {
    const b = document.createElement("button"); b.type = "button";
    b.setAttribute("aria-label", `View larger: ${name || alt}`);
    const im = document.createElement("img"); im.src = `/img/${f}.jpg`; im.alt = alt; im.loading = i < 4 ? "eager" : "lazy"; im.decoding = "async";
    b.append(im);
    if (name) { const c = document.createElement("span"); c.className = "cap"; c.textContent = name; b.append(c); }
    b.onclick = () => openLb(i); g.append(b);
  });
  let cur = 0, lastFocus = null;
  function show(i) { cur = (i + PHOTOS.length) % PHOTOS.length; const [f, name, alt] = PHOTOS[cur]; $("lbImg").src = `/img/${f}.jpg`; $("lbImg").alt = alt; $("lbCap").textContent = name; $("lbCap").hidden = !name; }
  function openLb(i) { lastFocus = document.activeElement; show(i); $("lb").hidden = false; $("lbClose").focus(); }
  function closeLb() { $("lb").hidden = true; lastFocus?.focus(); }
  $("lbPrev").onclick = () => show(cur - 1); $("lbNext").onclick = () => show(cur + 1); $("lbClose").onclick = closeLb;
  $("lb").addEventListener("click", e => { if (e.target.id === "lb") closeLb(); });
  document.addEventListener("keydown", e => {
    if ($("lb").hidden) return;
    if (e.key === "Escape") closeLb(); else if (e.key === "ArrowLeft") show(cur - 1); else if (e.key === "ArrowRight") show(cur + 1);
  });
})();

/* ---------- reviews (only ones the owner published) ---------- */
function starLine(n) {
  const s = document.createElement("span"); s.className = "starline"; s.setAttribute("aria-label", `${n} out of 5 stars`);
  s.innerHTML = "★".repeat(n) + `<span class="dim">${"★".repeat(5 - n)}</span>`;
  return s;
}
async function loadReviews() {
  try {
    const r = await fetch("/api/reviews", { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    if (!d.count) return;
    $("reviewsAvg").textContent = `${d.average.toFixed(1)} ★ · ${d.count} review${d.count > 1 ? "s" : ""}`;
    $("reviewsList").replaceChildren(...d.reviews.map(v => {
      const c = document.createElement("article"); c.className = "rev";
      const t = document.createElement("p"); t.textContent = v.text;
      const who = document.createElement("div");
      const n = document.createElement("div"); n.className = "who"; n.textContent = v.name;
      const when = document.createElement("div"); when.className = "muted";
      when.textContent = new Date(v.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      who.append(n, when);
      c.append(starLine(v.rating), t, who);
      return c;
    }));
    $("reviews").hidden = false; $("navReviews").hidden = false;
  } catch {}
}

/* ---------- start ---------- */
loadReviews();
cal.render();
loadAvailability();
showStatuses();
setInterval(() => { if (!document.hidden) loadAvailability(); }, 60000);
