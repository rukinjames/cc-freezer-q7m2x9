/* Data layer for the standalone website: everything goes through one Supabase
   edge function that checks the shop passcode and holds the Square token. */
const Store = (() => {
  const FN = "__FUNCTION_URL__";
  const KEY = "cc-inventory-passcode";
  let mem = null, onChange = null, timer = null;
  const state = { settingsDoc: null, counts: [], deliveries: [], orders: [] };
  const getPass = () => { try { return localStorage.getItem(KEY) || mem; } catch (_) { return mem; } };
  async function call(op, payload) {
    if (!FN || FN.indexOf("__") === 0) throw { code: "not_configured" };
    let r;
    try {
      r = await fetch(FN, { method: "POST", headers: { "content-type": "application/json", "x-passcode": getPass() || "" }, body: JSON.stringify(Object.assign({ op }, payload)) });
    } catch (_) { throw { code: "network" }; }
    let j = null; try { j = await r.json(); } catch (_) {}
    if (r.status === 401) throw { code: "wrong_passcode" };
    if (!r.ok) throw { code: (j && j.error) || "server", message: j && j.message };
    return j;
  }
  function apply(docs) {
    state.settingsDoc = null; state.counts = []; state.deliveries = []; state.orders = [];
    for (const d of docs || []) {
      if (d.collection === "config" && d.id === "settings") state.settingsDoc = d.data;
      else if (state[d.collection]) state[d.collection].push(Object.assign({ id: d.id }, d.data));
    }
  }
  async function refresh() { const j = await call("state", {}); apply(j.docs); onChange && onChange(state); }
  return {
    kind: "web",
    needsPasscode: () => !getPass(),
    setPasscode(p) { mem = p; try { localStorage.setItem(KEY, p); } catch (_) {} },
    clearPasscode() { mem = null; try { localStorage.removeItem(KEY); } catch (_) {} },
    async init(cb) {
      onChange = cb;
      await refresh();
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 30000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh().catch(() => {}); });
      return { ok: true, canSave: true, canSales: true };
    },
    async sales(request) { const j = await call("sales", { query: request.query }); return { rows: j.data || [], at: Date.now() }; },
    async add(col, data) { await call("add", { collection: col, data }); await refresh(); },
    async set(path, data) { const [c, id] = path.split("/"); await call("set", { collection: c, id, data }); await refresh(); },
    async update(path, data) { const [c, id] = path.split("/"); await call("update", { collection: c, id, data }); await refresh(); },
  };
})();
