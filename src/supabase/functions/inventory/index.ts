// Campus Creamery inventory API.
// Holds the Square access token so the browser never sees it. Every request
// must carry the shop passcode in the x-passcode header.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SQUARE_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Setup check, no passcode needed: says whether the secrets are set. Returns no data
  // and makes no Square call, so strangers can't use it to run up Square requests.
  if (req.method === "GET" && new URL(req.url).searchParams.has("health")) {
    return json({ ok: true, passcodeSet: !!PASSCODE, squareTokenSet: !!SQUARE_TOKEN });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
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
      }
      const { error } = await sb.from(TABLE).upsert({ collection, id, data, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ id });
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
