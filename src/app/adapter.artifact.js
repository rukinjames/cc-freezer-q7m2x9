/* Data layer for the Claude artifact build: shared db + the viewer's Square connector. */
const Store = (() => {
  let db = null, mcp = null, onChange = null;
  const state = { settingsDoc: null, counts: [], deliveries: [], orders: [] };
  const emit = () => onChange && onChange(state);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  return {
    kind: "artifact",
    needsPasscode: () => false,
    async init(cb) {
      onChange = cb;
      const use = window.claude && window.claude.use ? window.claude.use.bind(window.claude) : null;
      if (!use) return { ok: false, code: "no_host" };
      [db, mcp] = await Promise.all([use("db").catch(() => null), use("mcp").catch(() => null)]);
      let first; const firstCounts = new Promise(r => (first = r));
      if (db) {
        const err = () => {};
        db.doc("config/settings").onSnapshot(s => { state.settingsDoc = s.exists ? s.data() : null; emit(); }, err);
        db.collection("counts").orderBy("at", "desc").limit(1000).onSnapshot(q => { state.counts = q.docs.map(d => ({ id: d.id, ...d.data() })); first(); emit(); }, err);
        db.collection("deliveries").orderBy("at", "desc").limit(1000).onSnapshot(q => { state.deliveries = q.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, err);
        db.collection("orders").orderBy("placedAt", "desc").limit(200).onSnapshot(q => { state.orders = q.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, err);
        await Promise.race([firstCounts, sleep(4000)]);
      }
      return { ok: true, canSave: !!db, canSales: !!mcp, salesCode: mcp ? null : "not_granted" };
    },
    async sales(request, force) {
      const input = { service: "reporting", method: "load", request, characterization: "reporting on item and modifier sales for inventory tracking" };
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await mcp.callTool("Square", "make_api_request_read", input, { cache: force ? { staleTime: 0, refresh: true } : { staleTime: 60000 } });
          let p = r.payload;
          if (typeof p === "string") { try { p = JSON.parse(p); } catch (_) {} }
          if (!p || !Array.isArray(p.data)) throw { code: "bad_payload" };
          return { rows: p.data, at: r.cache ? r.cache.storedAt : Date.now() };
        } catch (e) {
          if (e && e.retryable && attempt === 0) { await sleep((e.retryAfterMs || 1200) + Math.random() * 900); continue; }
          throw e;
        }
      }
    },
    async add(col, data) { if (!db) throw { code: "no_db" }; await db.collection(col).add(data); },
    async set(path, data) { if (!db) throw { code: "no_db" }; await db.doc(path).set(data); },
    async update(path, data) { if (!db) throw { code: "no_db" }; await db.doc(path).update(data); },
  };
})();
