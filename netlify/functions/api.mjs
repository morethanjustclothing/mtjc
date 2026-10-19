// Appointment request API for More Than Just Clothing.
// Runs as a Netlify Function and stores everything in Netlify Blobs (free, built in).
//
// Public:  GET  /api/availability           -> closed days and booked times
//          POST /api/request                -> send a request, returns a status code
//          GET  /api/status?code=XXXX-XXXX  -> look up a request's status
// Owner (needs the OWNER_PASSWORD set in Netlify, sent as the x-owner-key header):
//          GET  /api/owner/check
//          GET  /api/owner/requests
//          POST /api/owner/decide   {code, status, note}
//          POST /api/owner/block    {date, closed}
//          POST /api/owner/delete   {code}

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual, randomInt } from "node:crypto";
import {
  CONFIG, ALL_SLOTS, DURATIONS, blocksFor, fits, validDateKey, keyOf, fromKey, isOpenDay
} from "../../assets/config.mjs";

export const config = { path: "/api/*" };

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const STATUSES = ["pending", "approved", "declined"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
const fail = (status, message, extra = {}) => json({ error: message, ...extra }, status);

const store = () => getStore({ name: "appointments", consistency: "strong" });

function newCode() {
  let c = "";
  for (let i = 0; i < 8; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return c;
}
const cleanCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

function ownerOk(req) {
  const expected = process.env.OWNER_PASSWORD || globalThis.Netlify?.env?.get?.("OWNER_PASSWORD");
  if (!expected) return "unset";
  const given = req.headers.get("x-owner-key") || "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) ? "ok" : "bad";
}

async function allRequests(s) {
  const { blobs } = await s.list({ prefix: "requests/" });
  const items = await Promise.all(blobs.map(b => s.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
async function getBlocked(s) {
  return (await s.get("settings/blocked", { type: "json" })) || {};
}
// Booked half-hour blocks per day, from approved requests.
function takenFrom(requests, exceptCode) {
  const taken = {};
  for (const r of requests) {
    if (r.status !== "approved" || r.code === exceptCode) continue;
    (taken[r.date] ||= []).push(...blocksFor(r.time, r.duration));
  }
  for (const k in taken) taken[k] = [...new Set(taken[k])].sort();
  return taken;
}
async function availability(s) {
  const [blocked, requests] = await Promise.all([getBlocked(s), allRequests(s)]);
  return { blocked, taken: takenFrom(requests) };
}

function dateInRange(k) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lo = new Date(today); lo.setDate(lo.getDate() - 1); // a day of slack for time zones
  const hi = new Date(today); hi.setMonth(hi.getMonth() + CONFIG.monthsAhead + 1, 2);
  const d = fromKey(k);
  return d >= lo && d <= hi;
}

async function readBody(req) {
  try {
    const text = await req.text();
    if (text.length > 10000) return null;
    return JSON.parse(text || "{}");
  } catch { return null; }
}

async function rateLimited(s, ip) {
  if (!ip) return false;
  const hour = new Date().toISOString().slice(0, 13);
  const key = `ratelimit/${hour}/${ip.replace(/[^0-9a-fA-F:.]/g, "")}`;
  const n = ((await s.get(key, { type: "json" })) || 0) + 1;
  await s.setJSON(key, n);
  return n > 8;
}

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = req.method;
  const s = store();

  try {
    // ---------- public ----------
    if (path === "availability" && method === "GET") {
      return json(await availability(s));
    }

    if (path === "request" && method === "POST") {
      const b = await readBody(req);
      if (!b) return fail(400, "Something went wrong with the form. Please try again.");
      if (b.website) return json({ ok: true, code: "" }); // spam trap
      const item = {
        date: clip(b.date, 10), time: clip(b.time, 5), duration: Number(b.duration),
        name: clip(b.name, 80), phone: clip(b.phone, 30), email: clip(b.email, 120),
        contact: ["Text", "Call", "Email"].includes(b.contact) ? b.contact : "Text",
        size: ["1", "2", "3", "4+"].includes(String(b.size)) ? String(b.size) : "1",
        notes: clip(b.notes, 1000)
      };
      if (!validDateKey(item.date) || !dateInRange(item.date)) return fail(400, "Please pick a day from the calendar.");
      if (!ALL_SLOTS.includes(item.time)) return fail(400, "Please pick a start time.");
      if (!DURATIONS.includes(item.duration)) return fail(400, "Please pick how long your visit is.");
      if (!item.name) return fail(400, "Add your name so I know who's coming.");
      if (item.phone.replace(/\D/g, "").length < 10) return fail(400, "Add a phone number with area code so I can reach you.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) return fail(400, "Add a valid email address, like name@gmail.com.");
      if (!isOpenDay(item.date)) return fail(400, "That day isn't available. Please pick another.");
      if (await rateLimited(s, context?.ip)) return fail(429, "Too many requests from this connection. Please try again in an hour, or text me instead.");
      const avail = await availability(s);
      if (!fits(item.date, item.time, item.duration, avail))
        return fail(409, "That time was just booked or closed. Please pick another time.", { availability: avail });

      let code = newCode();
      while (await s.get(`requests/${code}`)) code = newCode();
      const now = Date.now();
      const record = { ...item, code, status: "pending", ownerNote: "", createdAt: now, updatedAt: now };
      await s.setJSON(`requests/${code}`, record);
      return json({ ok: true, code });
    }

    if (path === "status" && method === "GET") {
      const code = cleanCode(url.searchParams.get("code"));
      if (code.length !== 8) return fail(400, "Enter the 8-character code from your request.");
      const r = await s.get(`requests/${code}`, { type: "json" });
      if (!r) return fail(404, "No request found with that code. Check it and try again.");
      const { date, time, duration, size, status, ownerNote, createdAt, updatedAt } = r;
      return json({ code, date, time, duration, size, status, ownerNote, createdAt, updatedAt });
    }

    // ---------- owner ----------
    if (path.startsWith("owner/")) {
      const auth = ownerOk(req);
      if (auth === "unset") return fail(503, "The owner password hasn't been set up yet. Add OWNER_PASSWORD in Netlify's environment variables, then redeploy.");
      if (auth !== "ok") return fail(401, "That password isn't right.");
      const action = path.slice(6);

      if (action === "check" && method === "GET") return json({ ok: true });

      if (action === "requests" && method === "GET") {
        const [requests, blocked] = await Promise.all([allRequests(s), getBlocked(s)]);
        return json({ requests, blocked, taken: takenFrom(requests) });
      }

      if (action === "decide" && method === "POST") {
        const b = await readBody(req);
        const code = cleanCode(b?.code);
        if (!STATUSES.includes(b?.status)) return fail(400, "Unknown status.");
        const r = await s.get(`requests/${code}`, { type: "json" });
        if (!r) return fail(404, "That request no longer exists.");
        if (b.status === "approved") {
          const requests = await allRequests(s);
          const taken = takenFrom(requests, code)[r.date] || [];
          const clash = blocksFor(r.time, r.duration).some(x => taken.includes(x));
          if (clash && !b.force) {
            const other = requests.find(o => o.status === "approved" && o.code !== code && o.date === r.date &&
              blocksFor(o.time, o.duration).some(x => blocksFor(r.time, r.duration).includes(x)));
            return fail(409, `This overlaps ${other ? other.name + "'s" : "another"} approved visit that day.`, { conflict: true });
          }
        }
        const updated = { ...r, status: b.status, ownerNote: clip(b.note, 1000), updatedAt: Date.now() };
        await s.setJSON(`requests/${code}`, updated);
        return json({ ok: true, request: updated });
      }

      if (action === "block" && method === "POST") {
        const b = await readBody(req);
        if (!validDateKey(b?.date)) return fail(400, "Bad date.");
        const blocked = await getBlocked(s);
        if (b.closed) blocked[b.date] = true; else delete blocked[b.date];
        // tidy past dates
        const cutoff = keyOf(new Date(Date.now() - 7 * 864e5));
        for (const k in blocked) if (k < cutoff) delete blocked[k];
        await s.setJSON("settings/blocked", blocked);
        return json({ ok: true, blocked });
      }

      if (action === "delete" && method === "POST") {
        const b = await readBody(req);
        await s.delete(`requests/${cleanCode(b?.code)}`);
        return json({ ok: true });
      }
    }

    return fail(404, "Not found.");
  } catch (e) {
    console.error(e);
    return fail(500, "Something went wrong on our end. Please try again, or text me instead.");
  }
};
