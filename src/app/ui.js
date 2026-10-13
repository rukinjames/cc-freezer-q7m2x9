(() => {
const E = Engine;
const DEFAULTS = {
  cap: 18, floors: { sunWed: 6, thuSat: 10 },
  gordon: { windows: [{ label: "10 AM to 2 PM", cutoff: "09:30" }, { label: "2 to 5 PM", cutoff: "13:00" }], minimum: 75, fee: 10 },
  supplies: { topUpBelow: 10, coverTo: 14, samsMinimum: 50 },
  exclusive: { active: false, name: "Mint Chocolate Chip", code: "442845", price: 42.28, target: 2 },
  yields: { vanilla: 21, chocolate: 25, exclusive: 22 }, adjust: {}, closedDates: [], learnLog: []
};
// Business nights from Square's posted hours, Sunday first
const HOURS = ["8 to 11 PM", "8 to 11 PM", "8 to 11 PM", "8 to 11 PM", "8 PM to 2 AM", "8 PM to 2 AM", "8 PM to 2 AM"];
const S = { data: { settingsDoc: null, counts: [], deliveries: [], orders: [] }, canSave: false, daily: null, hourly: null,
  sq: { state: "loading" }, lastSync: null, syncing: false, booted: false, epoch: 0 };
const $ = id => document.getElementById(id);
// The app's markup. On the website it ships inside a <template>, so nothing of the app
// is on screen until the server has accepted the passcode.
const SHELL = (() => { const t = $("shellTpl"); return t ? t.innerHTML : $("root").innerHTML; })();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => "$" + n.toFixed(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtQ = E.fmtQ;
const SUP = E.SUPPLIER;

function settings() {
  const d = S.data.settingsDoc || {};
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k in d) {
    if (!(k in s)) continue;
    if (d[k] && typeof d[k] === "object" && !Array.isArray(d[k]) && s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) Object.assign(s[k], d[k]);
    else s[k] = d[k];
  }
  if (!Array.isArray(s.gordon.windows) || !s.gordon.windows.length) s.gordon.windows = DEFAULTS.gordon.windows;
  return s;
}
const exOn = st => !!(st.exclusive && st.exclusive.active);
function nameOf(key, st) { return key === "exclusive" ? (exOn(st) ? st.exclusive.name : "Exclusive") : E.BY_KEY[key].name; }
function codeOf(key, st) { return key === "exclusive" ? (st.exclusive.code || "") : (E.BY_KEY[key].code || ""); }
function priceOf(key, st) { return key === "exclusive" ? (+st.exclusive.price || 0) : E.BY_KEY[key].price; }
function when(iso) { return new Date(iso).toLocaleString("en-US", { timeZone: E.TZ, weekday: "short", hour: "numeric", minute: "2-digit" }); }
function nowStamp() { return E.localStamp(new Date()); }
function calToday() { return nowStamp().slice(0, 10); }
function dayWord(ds, today) { return ds === today ? "today" : ds === E.addDays(today, 1) ? "tomorrow" : E.DOW_LONG[E.weekday(ds)]; }
function clock(hhmm) { let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`; }
function toast(msg) {
  $("toastRoot").innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $("toastRoot").innerHTML = ""; }, 3400);
}
function latestCounts() { const l = {}; for (const c of S.data.counts) if (!l[c.item] || c.at > l[c.item].at) l[c.item] = c; return l; }
function lineLabel(key, qty, st) {
  const c = E.BY_KEY[key];
  return c.group === "ice" ? `${qty} ${nameOf(key, st)} tub${qty === 1 ? "" : "s"}` : `${qty} × ${c.buy || c.name}`;
}

// ---------- Square ----------
function sqError(e) {
  const code = e && e.code;
  const m = {
    needs_reauth: "Square needs to be reconnected. Reconnect it in claude.ai Settings, Connectors, then tap Update.",
    server_not_connected: "The Square connector isn't added for you. Add it in claude.ai Settings, Connectors, then tap Update.",
    selection_required: "You have more than one Square connector. Pick one when Claude asks, then tap Update.",
    not_in_manifest: "Square is turned off for this page. Turn it on from the page's Permissions menu, then tap Update.",
    blocked_by_policy: "Your organization blocks this Square tool.",
    approval_required: "Square needs your OK before this page can read sales.",
    not_granted: "This view can't reach Square. Open it in claude.ai or the Claude app.",
    capability_disabled: "This view can't reach Square. Open it in claude.ai or the Claude app.",
    no_host: "Open this page in claude.ai or the Claude app to connect Square.",
    tool_error: "Square reported an error: " + ((e && e.message) || "no details"),
    square_error: "Square reported an error: " + ((e && e.message) || "no details"),
    bad_payload: "Square sent back something unexpected. Tap Update to try again.",
    network: "Can't reach the server. Check your connection, then tap Update.",
    not_configured: "The server isn't set up yet.",
    server: "The server had a problem. Tap Update to try again."
  };
  return { code, msg: m[code] || `Couldn't read Square (${code || "unknown"}). Tap Update to try again.` };
}
const DIMS = ["ModifierSales.modifier_list_name", "ModifierSales.modifier_name", "ModifierSales.item_name"];
async function syncSquare(force) {
  if (S.syncing || !S.booted) return;
  const ep = S.epoch;
  S.syncing = true; renderStatus();
  try {
    const now = new Date(), today = E.businessDate(now);
    let start = today + "T04:00:00";
    for (const c of Object.values(latestCounts())) { const st = E.localStamp(new Date(c.at)); if (st < start) start = st; }
    const floor = E.addDays(today, -45) + "T04:00:00"; if (start < floor) start = floor;
    const end = E.localStamp(new Date(now.getTime() + 3600e3));
    const [d, h] = await Promise.all([
      Store.sales({ query: { measures: ["ModifierSales.net_quantity"], dimensions: DIMS, timeDimensions: [{ dimension: "ModifierSales.reporting_day", dateRange: [E.addDays(today, -35), today], granularity: "day" }], limit: 10000, timezone: E.TZ } }, force),
      Store.sales({ query: { measures: ["ModifierSales.net_quantity"], dimensions: DIMS, timeDimensions: [{ dimension: "ModifierSales.local_reporting_timestamp", dateRange: [start.slice(0, 13) + ":00:00", end], granularity: "hour" }], limit: 10000 } }, force)
    ]);
    if (ep !== S.epoch) return; // signed out while Square was answering
    const pick = (r, k) => ({ list: r["ModifierSales.modifier_list_name"] || "", mod: r["ModifierSales.modifier_name"] || "", item: r["ModifierSales.item_name"] || "", t: String(r[k] || ""), qty: +r["ModifierSales.net_quantity"] || 0 });
    S.daily = d.rows.map(r => { const x = pick(r, "ModifierSales.reporting_day.day"); x.day = x.t.slice(0, 10); return x; }).filter(r => r.day);
    S.hourly = h.rows.map(r => { const x = pick(r, "ModifierSales.local_reporting_timestamp.hour"); x.hour = x.t.slice(0, 19); return x; }).filter(r => r.hour);
    S.truncated = d.rows.length >= 10000 || h.rows.length >= 10000;
    S.lastSync = Math.min(d.at, h.at);
    S.sq = { state: "ok" };
  } catch (e) {
    if (ep !== S.epoch) return;
    if (e && (e.code === "wrong_passcode" || e.code === "too_many_attempts")) return lockOut(gateMsg(e, true));
    const er = sqError(e); S.sq = { state: "error", code: er.code, msg: er.msg };
  } finally { if (ep === S.epoch) { S.syncing = false; render(); } }
}

// ---------- model ----------
function model() {
  const st = settings(), ns = nowStamp(), today = E.stampBusinessDate(ns), cal = ns.slice(0, 10);
  const m = { st, today, cal, ns, ready: false };
  if (!S.daily || !S.hourly) return m;
  const { base, usage } = E.dailyTables(S.daily);
  const est = E.estimates(S.data.counts, S.data.deliveries, S.hourly, st);
  Object.assign(m, { base, usage, stock: est.stock, unmapped: est.unmapped });
  const sold = {}, start = today + "T04:00:00";
  for (const r of S.hourly) if (r.hour >= start && r.list === "Ice Cream Base") {
    const k = { Vanilla: "vanilla", Chocolate: "chocolate", Exclusive: "exclusive" }[r.mod]; if (k) sold[k] = (sold[k] || 0) + r.qty;
  }
  m.soldTonight = sold;
  const placed = S.data.orders.filter(o => o.status === "placed");
  m.due = placed.filter(o => o.arrivesOn <= cal);
  m.pendingGordon = placed.filter(o => o.supplier === "gordon");
  m.iceKnown = ["vanilla", "chocolate"].every(k => m.stock[k]);
  if (m.iceKnown) {
    const now0 = {}; for (const f of E.ICE) now0[f] = m.stock[f] ? Math.max(0, m.stock[f].value) : 0;
    m.stockNow = now0;
    m.plan = E.planGordon({ stock: now0, soldTonight: sold, pending: m.pendingGordon, base, settings: st, nowStamp: ns });
    m.week = E.simulateWeek({ stock: now0, soldTonight: sold, pending: m.pendingGordon, todayPlan: m.plan, base, settings: st, nowStamp: ns });
  }
  m.sup = E.planSupplies({ stock: m.stock, base, usage, settings: st, nowStamp: ns });
  m.floorTonight = E.nightFloor(today, st);
  m.ready = true;
  return m;
}

// ---------- render ----------
function renderStatus() {
  if (!$("status")) return;
  const st = settings(), today = E.businessDate(new Date());
  const closed = (st.closedDates || []).includes(today);
  const open = closed ? "Closed tonight" : `Open tonight ${HOURS[E.weekday(today)]}`;
  let sync;
  if (S.syncing) sync = `<span><span class="dot wait"></span>Updating sales…</span>`;
  else if (S.sq.state === "ok") { const ago = Math.max(0, Math.round((Date.now() - S.lastSync) / 60000)); sync = `<span><span class="dot ok"></span>Sales updated ${ago < 1 ? "just now" : ago + " min ago"}</span>`; }
  else if (S.sq.state === "error") sync = `<span><span class="dot bad"></span>Sales not updated</span>`;
  else sync = `<span><span class="dot wait"></span>Loading sales…</span>`;
  $("status").innerHTML = `<span>${open}</span>${sync}<button class="btn quiet small" data-act="refresh">Update</button>`;
}
function render() {
  if (!$("shell")) return;
  renderStatus();
  const m = model();
  let a = "";
  if (S.booted && !S.canSave) a += `<div class="flag now"><strong>Counts can't be saved here.</strong><span>Open the app from its link.</span></div>`;
  if (S.sq.state === "error") a += `<div class="flag now"><strong>Sales aren't updating.</strong><span>${esc(S.sq.msg)}</span>${S.sq.code === "approval_required" ? `<div class="actions"><button class="btn primary" data-act="refresh">Allow Square</button></div>` : ""}</div>`;
  if (m.ready && m.unmapped && m.unmapped.length) a += `<div class="flag soon"><strong>New items in Square</strong><span>Not tracked yet: ${m.unmapped.map(esc).join(", ")}. Ask Claude to add them.</span></div>`;
  if (S.truncated) a += `<div class="flag soon"><span>Some items haven't been counted in a long time. Recount them so their numbers stay accurate.</span></div>`;
  $("alerts").innerHTML = a;
  renderFreezer(m); renderGordon(m); renderSams(m); renderPantry(m); renderWeek(m); renderActivity(m);
}

const LID = { v: ["var(--van)", "var(--van-rim)"], c: ["var(--choc)", "var(--choc-rim)"], e: ["var(--mint)", "var(--mint-rim)"] };
function lidSVG(kind, frac, over) {
  if (!kind) return `<svg class="lid" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" fill="none" stroke="var(--rule-strong)" stroke-width="3" stroke-dasharray="6 7"/></svg>`;
  const [fill, rim0] = LID[kind], rim = over ? "var(--now)" : rim0;
  let inner;
  if (frac >= 0.999) inner = `<circle cx="50" cy="50" r="39" fill="${fill}"/>`;
  else {
    const a = frac * 2 * Math.PI, x = 50 + 39 * Math.sin(a), y = 50 - 39 * Math.cos(a);
    inner = `<circle cx="50" cy="50" r="39" fill="var(--tub-empty)"/><path d="M50 50 L50 11 A39 39 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z" fill="${fill}"/>`;
  }
  return `<svg class="lid" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="var(--surface)" stroke="${rim}" stroke-width="${over ? 6 : 4}"/>${inner}<circle cx="50" cy="50" r="39" fill="none" stroke="${rim}" stroke-opacity="0.35" stroke-width="1.5"/></svg>`;
}
function renderFreezer(m) {
  const el = $("freezer"), st = m.st, lc = latestCounts();
  if (!lc.vanilla || !lc.chocolate) {
    el.innerHTML = `<div class="section-head"><h2>Freezer</h2></div><div class="empty">No ice cream count yet. Tap <strong>Count</strong> and enter the tubs of each flavor, in quarters.</div>`;
    return;
  }
  const val = k => m.stock && m.stock[k] ? Math.max(0, m.stock[k].value) : (lc[k] ? lc[k].value : 0);
  const v = val("vanilla"), c = val("chocolate"), e = val("exclusive");
  const total = v + c + e, cap = st.cap, slots = Math.max(cap, Math.ceil(total - 1e-9));
  const floor = E.nightFloor(m.today, st);
  const cells = [];
  for (const [k, n] of [["v", v], ["c", c], ["e", e]]) { let r = E.quarter(n); while (r > 0.01) { const f = Math.min(1, r); cells.push({ k, f }); r -= f; } }
  let lids = "";
  for (let i = 0; i < slots; i++) lids += cells[i] ? lidSVG(cells[i].k, cells[i].f, i >= cap) : lidSVG(null);
  let segs = "";
  for (let i = 0; i < cap; i++) { const f = Math.max(0, Math.min(1, total - i)); segs += `<span class="seg"><i style="width:${Math.round(f * 100)}%"></i></span>`; }
  const state = total > cap ? `<span class="pill now">Over by ${fmtQ(total - cap)}</span>` : total < floor ? `<span class="pill soon">Below ${floor}</span>` : `<span class="pill ok">Room for ${fmtQ(cap - total)}</span>`;
  const tally = (k, kind) => {
    const s = m.stock && m.stock[k], cnt = lc[k];
    let sub = "Not counted";
    if (s) {
      const bits = [`Counted ${fmtQ(s.counted)} ${when(s.countedAt)}`];
      if (s.delivered) bits.push(`${fmtQ(s.delivered)} delivered`);
      if (s.used > 0.05) bits.push(`${fmtQ(s.used)} sold since`);
      sub = bits.join(", ");
    } else if (cnt) sub = `Counted ${when(cnt.at)}`;
    return `<div class="tally"><span class="name"><span class="swatch" style="background:${LID[kind][0]};border-color:${LID[kind][1]}"></span>${esc(nameOf(k, st))}</span><span class="n">${fmtQ(val(k))}<small>tubs</small></span><span class="sub">${sub}</span></div>`;
  };
  const showE = exOn(st) || e > 0.01;
  el.innerHTML = `
    <div class="section-head"><h2>Freezer</h2>${state}</div>
    <div class="freezer"><div class="freezer-well" role="img" aria-label="${fmtQ(total)} of ${cap} tubs: ${fmtQ(v)} vanilla, ${fmtQ(c)} chocolate${showE ? ", " + fmtQ(e) + " " + esc(nameOf("exclusive", st)) : ""}">${lids}</div></div>
    <div class="readout"><span class="big">${fmtQ(total)}<span>of ${cap} tubs</span></span></div>
    <div class="meter" style="--cap:${cap}" aria-hidden="true"><span class="floormark" style="left:${(floor / cap) * 100}%">Floor ${floor} tonight</span>${segs}</div>
    <div class="tallies">${tally("vanilla", "v")}${tally("chocolate", "c")}${showE ? tally("exclusive", "e") : ""}</div>`;
}

function lineHTML(key, qty, st, note) {
  const c = E.BY_KEY[key], code = codeOf(key, st), price = priceOf(key, st);
  const label = c.group === "ice" ? `${nameOf(key, st)} tub${qty === 1 ? "" : "s"}` : (c.buy || c.name);
  const sub = [`from ${SUP[c.supplier]}`, code ? `item ${code}` : "", note || ""].filter(Boolean).join(", ");
  return `<div class="line"><span class="q">${qty}</span><span class="what">${esc(label)}<br><span class="code">${esc(sub)}</span></span><span class="cost">${price ? money(qty * price) : ""}</span></div>`;
}
function orderText(lines, st, supplier, extra) {
  return `${SUP[supplier]} order${extra ? ", " + extra : ""}\n` + Object.entries(lines).filter(([, q]) => q > 0).map(([k, q]) => {
    const code = codeOf(k, st); return `${lineLabel(k, q, st)}${code ? " (item " + code + ")" : ""}`;
  }).join("\n");
}
function dueHTML(m, supplier) {
  return (m.due || []).filter(o => o.supplier === supplier).map(o => {
    const items = Object.entries(o.lines || {}).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${nameOf(k, m.st).toLowerCase()}`).join(", ");
    const late = o.arrivesOn < m.cal;
    return `<div class="flag soon"><strong>${SUP[supplier]} delivery ${late ? "was due " + E.DOW_LONG[E.weekday(o.arrivesOn)] : "due today"}${o.window ? ", " + esc(o.window) : ""}</strong><span>${esc(items)}</span><div class="actions"><button class="btn primary" data-act="arrived" data-id="${esc(o.id)}">It arrived</button><button class="btn" data-act="notcoming" data-id="${esc(o.id)}">It didn't come</button></div></div>`;
  }).join("");
}
function windowsText(p, cal) {
  const day = p.arriveOn === cal ? "today" : "tomorrow";
  return p.windows.map(w => `by ${clock(w.cutoff)} ${day} for ${w.label}`).join(", or ");
}
function renderGordon(m) {
  const el = $("gordon"), st = m.st;
  if (!m.ready) { el.innerHTML = `<div class="panel"><h2>Gordon's</h2><p class="muted">${S.sq.state === "error" ? "Needs sales from Square to plan the order." : "Reading sales from Square…"}</p></div>`; return; }
  if (!m.iceKnown) { el.innerHTML = `<div class="panel"><h2>Gordon's</h2><p class="muted">Count vanilla and chocolate to get today's order.</p></div>`; return; }
  const p = m.plan, due = dueHTML(m, "gordon"), gplan = m.sup.plans.gordon;
  const urgent = p.urgent.length ? `<div class="flag soon"><span>A busy night could take ${p.urgent.map(f => nameOf(f, st).toLowerCase()).join(" and ")} under tonight's floor. The next Gordon's delivery can't arrive until ${dayWord(p.arriveOn, m.cal)} afternoon.</span></div>` : "";
  S.lastGordon = null;
  if (p.mode === "order") {
    const ice = Object.entries(p.order).filter(([, q]) => q > 0);
    const addons = (gplan.basket || []).filter(x => x.cover < 21);
    const lines = Object.assign({}, p.order); addons.forEach(x => { lines[x.key] = x.packs; });
    const total = Object.entries(lines).reduce((s, [k, q]) => s + q * priceOf(k, st), 0);
    const fee = total < st.gordon.minimum;
    S.lastGordon = { lines, arriveOn: p.arriveOn, window: p.windows[p.windows.length - 1].label };
    const day = dayWord(p.arriveOn, m.cal);
    el.innerHTML = `${due}<div class="panel act">
      <div class="section-head"><h2>${p.arriveOn === m.cal ? "Order from Gordon's this morning" : "Order from Gordon's tomorrow morning"}</h2><span class="when-chip">Arrives ${day}</span></div>
      <p class="lead">${ice.map(([k, q]) => lineLabel(k, q, st)).join(" and ")} from Gordon's${addons.length ? ", plus " + addons.map(x => nameOf(x.key, st).toLowerCase()).join(" and ") : ""}.</p>
      <p class="note">Order ${windowsText(p, m.cal)} delivery. ${esc(p.reasons.join(". "))} without it.</p>
      <div class="lines">${Object.entries(lines).map(([k, q]) => lineHTML(k, q, st, E.BY_KEY[k].group !== "ice" ? "running low, added to save a delivery" : "")).join("")}</div>
      <div class="sum"><span>Total</span><span class="tnum">${money(total)}</span></div>
      ${fee ? `<div class="flag soon"><span>Under ${money(st.gordon.minimum)}, Gordon's adds a ${money(st.gordon.fee)} delivery fee.</span></div>` : ""}
      <p class="note">When it arrives the freezer will hold about ${fmtQ(p.atArrival)} of ${st.cap} tubs.</p>
      ${urgent}
      <div class="actions"><button class="btn primary" data-act="place-gordon">I placed this order</button><button class="btn" data-act="copy-gordon">Copy order</button></div></div>`;
  } else if (p.mode === "ordered") {
    const os = m.pendingGordon.filter(o => o.arrivesOn === p.arriveOn), id = os[0] && os[0].id;
    const items = os.flatMap(x => Object.entries(x.lines || {}).filter(([, q]) => q > 0)).map(([k, q]) => lineHTML(k, q, st)).join("");
    el.innerHTML = `${due}<div class="panel">
      <div class="section-head"><h2>Gordon's order is in</h2><span class="pill ok">Arrives ${dayWord(p.arriveOn, m.cal)}</span></div>
      <div class="lines">${items}</div>
      ${p.trim ? `<div class="flag now"><strong>Cut ${p.trim.over} ${esc(nameOf(p.trim.flavor, st).toLowerCase())} from this order.</strong><span>Tonight was slower than planned. As ordered, the freezer would hit about ${fmtQ(p.atArrival)} tubs. Change it in Gordon Ordering, then update it here.</span><div class="actions"><button class="btn primary" data-act="edit-order" data-id="${esc(id)}">Update the order</button></div></div>` : `<p class="note">The freezer should hold about ${fmtQ(p.atArrival)} of ${st.cap} tubs after it arrives.</p>`}
      ${urgent}<div class="actions"><button class="btn" data-act="edit-order" data-id="${esc(id)}">Change quantities</button></div></div>`;
  } else {
    const next = (m.week || []).find((n, k) => k > 0 && n.ordered);
    const nextTxt = next ? `Next order is likely ${E.DOW_LONG[E.weekday(next.ds)]} morning, about ${Object.entries(next.ordered).filter(([, q]) => q > 0).map(([k, q]) => lineLabel(k, q, st).toLowerCase()).join(" and ")} from Gordon's.` : "No Gordon's order looks needed this week.";
    const fl = p.floorA0 ? `${fmtQ(p.floorA0.vanilla)} vanilla and ${fmtQ(p.floorA0.chocolate)} chocolate` : "";
    el.innerHTML = `${due}<div class="panel">
      <div class="section-head"><h2>No Gordon's order ${p.arriveOn === m.cal ? "today" : "needed tomorrow"}</h2><span class="pill ok">Stocked</span></div>
      <p>${p.mode === "full" ? `There's no room to add tubs without going over ${st.cap}.` : p.smallSkipped ? `Only a small top-up would fit, which would cost the ${money(st.gordon.fee)} fee. You stay close to the floor, so it waits for the next order.` : `Even a busy ${E.DOW_LONG[E.weekday(p.arriveOn)]} night leaves you above the floor of ${fl}.`} ${nextTxt}</p>${urgent}
      <div class="actions"><button class="btn" data-act="log-gordon">Log an order you placed</button></div></div>`;
  }
}
function renderSams(m) {
  const el = $("sams"), st = m.st;
  if (!m.ready) { el.innerHTML = ""; return; }
  const due = dueHTML(m, "sams"), plan = m.sup.plans.sams;
  S.lastSams = null;
  const counted = m.sup.rows.some(r => E.BY_KEY[r.key].supplier === "sams" && r.status !== "uncounted");
  if (!counted) { el.innerHTML = due + `<div class="panel"><h2>Sam's Club</h2><p class="muted">Count your mix-ins to plan Sam's orders.</p></div>`; return; }
  if (!plan.basket.length) { el.innerHTML = due + `<div class="panel"><div class="section-head"><h2>Sam's Club</h2><span class="pill ok">Stocked</span></div><p>Nothing needed for at least ${st.supplies.topUpBelow} nights.</p><div class="actions"><button class="btn" data-act="log-sams">Log an order you placed</button></div></div>`; return; }
  const lines = Object.fromEntries(plan.basket.map(x => [x.key, x.packs]));
  const total = plan.value, fee = total < st.supplies.samsMinimum;
  const needDay = plan.orderToday ? m.today : plan.needBy;
  // When something is due, say which night it would run out, so the deadline is clear at any hour.
  const dueCover = plan.orderToday ? Math.min(...m.sup.rows.filter(r => plan.due.includes(r.key)).map(r => r.cover)) : null;
  const runOut = dueCover == null ? null : E.addDays(m.today, dueCover);
  const head = !plan.orderToday ? `Next Sam's Club order ${needDay ? E.DOW_LONG[E.weekday(needDay)] : "this week"}`
    : dueCover <= 0 ? "Order from Sam's Club right away"
    : `Order from Sam's Club, needed before ${runOut === E.addDays(m.today, 1) ? "tomorrow night" : E.DOW_LONG[E.weekday(runOut)] + " night"}`;
  S.lastSams = { lines };
  el.innerHTML = `${due}<div class="panel ${plan.orderToday ? "act" : ""}">
    <div class="section-head"><h2>${head}</h2><span class="${plan.orderToday ? "when-chip" : "pill soon"}">${plan.orderToday ? "Order now" : "Planned"}</span></div>
    <p class="note">${plan.orderToday ? `${plan.due.map(k => nameOf(k, st)).join(" and ")} can't wait another day.` : "Nothing is urgent yet. This is what the order will look like."} Everything running low is grouped into one order with about ${st.supplies.coverTo} nights of each.</p>
    <div class="lines">${plan.basket.map(x => lineHTML(x.key, x.packs, st, x.filler ? "added to reach the delivery minimum" : `about ${x.cover} night${x.cover === 1 ? "" : "s"} left`)).join("")}</div>
    <div class="sum"><span>Total</span><span class="tnum">${money(total)}</span></div>
    ${fee ? `<div class="flag soon"><span>Still under ${money(st.supplies.samsMinimum)}, so Sam's may add a delivery fee.</span></div>` : ""}
    <div class="actions">${plan.orderToday ? `<button class="btn primary" data-act="place-sams">I placed this order</button>` : ""}<button class="btn" data-act="copy-sams">Copy list</button>${!plan.orderToday ? `<button class="btn" data-act="place-sams">Order it now anyway</button>` : ""}</div></div>`;
}

function pkgSVG(c, frac) {
  const col = c.color || "var(--accent)";
  const h = Math.max(0, Math.min(1, frac));
  if (c.unit === "bag") {
    return `<svg class="pkg" viewBox="0 0 16 24" aria-hidden="true"><defs><clipPath id="b${c.key}${Math.round(h * 100)}"><path d="M2 3h12l1 17a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z"/></clipPath></defs><path d="M2 3h12l1 17a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z" fill="var(--tub-empty)"/><rect x="0" y="${(24 - 21 * h).toFixed(2)}" width="16" height="24" fill="${col}" clip-path="url(#b${c.key}${Math.round(h * 100)})"/><path d="M2 3h12l1 17a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z" fill="none" stroke="var(--rule-strong)" stroke-width="1"/><path d="M1.5 1.5h13" stroke="var(--rule-strong)" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }
  return `<svg class="pkg" viewBox="0 0 16 24" aria-hidden="true"><rect x="1" y="3" width="14" height="20" rx="1.5" fill="var(--tub-empty)"/><rect x="1" y="${(3 + 20 * (1 - h)).toFixed(2)}" width="14" height="${(20 * h).toFixed(2)}" fill="${col}"/><rect x="1" y="3" width="14" height="20" rx="1.5" fill="none" stroke="var(--rule-strong)" stroke-width="1"/><path d="M1 3l2-2h10l2 2" fill="none" stroke="var(--rule-strong)" stroke-width="1"/></svg>`;
}
function renderPantry(m) {
  const el = $("pantry");
  if (!m.ready) { el.innerHTML = `<div class="section-head"><h2>Pantry</h2></div><div class="empty">${S.sq.state === "error" ? "Needs sales from Square." : "Reading sales from Square…"}</div>`; return; }
  const rows = m.sup.rows, label = { now: "Order now", soon: "Order soon", ok: "Fine" };
  const SHELVES = [["cereal", "Cereal"], ["cookies", "Cookies, brownies and grahams"], ["fruit", "Fruit"], ["other", "Matcha and granola"], ["supply", "Spoons and float sodas"]];
  let html = "";
  for (const [shelf, title] of SHELVES) {
    const mine = rows.filter(r => E.BY_KEY[r.key].shelf === shelf && r.status !== "uncounted");
    if (!mine.length) continue;
    html += `<div class="shelf"><div class="shelf-name">${title}</div><div class="goods">` + mine.map(r => {
      const c = E.BY_KEY[r.key];
      let units = Math.max(0, r.stock), amt = E.fmtUnits(r.key, r.stock), icons = "";
      if (c.key === "brownies") { units = units / 48; amt = `${Math.round(Math.max(0, r.stock))} servings`; }
      if (c.key === "oreos") amt += `, ${Math.round(Math.max(0, r.stock) * 156)} cookies`;
      if (c.unit === "can") icons = `<span class="amt">${Math.round(units)}</span>`;
      else {
        const full = Math.floor(units + 1e-9), part = units - full, show = Math.min(full, 5);
        for (let i = 0; i < show; i++) icons += pkgSVG(c, 1);
        if (full > 5) icons += `<span class="more">+${full - 5}</span>`;
        if (part > 0.06 || units < 0.06) icons += pkgSVG(c, part);
      }
      const pct = c.unit !== "can" && units < 1 ? `${Math.round(units * 100)}% of a ${c.key === "brownies" ? "Little Debbie box" : c.unit} left` : amt;
      const left = r.cover >= 28 ? "4+ weeks" : `${r.cover} night${r.cover === 1 ? "" : "s"}`;
      return `<div class="good"><div class="pkgs">${icons}</div><div><div class="nm">${esc(c.name)}</div><div class="meta">${esc(pct)}</div></div><div class="right"><span class="pill ${r.status}">${label[r.status]}</span><span class="meta">${left}</span></div></div>`;
    }).join("") + `</div></div>`;
  }
  const unc = rows.filter(r => r.status === "uncounted");
  el.innerHTML = `<div class="section-head"><h2>Pantry</h2><span class="small muted">Nights each item lasts at a busy pace</span></div>
    ${html || `<div class="empty">Count your mix-ins once and they show up here, with how full each box or bag is.</div>`}
    ${unc.length ? `<details class="more"><summary>Not counted yet (${unc.length})</summary><p>${unc.map(r => esc(E.BY_KEY[r.key].name)).join(", ")}. Count them once from the Count button and the app keeps track from then on.</p></details>` : ""}`;
}
function renderWeek(m) {
  const el = $("week"), st = m.st;
  if (!m.ready || !m.week) { el.innerHTML = `<div class="section-head"><h2>Next 7 nights</h2></div><div class="empty">${m.ready ? "Count vanilla and chocolate to see the week." : "Appears once sales load from Square."}</div>`; return; }
  const tot = o => E.ICE.reduce((s, f) => s + (o[f] || 0), 0);
  const maxY = Math.max(st.cap + 1.5, ...m.week.map(n => tot(n.pre)));
  const pct = v => (v / maxY) * 100;
  const bars = m.week.map(n => {
    const pre = tot(n.pre);
    const seg = [["vanilla", "var(--van)"], ["chocolate", "var(--choc)"], ["exclusive", "var(--mint)"]].filter(([f]) => n.pre[f] > 0.01)
      .map(([f, col]) => `<b style="height:${(n.pre[f] / Math.max(pre, 0.01)) * 100}%;background:${col}"></b>`).join("");
    return `<div class="bar"><div class="stack" style="height:${pct(pre)}%">${seg}</div><span class="after" style="bottom:${pct(tot(n.post))}%"></span><span class="fl" style="bottom:${pct(n.floor)}%"></span><span class="lbl" style="bottom:calc(${pct(pre)}% + 4px)">${fmtQ(pre)}</span></div>`;
  }).join("");
  const days = m.week.map((n, k) => {
    const arr = n.arrived ? tot(n.arrived) : 0;
    return `<div><strong>${k === 0 ? "Tonight" : E.DOW[E.weekday(n.ds)]}</strong>${n.closed ? `<span class="muted">Closed</span>` : arr ? `<span class="arr">+${arr} in</span>` : `<span class="muted">&nbsp;</span>`}</div>`;
  }).join("");
  el.innerHTML = `<div class="section-head"><h2>Next 7 nights</h2><span class="small muted">Tubs in the freezer when each night opens</span></div>
    <div class="week"><div class="plot">${bars}<span class="hline cap" style="bottom:${pct(st.cap)}%"><span>Most ${st.cap}</span></span></div><div class="days">${days}</div></div>
    <p class="note">The dark tick is where an average night leaves you. The purple tick is that night's floor (${st.floors.sunWed} Sunday to Wednesday, ${st.floors.thuSat} Thursday to Saturday). Later deliveries assume each morning's suggested Gordon's order gets placed.</p>`;
}
function renderActivity(m) {
  const el = $("activity"), ev = [], byAt = {};
  for (const c of S.data.counts) (byAt[c.at] ||= []).push(c);
  for (const at in byAt) ev.push({ at, t: "Counted " + byAt[at].map(c => `${nameOf(c.item, m.st).toLowerCase()} ${c.item === "brownies" || E.BY_KEY[c.item].step === 1 ? Math.round(c.value) : fmtQ(c.value)}`).join(", ") });
  for (const d of S.data.deliveries) ev.push({ at: d.at, t: `Received ${E.BY_KEY[d.item] && E.BY_KEY[d.item].step === 1 ? d.qty : fmtQ(d.qty)} ${nameOf(d.item, m.st).toLowerCase()}${SUP[d.source] ? " from " + SUP[d.source] : ""}` });
  for (const o of S.data.orders) ev.push({ at: o.placedAt, t: `Ordered from ${SUP[o.supplier]} for ${dayWord(o.arrivesOn, m.cal)}: ${Object.entries(o.lines || {}).filter(([, q]) => q > 0).map(([k, q]) => q + " " + nameOf(k, m.st).toLowerCase()).join(", ")}${o.status === "cancelled" ? " (didn't come)" : o.status === "arrived" ? " (arrived)" : ""}` });
  for (const n of (m.st.learnLog || []).slice(-6)) ev.push({ at: n.at, t: n.note });
  ev.sort((a, b) => (a.at < b.at ? 1 : -1));
  el.innerHTML = `<div class="section-head"><h2>Activity</h2></div>${ev.length ? `<div class="log">${ev.slice(0, 12).map(e => `<div><time>${esc(when(e.at))}</time><span>${esc(e.t)}</span></div>`).join("")}</div>` : `<div class="empty">Counts, orders and deliveries will show up here.</div>`}`;
}

// ---------- sheets ----------
let sheet = null;
function openSheet(kind, data) { sheet = { kind, data }; renderSheet(); }
function closeSheet() { sheet = null; $("sheetRoot").innerHTML = ""; }
const stepper = (id, shown) => `<div class="stepper"><button type="button" data-step="-1" data-id="${id}" aria-label="Less">−</button><span class="v" id="v-${id}">${shown}</span><button type="button" data-step="1" data-id="${id}" aria-label="More">+</button></div>`;
function renderSheet() {
  if (!sheet) return;
  const st = settings(), d = sheet.data;
  let title = "", body = "", foot = "";
  if (sheet.kind === "count") {
    title = "Count";
    const row = k => {
      const c = E.BY_KEY[k], v = d.vals[k], shown = c.step === 1 ? String(Math.round(v)) : fmtQ(v);
      const app = d.est[k] != null ? `App says ${c.step === 1 ? Math.round(d.est[k]) : fmtQ(d.est[k])}` : "Not counted yet";
      return `<div class="crow ${d.touched[k] ? "touched" : ""}"><div><div class="cname">${esc(nameOf(k, st))}</div><div class="csub">${esc(c.unit)}${c.unitNote ? " of " + esc(c.unitNote) : ""}. ${app}</div></div>${stepper(k, shown)}</div>`;
    };
    const brownies = `<div class="crow ${d.touched.brownies ? "touched" : ""}"><div><div class="cname">Brownies</div><div class="csub">${Math.round(d.vals.bLd * 48 + d.vals.bLoose)} servings. Little Debbie box = 48, small brownie = 1</div></div><span></span></div>
      <div class="crow"><div class="csub">Little Debbie boxes</div>${stepper("bLd", fmtQ(d.vals.bLd))}</div>
      <div class="crow"><div class="csub">Loose small brownies</div>${stepper("bLoose", String(Math.round(d.vals.bLoose)))}</div>`;
    const ice = ["vanilla", "chocolate"].concat(exOn(st) || (d.est.exclusive || 0) > 0 ? ["exclusive"] : []);
    body = `<p class="note" style="margin-top:10px">Tap + or − in quarters. Only rows you change get saved (green dot), and each becomes the new starting point. If a number is already right, tap + then − to confirm it.</p>
      <div class="grp">Ice cream, in tubs</div>${ice.map(row).join("")}
      <div class="grp">Mix-ins</div>${E.CATALOG.filter(c => c.group === "mix").map(c => c.key === "brownies" ? brownies : row(c.key)).join("")}
      <div class="grp">Supplies</div>${E.CATALOG.filter(c => c.group === "supply").map(c => row(c.key)).join("")}`;
    const n = Object.values(d.touched).filter(Boolean).length;
    foot = `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-count" ${n ? "" : "disabled"}>${n ? `Save ${n} count${n === 1 ? "" : "s"}` : "Save counts"}</button>`;
  } else if (sheet.kind === "order") {
    title = d.edit ? "Change the order" : `Order placed with ${SUP[d.supplier]}`;
    const cal = calToday();
    body = `<p class="note" style="margin-top:10px">Set what you actually ordered from ${SUP[d.supplier]}.</p>` + Object.keys(d.lines).map(k => `<div class="crow"><div><div class="cname">${esc(nameOf(k, st))}</div><div class="csub">${E.BY_KEY[k].group === "ice" ? "tubs" : esc(E.BY_KEY[k].buy || "")}</div></div>${stepper("o-" + k, String(d.lines[k]))}</div>`).join("") +
      `<div class="field"><span class="cname">Arrives</span><select id="arrivesSel"><option value="${cal}" ${d.arrivesOn === cal ? "selected" : ""}>Today</option><option value="${E.addDays(cal, 1)}" ${d.arrivesOn === E.addDays(cal, 1) ? "selected" : ""}>Tomorrow</option></select></div>` +
      (d.supplier === "gordon" ? `<div class="field"><span class="cname">Window</span><select id="windowSel">${st.gordon.windows.map(w => `<option ${d.window === w.label ? "selected" : ""}>${esc(w.label)}</option>`).join("")}</select></div>` : "");
    foot = `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-order">${d.edit ? "Save changes" : "Save order"}</button>`;
  } else if (sheet.kind === "arrive") {
    title = "What arrived?";
    body = `<p class="note" style="margin-top:10px">Lower anything that came short. This adds it to stock.</p>` + Object.keys(d.lines).map(k => `<div class="crow"><div><div class="cname">${esc(nameOf(k, st))}</div>${E.BY_KEY[k].buy ? `<div class="csub">${esc(E.BY_KEY[k].buy)}</div>` : ""}</div>${stepper("a-" + k, String(d.lines[k]))}</div>`).join("");
    foot = `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-arrive">Add to stock</button>`;
  } else if (sheet.kind === "delivery") {
    title = "Add a delivery";
    const c = E.BY_KEY[d.item];
    body = `<p class="note" style="margin-top:10px">For anything you picked up or got delivered outside an order saved here.</p>
      <div class="field"><span class="cname">Item</span><select id="delItem">${E.CATALOG.map(x => `<option value="${x.key}" ${d.item === x.key ? "selected" : ""}>${esc(nameOf(x.key, st))}</option>`).join("")}</select></div>
      <div class="crow"><div><div class="cname">Amount</div><div class="csub">${esc(c.unit === "box" ? "boxes" : c.unit + "s")}${c.unitNote ? " of " + esc(c.unitNote) : ""}</div></div>${stepper("del", c.step === 1 ? String(d.qty) : fmtQ(d.qty))}</div>
      <div class="field"><span class="cname">From</span><select id="delSrc"><option value="sams" ${c.supplier === "sams" ? "selected" : ""}>Sam's Club</option><option value="gordon" ${c.supplier === "gordon" ? "selected" : ""}>Gordon's</option><option value="other">Somewhere else</option></select></div>`;
    foot = `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-delivery" ${d.qty > 0 ? "" : "disabled"}>Add to stock</button>`;
  } else if (sheet.kind === "settings") {
    title = "Settings";
    const num = (id, label, val, step, sub) => `<div class="field"><span><span class="cname">${label}</span>${sub ? `<br><span class="csub">${sub}</span>` : ""}</span><input type="number" inputmode="decimal" id="${id}" value="${val}" step="${step}" min="0"></div>`;
    const time = (id, label, val) => `<div class="field"><span class="cname">${label}</span><input type="time" id="${id}" value="${val}" style="min-height:44px;padding:9px 11px;border-radius:10px;border:1px solid var(--rule-strong);background:var(--ground)"></div>`;
    body = `<div class="grp">Freezer</div>
      ${num("s-cap", "Most tubs ever", d.cap, 1, "No order ever takes the freezer past this")}
      ${num("s-fsw", "Floor, Sunday to Wednesday", d.floors.sunWed, 0.25, "Fewest tubs left at the end of the night")}
      ${num("s-fts", "Floor, Thursday to Saturday", d.floors.thuSat, 0.25, "Split between vanilla and chocolate by how they sell")}
      <div class="grp">Gordon's</div>
      ${time("s-c1", `Order by, for ${esc(d.gordon.windows[0].label)}`, d.gordon.windows[0].cutoff)}
      ${time("s-c2", `Order by, for ${esc(d.gordon.windows[1].label)}`, d.gordon.windows[1].cutoff)}
      ${num("s-gmin", "No fee from", d.gordon.minimum, 1, "Dollars")}
      <div class="grp">Sam's Club</div>
      ${num("s-smin", "Free delivery from", d.supplies.samsMinimum, 1, "Dollars. Orders get filled to this with the next items due")}
      ${num("s-cover", "Stock each order for", d.supplies.coverTo, 1, "Nights")}
      <div class="grp">Exclusive flavor</div>
      <div class="field"><label class="toggle" for="s-exon"><input type="checkbox" id="s-exon" ${d.exclusive.active ? "checked" : ""}>Carry an Exclusive flavor</label><span></span></div>
      <div class="field"><span class="cname">Flavor</span><select id="s-exname">${E.EXCLUSIVE_OPTIONS.map(o => `<option value="${esc(o.name)}" ${d.exclusive.name === o.name ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
      ${num("s-ext", "Tubs to keep", d.exclusive.target, 1)}
      <div class="grp">Servings per tub</div>
      ${num("s-yv", "Vanilla", d.yields.vanilla, 0.1, "Adjusts itself from your counts")}
      ${num("s-yc", "Chocolate", d.yields.chocolate, 0.1)}
      ${num("s-ye", "Exclusive", d.yields.exclusive, 0.1)}
      <div class="grp">Closed nights</div>
      <p class="note">Breaks and nights off. The app plans no sales for these.</p>
      <div class="field"><input type="date" id="s-cdate"><button class="btn" type="button" data-act="add-closed">Add night</button></div>
      ${(d.closedDates || []).slice().sort().map(ds => `<div class="field"><span class="tnum">${esc(new Date(ds + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }))}</span><button class="btn quiet" data-act="rm-closed" data-ds="${esc(ds)}">Remove</button></div>`).join("") || `<p class="note">None added yet.</p>`}
      ${Store.kind === "web" ? `<div class="grp">This phone</div><div class="field"><span class="csub">Forget the passcode on this device</span><button class="btn" type="button" data-act="signout">Sign out</button></div>` : ""}`;
    foot = `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-settings">Save settings</button>`;
  } else if (sheet.kind === "copy") {
    title = "Copy this";
    body = `<textarea id="copyBox" rows="8" style="width:100%;margin-top:12px;padding:10px;border-radius:10px;border:1px solid var(--rule-strong);background:var(--ground)">${esc(d.text)}</textarea>`;
    foot = `<button class="btn" data-act="close">Done</button>`;
  }
  $("sheetRoot").innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="btn quiet" data-act="close">Close</button></header><div class="body">${body}</div><footer>${foot}</footer></div></div>`;
  if (sheet.kind === "copy") { const t = $("copyBox"); t.focus(); t.select(); }
}

function openCount() {
  const m = model(), lc = latestCounts(), vals = {}, est = {};
  for (const c of E.CATALOG) {
    const s = m.stock && m.stock[c.key];
    const e = s ? Math.max(0, s.value) : (lc[c.key] ? lc[c.key].value : null);
    est[c.key] = e;
    vals[c.key] = e == null ? 0 : (c.step === 1 ? Math.round(e) : E.quarter(e));
  }
  const bEst = est.brownies, det = lc.brownies && lc.brownies.detail;
  vals.bLd = bEst != null ? Math.floor(bEst / 48 * 4) / 4 : 0;
  vals.bLoose = bEst != null ? Math.max(0, Math.round(bEst - vals.bLd * 48)) : 0;
  if (det && bEst != null && Math.abs(bEst - (det.ld * 48 + det.loose)) < 0.5) { vals.bLd = det.ld; vals.bLoose = det.loose; }
  openSheet("count", { vals, est, touched: {} });
}
function dbMsg(e) {
  const c = e && e.code;
  if (c === "wrong_passcode") return "The passcode stopped working. Sign in again.";
  if (c === "network") return "Can't reach the server. Check your connection and try again.";
  if (c === "invalid_argument" || c === "no_db") return "This view can't save. Open the app from its link.";
  if (c === "quota_exceeded") return "Storage is full. Ask Claude to clean up old entries.";
  return "Couldn't save. Try again in a moment.";
}
async function saveCount() {
  const d = sheet.data, st = settings(), m = model(), at = new Date().toISOString();
  const keys = Object.keys(d.touched).filter(k => d.touched[k]);
  const learned = { yields: {}, adjust: {} }, notes = [];
  try {
    for (const k of keys) {
      const value = k === "brownies" ? d.vals.bLd * 48 + d.vals.bLoose : d.vals[k];
      const L = E.learn(k, m.stock && m.stock[k], value, st);
      if (L) { if (L.yields) Object.assign(learned.yields, L.yields); if (L.adjust) Object.assign(learned.adjust, L.adjust); if (L.note || L.flag) notes.push({ at, note: L.note || L.flag }); }
      const doc = { item: k, value, at };
      if (k === "brownies") doc.detail = { ld: d.vals.bLd, loose: d.vals.bLoose };
      await Store.add("counts", doc);
    }
    if (Object.keys(learned.yields).length || Object.keys(learned.adjust).length || notes.length) {
      const next = settings();
      Object.assign(next.yields, learned.yields); next.adjust = Object.assign({}, next.adjust, learned.adjust);
      next.learnLog = (next.learnLog || []).concat(notes).slice(-12); next.updatedAt = at;
      await Store.set("config/settings", next);
    }
    closeSheet(); toast(`Saved ${keys.length} count${keys.length === 1 ? "" : "s"}`);
    if (notes.length) setTimeout(() => toast(notes[0].note), 3500);
  } catch (e) { toast(dbMsg(e)); }
}
async function saveOrder() {
  const d = sheet.data;
  const arrivesOn = $("arrivesSel") ? $("arrivesSel").value : d.arrivesOn;
  const win = $("windowSel") ? $("windowSel").value : d.window;
  const lines = {}; for (const k in d.lines) if (d.lines[k] > 0) lines[k] = d.lines[k];
  if (!Object.keys(lines).length && !d.edit) return toast("Add at least one item first.");
  try {
    if (d.edit) await Store.update("orders/" + d.id, { lines, arrivesOn, window: win || null });
    else await Store.add("orders", { supplier: d.supplier, lines, placedAt: new Date().toISOString(), arrivesOn, window: win || null, status: "placed" });
    closeSheet(); toast(d.edit ? "Order changed" : "Order saved");
  } catch (e) { toast(dbMsg(e)); }
}
async function saveArrive() {
  const d = sheet.data, at = new Date().toISOString();
  try {
    // Order lines are in store packs (a box of 48 brownie servings, a 49.5 oz cereal box);
    // stock is kept in counting units, so convert before adding.
    for (const k in d.lines) if (d.lines[k] > 0) await Store.add("deliveries", { item: k, qty: +(d.lines[k] * (E.BY_KEY[k].pack || 1)).toFixed(2), at, source: d.supplier, orderId: d.id });
    await Store.update("orders/" + d.id, { status: "arrived", arrivedAt: at, received: d.lines });
    closeSheet(); toast("Added to stock");
  } catch (e) { toast(dbMsg(e)); }
}
async function saveDelivery() {
  const d = sheet.data, item = $("delItem").value, src = $("delSrc").value;
  try { await Store.add("deliveries", { item, qty: d.qty, at: new Date().toISOString(), source: src }); closeSheet(); toast("Added to stock"); }
  catch (e) { toast(dbMsg(e)); }
}
function draftSettings() {
  const d = sheet.data, n = id => { const el = $(id); const v = el ? parseFloat(el.value) : NaN; return isNaN(v) ? null : v; }, keep = (v, o) => (v == null ? o : v);
  const t = (id, o) => { const el = $(id); return el && /^\d\d:\d\d$/.test(el.value) ? el.value : o; };
  d.cap = keep(n("s-cap"), d.cap);
  d.floors.sunWed = keep(n("s-fsw"), d.floors.sunWed); d.floors.thuSat = keep(n("s-fts"), d.floors.thuSat);
  d.gordon.windows[0].cutoff = t("s-c1", d.gordon.windows[0].cutoff); d.gordon.windows[1].cutoff = t("s-c2", d.gordon.windows[1].cutoff);
  d.gordon.minimum = keep(n("s-gmin"), d.gordon.minimum);
  d.supplies.samsMinimum = keep(n("s-smin"), d.supplies.samsMinimum); d.supplies.coverTo = keep(n("s-cover"), d.supplies.coverTo);
  if ($("s-exon")) d.exclusive.active = $("s-exon").checked;
  if ($("s-exname")) d.exclusive.name = $("s-exname").value;
  d.exclusive.target = keep(n("s-ext"), d.exclusive.target);
  d.yields.vanilla = keep(n("s-yv"), d.yields.vanilla); d.yields.chocolate = keep(n("s-yc"), d.yields.chocolate); d.yields.exclusive = keep(n("s-ye"), d.yields.exclusive);
  d.closedDates = d.closedDates || [];
  return d;
}
async function saveSettings() {
  const d = draftSettings(), next = settings();
  next.cap = Math.max(1, Math.round(d.cap));
  next.floors = { sunWed: Math.max(0, d.floors.sunWed), thuSat: Math.max(0, d.floors.thuSat) };
  next.gordon = { windows: d.gordon.windows, minimum: Math.max(0, d.gordon.minimum), fee: next.gordon.fee };
  next.supplies = { topUpBelow: next.supplies.topUpBelow, coverTo: Math.min(28, Math.max(5, Math.round(d.supplies.coverTo))), samsMinimum: Math.max(0, d.supplies.samsMinimum) };
  const opt = E.EXCLUSIVE_OPTIONS.find(o => o.name === d.exclusive.name) || E.EXCLUSIVE_OPTIONS[0];
  next.exclusive = { active: !!d.exclusive.active, name: opt.name, code: opt.code, price: opt.price, target: Math.max(1, Math.round(d.exclusive.target || 2)) };
  for (const f of ["vanilla", "chocolate", "exclusive"]) if (d.yields[f] >= 5 && d.yields[f] <= 60) next.yields[f] = d.yields[f];
  next.closedDates = d.closedDates; next.updatedAt = new Date().toISOString();
  try { await Store.set("config/settings", next); closeSheet(); toast("Settings saved"); } catch (e) { toast(dbMsg(e)); }
}
function copyText(text) {
  try { navigator.clipboard.writeText(text).then(() => toast("Copied"), () => openSheet("copy", { text })); } catch (_) { openSheet("copy", { text }); }
}

// ---------- events ----------
document.addEventListener("click", e => {
  const sb = e.target.closest("[data-step]");
  if (sb && sheet) {
    const id = sb.dataset.id, dir = +sb.dataset.step, d = sheet.data;
    if (sheet.kind === "count") {
      if (id === "bLd" || id === "bLoose") { d.vals[id] = Math.max(0, +(d.vals[id] + dir * (id === "bLd" ? 0.25 : 1)).toFixed(2)); d.touched.brownies = true; }
      else { d.vals[id] = Math.max(0, +(d.vals[id] + dir * E.BY_KEY[id].step).toFixed(2)); d.touched[id] = true; }
    } else if (sheet.kind === "order" || sheet.kind === "arrive") {
      const k = id.slice(2); d.lines[k] = Math.max(0, d.lines[k] + dir);
      if (sheet.kind === "order") { if ($("arrivesSel")) d.arrivesOn = $("arrivesSel").value; if ($("windowSel")) d.window = $("windowSel").value; }
    } else if (sheet.kind === "delivery") {
      d.item = $("delItem").value; d.qty = Math.max(0, +(d.qty + dir * E.BY_KEY[d.item].step).toFixed(2));
    }
    const body = document.querySelector(".sheet .body"), top = body ? body.scrollTop : 0;
    renderSheet(); const b2 = document.querySelector(".sheet .body"); if (b2) b2.scrollTop = top;
    return;
  }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;
  if (act === "scrim" && e.target !== el) return;
  switch (act) {
    case "scrim": case "close": closeSheet(); break;
    case "refresh": syncSquare(true); break;
    case "open-count": openCount(); break;
    case "open-delivery": openSheet("delivery", { item: "oreos", qty: 1 }); break;
    case "open-settings": openSheet("settings", JSON.parse(JSON.stringify(settings()))); break;
    case "place-gordon": if (S.lastGordon) openSheet("order", { supplier: "gordon", lines: Object.assign({}, S.lastGordon.lines), arrivesOn: S.lastGordon.arriveOn, window: S.lastGordon.window }); break;
    case "place-sams": if (S.lastSams) openSheet("order", { supplier: "sams", lines: Object.assign({}, S.lastSams.lines), arrivesOn: calToday() }); break;
    case "copy-gordon": if (S.lastGordon) copyText(orderText(S.lastGordon.lines, settings(), "gordon", `deliver ${dayWord(S.lastGordon.arriveOn, calToday())} ${S.lastGordon.window}`)); break;
    case "log-gordon": { const st = settings(), ns = nowStamp(), late = st.gordon.windows[st.gordon.windows.length - 1]; const lines = { vanilla: 0, chocolate: 0 }; if (exOn(st)) lines.exclusive = 0; lines.bananas = 0;
      openSheet("order", { supplier: "gordon", lines, arrivesOn: ns.slice(11, 16) < late.cutoff ? ns.slice(0, 10) : E.addDays(ns.slice(0, 10), 1), window: late.label }); break; }
    case "log-sams": { const lines = {}; E.CATALOG.filter(c => c.supplier === "sams").forEach(c => { lines[c.key] = 0; }); openSheet("order", { supplier: "sams", lines, arrivesOn: calToday() }); break; }
    case "copy-sams": if (S.lastSams) copyText(orderText(S.lastSams.lines, settings(), "sams")); break;
    case "edit-order": { const o = S.data.orders.find(x => x.id === el.dataset.id); if (o) openSheet("order", { edit: true, id: o.id, supplier: o.supplier, lines: Object.assign({}, o.lines), arrivesOn: o.arrivesOn, window: o.window }); break; }
    case "arrived": { const o = S.data.orders.find(x => x.id === el.dataset.id); if (o) openSheet("arrive", { id: o.id, supplier: o.supplier, lines: Object.assign({}, o.lines) }); break; }
    case "notcoming": Store.update("orders/" + el.dataset.id, { status: "cancelled" }).then(() => toast("Marked as not coming"), err => toast(dbMsg(err))); break;
    case "save-count": saveCount(); break;
    case "save-order": saveOrder(); break;
    case "save-arrive": saveArrive(); break;
    case "save-delivery": saveDelivery(); break;
    case "save-settings": saveSettings(); break;
    case "add-closed": { const v = $("s-cdate").value; if (v) { draftSettings(); if (!sheet.data.closedDates.includes(v)) sheet.data.closedDates.push(v); renderSheet(); } break; }
    case "rm-closed": draftSettings(); sheet.data.closedDates = sheet.data.closedDates.filter(x => x !== el.dataset.ds); renderSheet(); break;
    case "signout": lockOut(); break;
    case "retry-boot": boot(); break;
  }
});
document.addEventListener("change", e => { if (sheet && sheet.kind === "delivery" && e.target.id === "delItem") { sheet.data.item = e.target.value; sheet.data.qty = 1; renderSheet(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet) closeSheet(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.booted && (!S.lastSync || Date.now() - S.lastSync > 5 * 60e3)) syncSquare(false); });

// ---------- passcode gate (website only) ----------
// The rule: nothing from the app is drawn until the server has accepted the passcode,
// and signing out (or the passcode changing) wipes everything loaded so far.
const MARK = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true" style="width:52px;height:52px"><circle cx="20" cy="20" r="18" fill="var(--accent)"/><circle cx="20" cy="20" r="12.5" fill="var(--van)"/><path d="M20 20 L20 7.5 A12.5 12.5 0 0 1 32.5 20 Z" fill="var(--choc)"/></svg><div class="wordmark" style="font-size:1.4rem">Campus Creamery</div>`;
const isLock = e => !!e && (e.code === "wrong_passcode" || e.code === "too_many_attempts");
function gateMsg(e, remembered) {
  const c = e && e.code;
  if (c === "wrong_passcode") return remembered ? "That passcode no longer works. Enter the current one." : "That passcode didn't work. Try again.";
  if (c === "too_many_attempts") return "Too many wrong tries from this network. Wait 15 minutes, then try again.";
  if (c === "network") return "Couldn't reach the server. Check your internet, then try again.";
  if (c === "not_configured") return "The server isn't set up yet.";
  return "The server had a problem. Try again in a minute.";
}
function lockScreen(inner) {
  closeSheet(); $("toastRoot").innerHTML = "";
  $("root").innerHTML = `<div class="gate">${inner}</div>`;
}
function wipe() {
  S.epoch++;
  if (Store.signOut) Store.signOut();
  S.data = { settingsDoc: null, counts: [], deliveries: [], orders: [] };
  S.daily = null; S.hourly = null; S.truncated = false; S.lastSync = null;
  S.booted = false; S.canSave = false; S.syncing = false; S.sq = { state: "loading" };
}
function lockOut(msg) { wipe(); gate(msg); }
function gate(err) {
  lockScreen(`<form id="gateForm" novalidate>${MARK}
    <label for="pass" class="muted">Enter the shop passcode to open the freezer.</label>
    <input id="pass" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required>
    ${err ? `<div class="flag now" role="alert"><span>${esc(err)}</span></div>` : ""}
    <button class="btn primary" type="submit">Open</button></form>`);
  $("gateForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const code = $("pass").value.trim();
    if (!code) return $("pass").focus();
    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Checking…"; $("pass").disabled = true;
    const ep = S.epoch;
    let st;
    try { st = await Store.signIn(code); }
    catch (e) { if (ep === S.epoch) gate(gateMsg(e)); return; }
    if (ep !== S.epoch) return;
    S.data = st;
    $("root").innerHTML = SHELL; render();
    boot(true);
  });
  setTimeout(() => { const p = $("pass"); if (p) p.focus(); }, 50);
}

// ---------- boot ----------
let timers = false;
async function boot(justSignedIn) {
  if (Store.kind === "web") {
    if (Store.needsPasscode()) return gate();
    if (!justSignedIn) lockScreen(`<div class="gate-box">${MARK}<p class="muted" role="status">Opening the freezer…</p></div>`);
  } else render();
  const ep = S.epoch;
  let r;
  try {
    r = await Store.init(state => { if (ep === S.epoch) { S.data = state; render(); } },
                         e => { if (ep === S.epoch) lockOut(gateMsg(e, true)); });
  } catch (e) {
    if (ep !== S.epoch) return;
    if (isLock(e)) return lockOut(gateMsg(e, true));
    if (Store.kind === "web") return lockScreen(`<div class="gate-box">${MARK}<div class="flag now" role="alert"><span>${esc(gateMsg(e))}</span></div><button class="btn primary" type="button" data-act="retry-boot">Try again</button></div>`);
    const er = sqError(e); S.sq = { state: "error", code: er.code, msg: er.msg }; S.booted = true; S.canSave = false; render(); return;
  }
  if (ep !== S.epoch) return;
  if (!$("shell")) $("root").innerHTML = SHELL;
  S.booted = true; S.canSave = !!r.canSave;
  if (!r.ok || !r.canSales) { const er = sqError({ code: r.code || r.salesCode }); S.sq = { state: "error", code: er.code, msg: er.msg }; render(); return; }
  render();
  await syncSquare(false);
  if (!timers) { timers = true; setInterval(() => { if (!document.hidden) syncSquare(false); }, 5 * 60e3); setInterval(() => { renderStatus(); }, 60e3); }
}
boot();
})();
