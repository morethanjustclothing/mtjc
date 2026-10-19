import { CONFIG, ALL_SLOTS, keyOf, fromKey, fmtDate, isOpenDay, isRequestOnly, fits } from "./config.mjs";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
export function earliest() { const t = today(); t.setDate(t.getDate() + CONFIG.minNoticeDays); return t; }
export function latest() { const t = today(); t.setMonth(t.getMonth() + CONFIG.monthsAhead + 1, 0); return t; }

/* A month calendar.
   mode "visitor": open days are pickable; closed/full/past days are disabled.
   mode "owner":   every day from today on is clickable (to close or reopen it) and shows bookings. */
export function makeCalendar({ els, mode, getAvail, getSelected, onPick, countFor }) {
  const view = new Date(); view.setDate(1);
  els.dows.replaceChildren(...DOW.map(d => { const e = document.createElement("div"); e.className = "dow"; e.textContent = d; return e; }));
  els.prev.onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
  els.next.onclick = () => { view.setMonth(view.getMonth() + 1); render(); };

  function freeStarts(k, avail) { return ALL_SLOTS.filter(t => fits(k, t, CONFIG.minDuration, avail)).length; }

  function render() {
    const avail = getAvail();
    const y = view.getFullYear(), m = view.getMonth();
    els.month.textContent = view.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const minM = new Date(today().getFullYear(), today().getMonth(), 1);
    const maxM = new Date(latest().getFullYear(), latest().getMonth(), 1);
    els.prev.disabled = first <= minM; els.next.disabled = first >= maxM;
    const lo = mode === "owner" ? today() : earliest(), hi = latest(), tk = keyOf(today());
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) { const b = document.createElement("div"); b.className = "day blank"; cells.push(b); }
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(y, m, d), k = keyOf(date);
      const b = document.createElement("button"); b.type = "button"; b.className = "day";
      const n = document.createElement("span"); n.className = "n"; n.textContent = d;
      const s = document.createElement("span"); s.className = "s";
      const inRange = date >= lo && date <= hi;
      const closed = !!avail.blocked?.[k];
      let label;
      if (mode === "owner") {
        if (!inRange) { b.classList.add("off"); b.disabled = true; label = "unavailable"; }
        else if (closed) { b.classList.add("closed"); s.textContent = "Closed"; label = "closed, tap to reopen"; }
        else {
          const c = countFor ? countFor(k) : 0;
          if (c) { b.classList.add("booked"); s.textContent = `${c} booked`; }
          else if (isRequestOnly(k)) { b.classList.add("ask"); s.textContent = "Wknd"; }
          else s.textContent = "Open";
          label = "open, tap to close";
        }
        if (inRange) b.onclick = () => onPick(k);
      } else {
        const free = inRange && isOpenDay(k) ? freeStarts(k, avail) : 0;
        if (!inRange || free === 0) {
          b.classList.add("off"); b.disabled = true;
          if (inRange && closed) s.textContent = "Closed";
          else if (inRange && isOpenDay(k)) s.textContent = "Full";
          label = "unavailable";
        } else {
          if (isRequestOnly(k)) { b.classList.add("ask"); s.textContent = "By request"; }
          else { b.classList.add(free <= 3 ? "few" : "open"); s.textContent = free <= 3 ? `${free} left` : "Open"; }
          b.onclick = () => onPick(k);
          label = `${free} open start times`;
        }
      }
      if (k === tk) b.classList.add("today");
      if (getSelected && k === getSelected()) b.classList.add("sel");
      b.setAttribute("aria-label", `${fmtDate(k)}: ${label}`);
      b.append(n, s); cells.push(b);
    }
    els.days.replaceChildren(...cells);
  }
  return { render };
}
