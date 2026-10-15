// Campus Creamery inventory API.
// Holds the Square access token so the browser never sees it. Every request
// must carry the shop passcode in the x-passcode header.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_FROM") ?? ""; // a +1 number, or a Messaging Service SID (MG...)
const APP_URL = "https://rukinjames.github.io/cc-freezer-q7m2x9/";
const PASSCODE = Deno.env.get("INVENTORY_PASSCODE") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const TABLE = "inventory_docs";
const COLLECTIONS = new Set(["config", "counts", "deliveries", "orders"]);
const ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-passcode, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Guessing protection: 10 wrong passcodes from one network in 15 minutes locks that
// network out until the 15 minutes are up. The IP address is stored only as a hash.
const MAX_FAILS = 10;
const WINDOW_S = 15 * 60;
function clientIp(req: Request) {
  const xf = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return xf || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}
async function hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function samePasscode(given: string) {
  if (!PASSCODE) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(PASSCODE)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
function merge(base: Obj, patch: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Obj, v) : v;
  return out;
}

// Only the item-level sales cube the app needs. No customer or payment data.
function badQuery(q: Obj): string | null {
  const td = Array.isArray(q.timeDimensions) ? (q.timeDimensions as Obj[]) : [];
  const filters = Array.isArray(q.filters) ? (q.filters as Obj[]) : [];
  const members = [
    ...((q.measures as unknown[]) ?? []),
    ...((q.dimensions as unknown[]) ?? []),
    ...td.map((t) => t.dimension),
    ...filters.map((f) => f.member ?? f.dimension),
  ];
  if (!members.length) return "Empty query.";
  for (const m of members) if (typeof m !== "string" || !m.startsWith("ModifierSales.")) return "Only item sales can be read.";
  return null;
}

async function squareLoad(query: Obj) {
  for (let i = 0; i < 15; i++) {
    const r = await fetch("https://connect.squareup.com/reporting/v1/load", {
      method: "POST",
      headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await r.text();
    let j: Obj | null = null;
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (j && j.error === "Continue wait") { await sleep(800); continue; }
    if (!r.ok || !j) {
      const errs = j && Array.isArray(j.errors) ? (j.errors as Obj[]) : [];
      return { error: String(errs[0]?.detail ?? j?.error ?? `Square answered ${r.status}`), status: r.status === 401 ? 502 : 502 };
    }
    if (j.error) return { error: String(j.error), status: 502 };
    return { data: (j.data as unknown[]) ?? [] };
  }
  return { error: "Square took too long to answer.", status: 504 };
}


// ---------- pickup texts ----------
// When an order is saved with "text everyone", each person in Settings > Pickup texts gets a
// text about a minute later (so Undo can still stop it). The first to tap the link and claim
// it is the one picking it up, and everyone hears who. One reminder goes out an hour before
// the delivery window if nobody has claimed it, and a notice if a texted order is cancelled.
const SUP: Record<string, string> = { sams: "Sam's Club", gordon: "Gordon's" };
type Person = { name: string; phone: string };

async function sms(to: string, body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return { ok: false, error: "Texts aren't set up yet. Add the Twilio keys to the Edge Function secrets." };
  const params = new URLSearchParams({ To: to, Body: body });
  if (TWILIO_FROM.startsWith("MG")) params.set("MessagingServiceSid", TWILIO_FROM); else params.set("From", TWILIO_FROM);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const j = await r.json().catch(() => ({})) as Obj;
    return r.ok ? { ok: true } : { ok: false, error: String(j.message ?? `Twilio answered ${r.status}`) };
  } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
}
async function team(): Promise<Person[]> {
  const { data } = await sb.from(TABLE).select("data").eq("collection", "config").eq("id", "settings").maybeSingle();
  const t = (data?.data as Obj | undefined)?.team;
  return Array.isArray(t) ? (t as Person[]).filter((p) => p && typeof p.phone === "string" && /^\+\d{10,15}$/.test(p.phone)) : [];
}
async function textAll(body: string, skipName?: string) {
  const people = await team();
  const out = [];
  for (const p of people) if (p.name !== skipName) out.push({ name: p.name, ...(await sms(p.phone, body)) });
  return out;
}
// Chicago wall-clock "YYYY-MM-DDTHH:MM"
function chicagoNow() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const addMinutes = (stamp: string, m: number) => new Date(new Date(stamp + ":00Z").getTime() + m * 60000).toISOString().slice(0, 16);
function dayWord(ds: string, today: string) {
  if (ds === today) return "today";
  if (ds === addMinutes(today + "T00:00", 24 * 60).slice(0, 10)) return "tomorrow";
  return new Date(ds + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
}
function describe(o: Obj, today: string) {
  const when = dayWord(String(o.arrivesOn), today) + (o.window ? `, ${o.window}` : "");
  return `${SUP[String(o.supplier)] ?? "The"} order arriving ${when}`;
}
async function getOrder(id: string) {
  const { data } = await sb.from(TABLE).select("data").eq("collection", "orders").eq("id", id).maybeSingle();
  return (data?.data as Obj | undefined) ?? null;
}
async function tick() {
  const now = chicagoNow(), today = now.slice(0, 10), nowIso = new Date().toISOString();
  const { data, error } = await sb.from(TABLE).select("id,data").eq("collection", "orders").limit(2000);
  if (error) throw error;
  const sent: string[] = [];
  for (const row of data ?? []) {
    const o = row.data as Obj, p = (o.pickup ?? null) as Obj | null;
    if (!p || p.text !== true) continue;
    const link = `${APP_URL}?claim=${encodeURIComponent(row.id)}`;
    if (o.status === "placed") {
      if (String(o.arrivesOn) < today) continue; // stale order, its card asks whether it arrived
      if (!p.alertedAt && String(p.sendAfter ?? "") <= nowIso) {
        const { data: won } = await sb.rpc("inventory_pickup_mark", { p_id: row.id, p_key: "alertedAt" });
        if (won) { await textAll(`Campus Creamery: ${describe(o, today)}. Who can pick it up? Tap to claim it: ${link}`); sent.push(`alert ${row.id}`); }
      } else if (p.alertedAt && !p.by && !p.remindedAt) {
        const start = `${o.arrivesOn}T${/^\d\d:\d\d$/.test(String(o.windowStart ?? "")) ? o.windowStart : "10:00"}`;
        if (now >= addMinutes(start, -60)) {
          const { data: won } = await sb.rpc("inventory_pickup_mark", { p_id: row.id, p_key: "remindedAt" });
          if (won) { await textAll(`Campus Creamery: Nobody has claimed the ${describe(o, today)} yet. Can you pick it up? ${link}`); sent.push(`reminder ${row.id}`); }
        }
      }
    } else if (o.status === "cancelled" && p.alertedAt && !p.cancelNotifiedAt) {
      const { data: won } = await sb.rpc("inventory_pickup_mark", { p_id: row.id, p_key: "cancelNotifiedAt" });
      if (won) { await textAll(`Campus Creamery: The ${describe(o, today)} was cancelled. No pickup needed.`); sent.push(`cancel ${row.id}`); }
    }
  }
  return sent;
}
let cronKey: string | null = null;
async function isCron(req: Request) {
  const given = req.headers.get("x-cron-key");
  if (!given) return false;
  if (cronKey == null) {
    const { data } = await sb.from("inventory_private").select("v").eq("k", "cron_key").maybeSingle();
    cronKey = (data?.v as string | undefined) ?? "";
  }
  if (!cronKey || given.length !== cronKey.length) return false;
  let diff = 0; for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ cronKey.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Setup check, no passcode needed: says whether the secrets are set. Returns no data
  // and makes no Square call, so strangers can't use it to run up Square requests.
  if (req.method === "GET" && new URL(req.url).searchParams.has("health")) {
    return json({ ok: true, passcodeSet: !!PASSCODE, squareTokenSet: !!SQUARE_TOKEN, textsSet: !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // The scheduler (pg_cron, every minute) sends due pickup texts. It carries its own key.
  if (await isCron(req)) {
    try { return json({ sent: await tick() }); } catch (e) { return json({ error: "server", message: String((e as Error)?.message ?? e) }, 500); }
  }
  if (!PASSCODE) {
    return json({ error: "not_configured", message: "Add INVENTORY_PASSCODE to this project's Edge Function secrets." }, 500);
  }
  const ok = await samePasscode(req.headers.get("x-passcode") ?? "");
  const { data: verdict, error: gateErr } = await sb.rpc("inventory_gate", {
    p_key: await hex("cc-ip:" + clientIp(req)), p_ok: ok, p_max: MAX_FAILS, p_window_seconds: WINDOW_S,
  });
  if (gateErr) return json({ error: "server", message: "Couldn't check the passcode right now." }, 500); // fail closed
  if (verdict === "locked") {
    await sleep(500);
    return new Response(JSON.stringify({ error: "too_many_attempts" }), { status: 429, headers: { ...CORS, "content-type": "application/json", "Retry-After": String(WINDOW_S) } });
  }
  if (!ok || verdict !== "ok") { await sleep(500); return json({ error: "wrong_passcode" }, 401); }

  let body: Obj;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const op = body.op;

  try {
    if (op === "state") {
      const { data, error } = await sb.from(TABLE).select("collection,id,data,updated_at").order("updated_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return json({ docs: data });
    }

    if (op === "add" || op === "set" || op === "update") {
      const collection = String(body.collection ?? "");
      if (!COLLECTIONS.has(collection)) return json({ error: "bad_request", message: "Unknown collection." }, 400);
      if (!isObj(body.data)) return json({ error: "bad_request", message: "Data must be an object." }, 400);
      if (JSON.stringify(body.data).length > 50_000) return json({ error: "bad_request", message: "Too large." }, 400);
      const id = op === "add" ? crypto.randomUUID() : String(body.id ?? "");
      if (!ID.test(id)) return json({ error: "bad_request", message: "Bad id." }, 400);
      let data = body.data as Obj;
      if (op === "update") {
        const { data: cur, error } = await sb.from(TABLE).select("data").eq("collection", collection).eq("id", id).maybeSingle();
        if (error) throw error;
        if (!cur) return json({ error: "not_found" }, 404);
        data = merge(cur.data as Obj, data);
        // Keys listed in "replace" overwrite instead of merging, so a line removed from an order stays removed.
        if (Array.isArray(body.replace)) for (const k of body.replace) if (typeof k === "string" && k in (body.data as Obj)) data[k] = (body.data as Obj)[k];
      }
      const { error } = await sb.from(TABLE).upsert({ collection, id, data, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ id });
    }

    if (op === "claim" || op === "unclaim") {
      const id = String(body.id ?? ""), name = String(body.name ?? "").trim().slice(0, 40);
      if (!ID.test(id) || !name) return json({ error: "bad_request" }, 400);
      const o = await getOrder(id);
      if (!o || !o.pickup) return json({ error: "not_found" }, 404);
      const today = chicagoNow().slice(0, 10), link = `${APP_URL}?claim=${encodeURIComponent(id)}`;
      if (op === "claim") {
        const { data: who, error } = await sb.rpc("inventory_claim", { p_id: id, p_name: name });
        if (error) throw error;
        if (who === name && (o.pickup as Obj).by !== name) await textAll(`Campus Creamery: ${name} is picking up the ${describe(o, today)}.`);
        return json({ by: who });
      }
      const { data: done, error } = await sb.rpc("inventory_unclaim", { p_id: id, p_name: name });
      if (error) throw error;
      if (done) await textAll(`Campus Creamery: ${name} can't pick up the ${describe(o, today)} anymore. Can you? ${link}`, name);
      return json({ ok: !!done });
    }

    if (op === "test_sms") {
      const results = await textAll("Campus Creamery app: test text. Pickup alerts will come from this number.");
      return json({ results });
    }

    if (op === "sales") {
      if (!SQUARE_TOKEN) return json({ error: "square_error", message: "The Square token isn't set yet. Add SQUARE_ACCESS_TOKEN to the Edge Function secrets." }, 500);
      if (!isObj(body.query)) return json({ error: "bad_request" }, 400);
      const bad = badQuery(body.query);
      if (bad) return json({ error: "bad_request", message: bad }, 400);
      const res = await squareLoad(body.query);
      if ("error" in res) return json({ error: "square_error", message: res.error }, res.status);
      return json({ data: res.data });
    }

    return json({ error: "bad_request", message: "Unknown operation." }, 400);
  } catch (e) {
    return json({ error: "server", message: String((e as Error)?.message ?? e) }, 500);
  }
});
