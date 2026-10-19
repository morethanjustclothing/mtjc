/* ===== Business settings: shared by the website and the server =====
   Change these and redeploy to update hours, contact info, etc. */
export const CONFIG = {
  name: "More Than Just Clothing",
  phone: "(484) 587-7467",
  email: "morethanjustclothingbusiness@gmail.com",
  openFrom: "10:00",          // first start time
  openUntil: "22:00",         // closing time (visits must end by this)
  stepMinutes: 30,            // start times every 30 minutes
  minDuration: 30,            // shortest visit, in minutes
  maxDuration: 180,           // longest visit, in minutes
  regularDays: [1, 2, 3, 4, 5],   // Mon–Fri (0 = Sunday)
  requestOnlyDays: [0, 6],        // Sat & Sun: can be requested, at the owner's discretion
  monthsAhead: 2,             // how far ahead people can request
  minNoticeDays: 1            // earliest request is this many days from today
};

export const pad = n => String(n).padStart(2, "0");
export const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

export const ALL_SLOTS = (() => {
  const out = [];
  for (let m = toMin(CONFIG.openFrom); m < toMin(CONFIG.openUntil); m += CONFIG.stepMinutes) out.push(fromMin(m));
  return out;
})();
export const DURATIONS = (() => {
  const out = [];
  for (let d = CONFIG.minDuration; d <= CONFIG.maxDuration; d += CONFIG.stepMinutes) out.push(d);
  return out;
})();

export const isRequestOnly = k => CONFIG.requestOnlyDays.includes(fromKey(k).getDay());
export const isOpenDay = k => {
  const dow = fromKey(k).getDay();
  return CONFIG.regularDays.includes(dow) || CONFIG.requestOnlyDays.includes(dow);
};
export function blocksFor(t, dur) {
  const out = [];
  for (let m = toMin(t); m < toMin(t) + (Number(dur) || CONFIG.minDuration); m += CONFIG.stepMinutes) out.push(fromMin(m));
  return out;
}
/* Does a visit starting at t for dur minutes fit on day k, given closed days and booked blocks? */
export function fits(k, t, dur, avail) {
  if (!isOpenDay(k) || avail.blocked?.[k]) return false;
  const taken = avail.taken?.[k] || [];
  return blocksFor(t, dur).every(b => ALL_SLOTS.includes(b) && !taken.includes(b));
}
export const validDateKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k) && keyOf(fromKey(k)) === k;

export function fmtTime(t) { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`; }
export function fmtDur(d) { d = Number(d) || 30; const h = Math.floor(d / 60), m = d % 60; return [h ? `${h} hr${h > 1 ? "s" : ""}` : "", m ? `${m} min` : ""].filter(Boolean).join(" "); }
export const fmtRange = (t, d) => `${fmtTime(t)} – ${fmtTime(fromMin(toMin(t) + (Number(d) || 30)))}`;
export const fmtDate = k => fromKey(k).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const fmtCode = c => c ? `${c.slice(0, 4)}-${c.slice(4)}` : "";
