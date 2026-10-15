/* Data layer for the standalone website: everything goes through one Supabase
   edge function that checks the shop passcode and holds the Square token.
   A passcode is only remembered after the server has accepted it, and nothing
   loaded from the server outlives a sign out. */
const Store = (() => {
  const FN = "__FUNCTION_URL__";
  const KEY = "cc-inventory-passcode";
  const blank = () => ({ settingsDoc: null, counts: [], deliveries: [], orders: [] });
  let mem = null, onChange = null, onLocked = null, timer = null, gen = 0, listening = false;
  let state = blank();
  const getPass = () => { try { return localStorage.getItem(KEY) || mem; } catch (_) { return mem; } };
  const forget = () => { mem = null; try { localStorage.removeItem(KEY); } catch (_) {} };

  // `trial` is a passcode being checked at sign in. Without it the remembered one is used,
  // and a refusal means the remembered passcode stopped working, so the app locks itself.
  async function call(op, payload, trial) {
    if (!FN || FN.indexOf("__") === 0) throw { code: "not_configured" };
    const code = trial != null ? trial : getPass();
    if (!code) throw { code: "wrong_passcode" };
    const g = gen;
    let r;
    try {
      r = await fetch(FN, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-passcode": code }, body: JSON.stringify(Object.assign({ op }, payload)) });
    } catch (_) { throw { code: "network" }; }
    let j = null; try { j = await r.json(); } catch (_) {}
    let err = null;
    if (r.status === 401) err = { code: "wrong_passcode" };
    else if (r.status === 429) err = { code: "too_many_attempts" };
    else if (!r.ok) err = { code: (j && j.error) || "server", message: j && j.message };
    if (err) {
      if (trial == null && g === gen && (err.code === "wrong_passcode" || err.code === "too_many_attempts") && onLocked) onLocked(err);
      throw err;
    }
    if (g !== gen) throw { code: "signed_out" };
    return j;
  }
  function apply(docs) {
    const s = blank();
    for (const d of docs || []) {
      if (d.collection === "config" && d.id === "settings") s.settingsDoc = d.data;
      else if (s[d.collection]) s[d.collection].push(Object.assign({ id: d.id }, d.data));
    }
    state = s;
  }
  async function refresh() { const j = await call("state", {}); apply(j.docs); onChange && onChange(state); }
  function stop() { gen++; clearInterval(timer); timer = null; onChange = null; onLocked = null; state = blank(); }

  return {
    kind: "web",
    needsPasscode: () => !getPass(),
    async signIn(code) {
      const j = await call("state", {}, code);
      mem = code; try { localStorage.setItem(KEY, code); } catch (_) {}
      apply(j.docs);
      return state;
    },
    signOut() { stop(); forget(); },
    clearPasscode() { stop(); forget(); },
    async init(cb, locked) {
      onChange = cb; onLocked = locked || null;
      await refresh();
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 30000);
      if (!listening) {
        listening = true;
        document.addEventListener("visibilitychange", () => { if (!document.hidden && timer) refresh().catch(() => {}); });
      }
      return { ok: true, canSave: true, canSales: true };
    },
    async sales(request) { const j = await call("sales", { query: request.query }); return { rows: j.data || [], at: Date.now() }; },
    async add(col, data) { const j = await call("add", { collection: col, data }); await refresh(); return j && j.id; },
    async set(path, data) { const [c, id] = path.split("/"); await call("set", { collection: c, id, data }); await refresh(); },
    async update(path, data, opts) { const [c, id] = path.split("/"); await call("update", Object.assign({ collection: c, id, data }, opts && opts.replace ? { replace: opts.replace } : {})); await refresh(); },
    // Pickup texts: the server texts everyone; the first claim wins.
    async claim(id, name) { const j = await call("claim", { id, name }); await refresh(); return j.by || null; },
    async unclaim(id, name) { const j = await call("unclaim", { id, name }); await refresh(); return !!j.ok; },
    async testTexts() { const j = await call("test_sms", {}); return j.results || []; },
  };
})();
