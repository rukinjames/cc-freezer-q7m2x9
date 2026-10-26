/* Campus Creamery inventory engine: pure functions, no I/O.
   Used inline by the app page and tested in node. */
const Engine = (() => {
  const TZ = "America/Chicago";
  const DAY_START_HOUR = 4; // Square reporting day starts at 4 AM

  // ---------- catalog ----------
  // perUnit: usage units in one counted unit. Usage units are servings,
  // except Oreos (cookies) and cans. pack: counted units per thing you buy.
  const CATALOG = [
    { key: "vanilla", name: "Vanilla", group: "ice", unit: "tub", supplier: "gordon", code: "788805", pack: 1, price: 31.79, step: 0.25 },
    { key: "chocolate", name: "Chocolate", group: "ice", unit: "tub", supplier: "gordon", code: "442683", pack: 1, price: 31.79, step: 0.25 },
    { key: "exclusive", name: "Exclusive", group: "ice", unit: "tub", supplier: "gordon", code: "", pack: 1, price: 0, step: 0.25 },
    { key: "oreos", name: "Oreos", group: "mix", shelf: "cookies", color: "#2f2a3a", unit: "box", unitNote: "156 cookies", perUnit: 156, supplier: "sams", buy: "OREO 12-pack, 156 cookies", pack: 1, price: 10.98, step: 0.25 },
    { key: "brownies", name: "Brownies", group: "mix", shelf: "cookies", color: "#5b3a2a", unit: "serving", perUnit: 1, supplier: "sams", buy: "Little Debbie Cosmic Brownies, 24 ct (48 servings)", pack: 48, price: 10.78, step: 1 },
    { key: "strawberries", name: "Strawberries", group: "mix", shelf: "fruit", color: "#d2475a", unit: "bag", unitNote: "4 lb", perUnit: 51, supplier: "sams", buy: "Member's Mark Sliced Strawberries, 4 lb", pack: 1, price: 7.98, step: 0.25 },
    { key: "blueberries", name: "Blueberries", group: "mix", shelf: "fruit", color: "#4a5fb8", unit: "bag", unitNote: "4 lb", perUnit: 71, supplier: "sams", buy: "Member's Mark Blueberries, 64 oz", pack: 1, price: 9.77, step: 0.25 },
    { key: "bananas", name: "Bananas", group: "mix", shelf: "fruit", color: "#e2c14a", unit: "bag", unitNote: "5 lb", perUnit: 64, supplier: "gordon", code: "600645", buy: "Sliced frozen bananas, 5 lb", pack: 1, price: 13.56, step: 0.25 },
    { key: "ctc", name: "Cinnamon Toast Crunch", group: "mix", shelf: "cereal", color: "#c98a3e", unit: "box", unitNote: "about 19 oz, a 49.5 oz Sam's box counts as 2½", perUnit: 42, supplier: "sams", buy: "Cinnamon Toast Crunch, 49.5 oz", pack: 2.6, price: 7.98, step: 0.25 },
    { key: "fruitypebbles", name: "Fruity Pebbles", group: "mix", shelf: "cereal", color: "#d9608f", unit: "box", unitNote: "about 19 oz, a 38 oz Sam's box counts as 2", perUnit: 42, supplier: "sams", buy: "Fruity Pebbles, 38 oz", pack: 2.0, price: 6.48, step: 0.25 },
    { key: "capncrunch", name: "Cap'n Crunch", group: "mix", shelf: "cereal", color: "#3d6fd1", unit: "box", unitNote: "about 19 oz, a 40 oz Sam's box counts as 2", perUnit: 45, supplier: "sams", buy: "Cap'n Crunch's Crunch Berries, 40 oz", pack: 2.1, price: 5.98, step: 0.25 },
    { key: "reesespuffs", name: "Reese's Puffs", group: "mix", shelf: "cereal", color: "#e07a2c", unit: "box", unitNote: "about 19 oz, a 51.4 oz Sam's box counts as 2¾", perUnit: 42, supplier: "sams", buy: "Reese's Puffs, 51.4 oz", pack: 2.7, price: 7.98, step: 0.25 },
    { key: "cocoapuffs", name: "Cocoa Puffs", group: "mix", shelf: "cereal", color: "#7a4a33", unit: "box", unitNote: "about 19 oz, a 39.25 oz Sam's box counts as 2", perUnit: 42, supplier: "sams", buy: "Cocoa Puffs, 39.25 oz", pack: 2.07, price: 6.48, step: 0.25 },
    { key: "frootloops", name: "Froot Loops", group: "mix", shelf: "cereal", color: "#c94f9d", unit: "box", unitNote: "about 19 oz, a 43.6 oz Sam's box counts as 2¼", perUnit: 42, supplier: "sams", buy: "Froot Loops, 43.6 oz", pack: 2.29, price: 8.58, step: 0.25 },
    { key: "frostedflakes", name: "Frosted Flakes", group: "mix", shelf: "cereal", color: "#2f8fd0", unit: "box", unitNote: "about 19 oz, a 55 oz Sam's box counts as 3", perUnit: 42, supplier: "sams", buy: "Frosted Flakes, 55 oz", pack: 2.89, price: 7.88, step: 0.25 },
    { key: "honeynut", name: "Honey Nut Cheerios", group: "mix", shelf: "cereal", color: "#e3b23c", unit: "box", unitNote: "about 19 oz, a 48 oz Sam's box counts as 2½", perUnit: 42, supplier: "sams", buy: "Honey Nut Cheerios, 48 oz", pack: 2.53, price: 7.64, step: 0.25 },
    { key: "cookiecrisp", name: "Cookie Crisp", group: "mix", shelf: "cereal", color: "#a8742f", unit: "box", unitNote: "26.3 oz", perUnit: 58, supplier: "any", buy: "Cookie Crisp, 26.3 oz box", pack: 1, price: 0, step: 0.25 },
    { key: "graham", name: "Graham crackers", group: "mix", shelf: "cookies", color: "#b9874f", unit: "pack", unitNote: "4 boxes, about 208 half crackers", perUnit: 208, supplier: "sams", buy: "Honey Maid Graham Crackers, 4-pack", pack: 1, price: 8.98, step: 0.25 },
    { key: "matcha", name: "Matcha", group: "mix", shelf: "other", color: "#6f9a4a", unit: "bag", unitNote: "14.1 oz", perUnit: 110, supplier: "sams", buy: "Jade Leaf Matcha Latte Mix, 14.1 oz", pack: 1, price: 19.48, step: 0.25 },
    { key: "granola", name: "Granola", group: "mix", shelf: "other", color: "#b08a52", unit: "bag", unitNote: "32 oz", perUnit: 50, supplier: "sams", buy: "Member's Mark Honey Almond Granola, 32 oz", pack: 1, price: 6.56, step: 0.25 },
    { key: "biscoff", name: "Biscoff", group: "mix", shelf: "cookies", color: "#b5733a", unit: "pack", unitNote: "8.8 oz, 32 cookies", perUnit: 32, supplier: "any", buy: "Biscoff cookies, 8.8 oz pack", pack: 1, price: 0, step: 0.25 },
    // Exclusive toppings. Square has no button for them, so they change only when counted
    // or delivered, and the app never reorders them.
    { key: "chips", name: "Chips", group: "excl", color: "#e0b43c", unit: "bag", unitNote: "Ruffles, 15.6 oz", perUnit: 1, supplier: "sams", buy: "Ruffles Original Potato Chips, 15.625 oz", pack: 1, price: 4.48, step: 0.25, manual: true },
    { key: "pretzels", name: "Pretzels", group: "excl", color: "#a8662e", unit: "barrel", unitNote: "Utz Mini Twists, 60 oz", perUnit: 1, supplier: "sams", buy: "Utz Mini Twist Pretzels, 60 oz", pack: 1, price: 8.54, step: 0.25, manual: true },
    { key: "reesescups", name: "Reese's cups", group: "excl", color: "#e2702b", unit: "bag", unitNote: "65 snack-size cups", perUnit: 1, supplier: "sams", buy: "REESE'S Peanut Butter Cups, Snack Size, 65 pcs", pack: 1, price: 9.98, step: 0.25, manual: true },
    { key: "spoons", name: "Spoons", group: "supply", shelf: "supply", color: "#9aa3ad", unit: "box", unitNote: "600", perUnit: 600, supplier: "sams", buy: "Member's Mark Heavyweight Spoons, 600 ct", pack: 1, price: 16.82, step: 0.25 },
    { key: "coke", name: "Coke for floats", group: "supply", shelf: "supply", color: "#c4302b", unit: "can", perUnit: 1, supplier: "sams", buy: "Coca-Cola 12 oz cans, 35 pack", pack: 35, price: 20.38, step: 1 },
    { key: "rootbeer", name: "Root beer for floats", group: "supply", shelf: "supply", color: "#7b4b2a", unit: "can", perUnit: 1, supplier: "sams", buy: "Mug Root Beer mini cans, 30 pack", pack: 30, price: 15.48, step: 1 },
    // Cleaning: counted by hand only. At buyAt or fewer, the app says to buy enough to get back to restockTo.
    { key: "spray", name: "Cleaning spray", group: "clean", shelf: "clean", color: "#3f9fb5", unit: "bottle", perUnit: 1, supplier: "sams", buy: "Cleaning spray", pack: 1, price: 0, step: 1, manual: true, buyAt: 1, restockTo: 3 },
    { key: "wipes", name: "Cleaning wipes", group: "clean", shelf: "clean", color: "#6fb58a", unit: "pack", perUnit: 1, supplier: "sams", buy: "Cleaning wipes", pack: 1, price: 0, step: 1, manual: true, buyAt: 1, restockTo: 2 },
  ];
  const BY_KEY = Object.fromEntries(CATALOG.map(c => [c.key, c]));
  const ICE = ["vanilla", "chocolate", "exclusive"];
  const SUPPLIER = { gordon: "Gordon's", sams: "Sam's Club" };
  const EXCLUSIVE_OPTIONS = [
    { name: "Mint Chocolate Chip", code: "442845", price: 42.28 },
    { name: "Moose Tracks", code: "724173", price: 40.79 },
  ];

  const MIX_MAP = {
    "Oreo's": "oreos", "Brownie Bites": "brownies", "Frozen Strawberries": "strawberries",
    "Frozen Blueberries": "blueberries", "Frozen Bananas": "bananas", "Cinnamon Toast Crunch": "ctc",
    "Fruity Pebbles": "fruitypebbles", "Cap'n Crunch": "capncrunch", "Reece's Puffs": "reesespuffs",
    "Reese's Puffs": "reesespuffs", "Cocoa Puffs": "cocoapuffs", "Froot Loops": "frootloops",
    "Frosted Flakes": "frostedflakes", "Honey Nut Cheerios": "honeynut", "Graham Crackers": "graham", "Cookie Crisp": "cookiecrisp",
    "Matcha": "matcha", "Granola": "granola", "Biscoff": "biscoff",
  };
  const MANUAL = new Set(["Nutella", "Dairy Free Vanilla", "Cone"]);
  const BASE_MAP = { "Vanilla": "vanilla", "Chocolate": "chocolate", "Exclusive": "exclusive" };

  function usageOfRow(list, mod, item, qty) {
    const out = {};
    if (list === "Ice Cream Base") {
      out.spoons = qty;
      if (BASE_MAP[mod]) out[BASE_MAP[mod]] = qty;
      else if (!MANUAL.has(mod)) return { items: out, unmapped: mod };
      return { items: out, unmapped: null };
    }
    if (list === "Mix-In's") {
      if (mod === "Oreo's") { out.oreos = qty * (/mini/i.test(item || "") ? 2 : 3); return { items: out, unmapped: null }; }
      if (MIX_MAP[mod]) { out[MIX_MAP[mod]] = qty; return { items: out, unmapped: null }; }
      return { items: out, unmapped: MANUAL.has(mod) ? null : mod };
    }
    if (list === "Drink") {
      if (mod === "Coke") out.coke = qty; else if (mod === "Root Beer") out.rootbeer = qty;
    }
    return { items: out, unmapped: null };
  }

  // ---------- time ----------
  const fmtParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  function parts(date) { return Object.fromEntries(fmtParts.formatToParts(date).map(p => [p.type, p.value])); }
  function localStamp(date) { const p = parts(date); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; }
  function businessDate(date) { const p = parts(new Date(date.getTime() - DAY_START_HOUR * 3600e3)); return `${p.year}-${p.month}-${p.day}`; }
  function addDays(ds, n) { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekday(ds) { return new Date(ds + "T12:00:00Z").getUTCDay(); }
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function stampBusinessDate(stamp) { const d = stamp.slice(0, 10), h = +stamp.slice(11, 13); return h < DAY_START_HOUR ? addDays(d, -1) : d; }

  // ---------- formatting ----------
  const FRAC = { 0: "", 1: "¼", 2: "½", 3: "¾" };
  function quarter(x) { return Math.round(x * 4) / 4; }
  function fmtQ(x) {
    if (x == null || isNaN(x)) return "–";
    const q = quarter(x), neg = q < 0, a = Math.abs(q), whole = Math.floor(a), f = Math.round((a - whole) * 4);
    const s = (whole === 0 && f ? "" : String(whole)) + FRAC[f];
    return (neg ? "−" : "") + (s || "0");
  }
  function fmtUnits(key, x) {
    const c = BY_KEY[key];
    if (x == null) return "Not counted";
    if (c.unit === "serving") return `${Math.max(0, Math.round(x))} servings`;
    if (c.unit === "can") return `${Math.max(0, Math.round(x))} cans`;
    const q = quarter(Math.max(0, x));
    return `${fmtQ(q)} ${c.unit}${q === 1 ? "" : (c.unit === "box" ? "es" : "s")}`;
  }

  // ---------- Square rows -> tables ----------
  // exNames: lowercase names of exclusive flavors, in case Square ever gets a button per flavor.
  function dailyTables(rows, exNames) {
    const base = {}, usage = {}, ex = exNames || new Set();
    for (const r of rows) {
      const b = (base[r.day] ||= { vanilla: 0, chocolate: 0, exclusive: 0, any: 0 });
      if (r.list === "Ice Cream Base") { b.any += r.qty; if (BASE_MAP[r.mod]) b[BASE_MAP[r.mod]] += r.qty; else if (ex.has(String(r.mod).toLowerCase())) b.exclusive += r.qty; }
      const u = usageOfRow(r.list, r.mod, r.item, r.qty).items, d = (usage[r.day] ||= {});
      for (const k in u) d[k] = (d[k] || 0) + u[k];
    }
    return { base, usage };
  }
  // Hourly rows count from the count's hour on, unless the count came in that hour's second half.
  function afterCount(hour, sinceStamp) {
    const sinceHour = sinceStamp.slice(0, 13) + ":00:00", min = +sinceStamp.slice(14, 16);
    return !(hour < sinceHour || (hour === sinceHour && min >= 30));
  }
  function usageSince(hourlyRows, sinceStamp) {
    const out = {}, unmapped = new Set();
    for (const r of hourlyRows) {
      if (!afterCount(r.hour, sinceStamp)) continue;
      const { items, unmapped: u } = usageOfRow(r.list, r.mod, r.item, r.qty);
      if (u) unmapped.add(u);
      for (const k in items) out[k] = (out[k] || 0) + items[k];
    }
    return { usage: out, unmapped: [...unmapped] };
  }
  const perUnit = (key, st) => ICE.includes(key) ? st.yields[key] : BY_KEY[key].perUnit;
  const adjust = (key, st) => (st.adjust && st.adjust[key]) || 1;

  function estimates(counts, deliveries, hourlyRows, st) {
    const latest = {};
    for (const c of counts) if (!latest[c.item] || c.at > latest[c.item].at) latest[c.item] = c;
    const out = {}, unmapped = new Set();
    for (const cat of CATALOG) {
      const c = latest[cat.key];
      if (!c) {
        // Hand-counted items that were never counted still show what has been delivered.
        const got = cat.manual ? deliveries.filter(d => d.item === cat.key).reduce((s, d) => s + d.qty, 0) : 0;
        out[cat.key] = got > 0 ? { value: got, counted: null, countedAt: null, delivered: got, used: 0, usedRaw: 0, uncounted: true } : null;
        continue;
      }
      const { usage, unmapped: um } = usageSince(hourlyRows, localStamp(new Date(c.at)));
      um.forEach(u => unmapped.add(u));
      const delivered = deliveries.filter(d => d.item === cat.key && d.at > c.at).reduce((s, d) => s + d.qty, 0);
      const used = (usage[cat.key] || 0) * adjust(cat.key, st) / perUnit(cat.key, st);
      out[cat.key] = { value: c.value + delivered - used, counted: c.value, countedAt: c.at, delivered, used, usedRaw: usage[cat.key] || 0 };
    }
    return { stock: out, unmapped: [...unmapped] };
  }

  // ---------- exclusive flavors ----------
  // st.exclusives: [{ name, serving, since }]. Square has one "Exclusive" button, so its
  // sales are split evenly across the flavors being served right now. A base option named
  // after a flavor (if Square ever gets one) counts for that flavor alone. Counts of a flavor
  // from before it was added (since) don't apply.
  const exList = st => Array.isArray(st.exclusives) ? st.exclusives.filter(f => f && f.name) : [];
  const exActive = st => Array.isArray(st.exclusives) ? exList(st).some(f => f.serving) : !!(st.exclusive && st.exclusive.active);
  function exclusiveStocks(counts, deliveries, hourlyRows, st) {
    const flavors = exList(st), serving = flavors.filter(f => f.serving).length, out = {};
    for (const f of flavors) {
      const nm = f.name.toLowerCase();
      let c = null;
      for (const x of counts) if (x.item === "exclusive" && String(x.name || "").toLowerCase() === nm && (!f.since || x.at >= f.since) && (!c || x.at > c.at)) c = x;
      if (!c) { out[f.name] = null; continue; }
      const since = localStamp(new Date(c.at));
      let sold = 0;
      for (const r of hourlyRows) {
        if (r.list !== "Ice Cream Base" || !afterCount(r.hour, since)) continue;
        if (r.mod === "Exclusive") { if (f.serving && serving) sold += r.qty / serving; }
        else if (String(r.mod).toLowerCase() === nm) sold += r.qty;
      }
      const delivered = deliveries.filter(d => d.item === "exclusive" && String(d.name || "").toLowerCase() === nm && d.at > c.at).reduce((s, d) => s + d.qty, 0);
      const used = sold / st.yields.exclusive;
      out[f.name] = { value: c.value + delivered - used, counted: c.value, countedAt: c.at, delivered, used, usedRaw: sold };
    }
    return out;
  }

  // ---------- forecasting ----------
  function isClosed(ds, base, st, today) {
    if ((st.closedDates || []).includes(ds)) return true;
    if (ds < today) return !(base[ds] && base[ds].any > 0);
    return false;
  }
  function openDays(base, today, n) { return Object.keys(base).filter(d => d < today && base[d].any > 0).sort().slice(-n); }
  // Share of a night's scoops that go to the exclusive, from nights one was on offer
  // (default 13%, the average across this fall's exclusives).
  function exclusiveShare(base, today) {
    let e = 0, t = 0;
    for (const d of Object.keys(base)) if (d < today && d >= addDays(today, -70) && base[d].exclusive > 0) { e += base[d].exclusive; t += base[d].vanilla + base[d].chocolate + base[d].exclusive; }
    return t >= 40 ? e / t : 0.13;
  }
  // Ice cream tubs for one night: hi = busiest of the last 3 same weekdays, lo = 80% of the slowest.
  // The exclusive (only while one is running) is its usual share of the whole night.
  function forecastNight(ds, base, st, today) {
    const zero = { vanilla: 0, chocolate: 0, exclusive: 0 };
    if (isClosed(ds, base, st, today)) return { hi: zero, lo: zero, mean: zero, closed: true };
    const past = Object.keys(base).filter(d => d < today && weekday(d) === weekday(ds) && base[d].any > 0).sort().slice(-3);
    const hi = {}, lo = {}, mean = {};
    for (const f of ["vanilla", "chocolate"]) {
      const y = st.yields[f];
      if (past.length) { const t = past.map(d => base[d][f] / y); hi[f] = Math.max(...t); lo[f] = 0.8 * Math.min(...t); mean[f] = t.reduce((a, b) => a + b, 0) / t.length; }
      else { const r = openDays(base, today, 7); const m = r.length ? r.reduce((s, d) => s + base[d][f], 0) / r.length / y : 0; hi[f] = 1.5 * m; lo[f] = 0.5 * m; mean[f] = m; }
    }
    hi.exclusive = lo.exclusive = mean.exclusive = 0;
    if (exActive(st)) {
      const share = exclusiveShare(base, today), y = st.yields.exclusive;
      const nightScoops = d => base[d].vanilla + base[d].chocolate + base[d].exclusive;
      const ref = past.length ? past.map(nightScoops) : openDays(base, today, 7).map(nightScoops);
      if (ref.length) {
        const avg = ref.reduce((a, b) => a + b, 0) / ref.length;
        hi.exclusive = share * Math.max(...ref) / y; lo.exclusive = 0.8 * share * Math.min(...ref) / y; mean.exclusive = share * avg / y;
      }
    }
    return { hi, lo, mean, closed: false };
  }
  // Mix-in counted units for one night, by weekday
  function mixNight(key, ds, base, usage, st, today) {
    if (isClosed(ds, base, st, today)) return { hi: 0, mean: 0 };
    const k = adjust(key, st) / perUnit(key, st);
    const past = Object.keys(base).filter(d => d < today && weekday(d) === weekday(ds) && base[d].any > 0).sort().slice(-3);
    if (past.length) { const t = past.map(d => ((usage[d] || {})[key] || 0) * k); return { hi: Math.max(...t), mean: t.reduce((a, b) => a + b, 0) / t.length }; }
    const r = openDays(base, today, 14); const m = r.length ? r.reduce((s, d) => s + ((usage[d] || {})[key] || 0), 0) / r.length * k : 0;
    return { hi: 1.5 * m, mean: m };
  }

  // ---------- floors ----------
  const THU_SAT = new Set([4, 5, 6]);
  function nightFloor(ds, st) { return THU_SAT.has(weekday(ds)) ? st.floors.thuSat : st.floors.sunWed; }
  function shares(base, st, today) {
    let v = 0, c = 0;
    for (const d of openDays(base, today, 14)) { v += base[d].vanilla / st.yields.vanilla; c += base[d].chocolate / st.yields.chocolate; }
    const t = v + c; return t ? { vanilla: v / t, chocolate: c / t } : { vanilla: 0.7, chocolate: 0.3 };
  }
  function flavorFloors(total, sh) { const c = Math.max(1, quarter(total * sh.chocolate)); return { vanilla: Math.max(1, total - c), chocolate: c }; }

  // ---------- Gordon's (ice cream), same-day delivery ----------
  // nowStamp: local "YYYY-MM-DDTHH:mm:ss". pending: [{arrivesOn, lines}] placed, not yet arrived.
  function planGordon({ stock, soldTonight, pending, base, settings: st, nowStamp }) {
    const cal = nowStamp.slice(0, 10), hm = nowStamp.slice(11, 16), biz = stampBusinessDate(nowStamp);
    const late = st.gordon.windows[st.gordon.windows.length - 1];
    const A0 = hm < late.cutoff ? cal : addDays(cal, 1);
    // The exclusive is never reordered here (the shop restocks it by hand once it runs out);
    // its tubs only count against freezer room.
    const core = ["vanilla", "chocolate"], sh = shares(base, st, biz);
    const fc = d => forecastNight(d, base, st, biz);
    const sold = soldTonight || {};
    const rem = (d, which, f) => d === biz ? Math.max(0, fc(d)[which][f] - (sold[f] || 0) / st.yields[f]) : fc(d)[which][f];
    const sumLines = list => { const t = {}; for (const o of list) for (const k in (o.lines || {})) t[k] = (t[k] || 0) + (+o.lines[k] || 0); return t; };
    const before = sumLines((pending || []).filter(o => o.arrivesOn < A0));
    const atA0 = sumLines((pending || []).filter(o => o.arrivesOn === A0));
    const nightsBefore = []; for (let d = biz; d < A0; d = addDays(d, 1)) nightsBefore.push(d);
    const S = {}; for (const f of ICE) S[f] = (stock[f] || 0) + (before[f] || 0);
    const res = { arriveOn: A0, sameDay: A0 === cal, windows: st.gordon.windows.filter(w => A0 !== cal || hm < w.cutoff), urgent: [], reasons: [] };

    // Nights before the earliest possible delivery: can only warn
    let run = { ...S };
    for (const d of nightsBefore) {
      for (const f of ICE) run[f] -= rem(d, "hi", f);
      const fl = flavorFloors(nightFloor(d, st), sh);
      core.forEach(f => { if (run[f] < fl[f] && !res.urgent.includes(f)) res.urgent.push(f); });
    }
    const arrive = {}; for (const f of ICE) arrive[f] = Math.max(0, S[f] - nightsBefore.reduce((s, d) => s + rem(d, "lo", f), 0));

    if (ICE.some(f => (atA0[f] || 0) > 0)) {
      res.mode = "ordered"; res.atArrival = ICE.reduce((s, f) => s + arrive[f] + (atA0[f] || 0), 0);
      if (res.atArrival > st.cap + 0.01) {
        const over = Math.ceil(res.atArrival - st.cap - 1e-9);
        res.trim = { over, flavor: ICE.filter(f => atA0[f] > 0).sort((a, b) => atA0[b] - atA0[a])[0] };
      }
      return res;
    }
    // Skip A0 and the next truck comes A0+1: stock must get through night A0 above its floor
    const endA0 = {}; for (const f of ICE) endA0[f] = run[f] + (nightsBefore.length ? 0 : 0) - fc(A0).hi[f];
    const flA0 = flavorFloors(nightFloor(A0, st), sh);
    const short = core.filter(f => endA0[f] < flA0[f]);
    res.endA0 = endA0; res.floorA0 = flA0;
    if (!short.length) { res.mode = "none"; return res; }
    const dname = DOW_LONG[weekday(A0)];
    short.forEach(f => res.reasons.push(`${BY_KEY[f].name} would end ${dname} night under ${fmtQ(flA0[f])} tubs`));

    // Size: fill toward the cap so both flavors reach their floors together
    const horizon = [0, 1, 2, 3].map(k => addDays(A0, k));
    const flMax = { vanilla: 0, chocolate: 0 };
    for (const d of horizon) { const fl = flavorFloors(nightFloor(d, st), sh); core.forEach(f => { flMax[f] = Math.max(flMax[f], fl[f]); }); }
    const rate = {}; core.forEach(f => { rate[f] = horizon.reduce((s, d) => s + fc(d).hi[f], 0) / horizon.length; });
    const room = Math.floor(st.cap - ICE.reduce((s, f) => s + arrive[f], 0) + 1e-9);
    const usable = Math.max(0, st.cap - arrive.exclusive - flMax.vanilla - flMax.chocolate);
    const cover = usable / ((rate.vanilla + rate.chocolate) || 1);
    const target = { vanilla: flMax.vanilla + rate.vanilla * cover, chocolate: flMax.chocolate + rate.chocolate * cover, exclusive: 0 };
    const want = {}; for (const f of ICE) want[f] = Math.max(0, target[f] - arrive[f]);
    const order = { vanilla: Math.floor(want.vanilla + 0.5), chocolate: Math.floor(want.chocolate + 0.5), exclusive: 0 };
    const sum = () => ICE.reduce((s, f) => s + order[f], 0);
    while (sum() > Math.max(0, room)) { const f = core.filter(k => order[k] > 0).sort((a, b) => (order[b] - want[b]) - (order[a] - want[a]))[0]; order[f]--; }
    while (sum() < room) {
      const g = core.map(f => [f, want[f] - order[f]]).sort((a, b) => b[1] - a[1]);
      if (!g.length || g[0][1] <= 0.25) break;
      order[g[0][0]]++;
    }
    if (sum() === 0) { res.mode = "full"; return res; }
    // Small orders cost a delivery fee and a trip. Top up to the minimum if the
    // freezer has room; otherwise skip it when stock still clears 85% of the
    // floor on a busy night and the full floor on a normal one.
    const value = () => core.reduce((s, f) => s + order[f] * BY_KEY[f].price, 0);
    while (value() < st.gordon.minimum && sum() < room) {
      const g = core.map(f => [f, want[f] - order[f]]).sort((a, b) => b[1] - a[1]); order[g[0][0]]++;
    }
    if (value() < st.gordon.minimum) {
      const okBusy = core.every(f => endA0[f] >= 0.85 * flA0[f]);
      const okNormal = core.every(f => run[f] - fc(A0).mean[f] >= flA0[f]);
      if (okBusy && okNormal) { res.mode = "none"; res.smallSkipped = true; return res; }
      res.fee = true;
    }
    res.mode = "order"; res.order = order; res.room = room;
    res.atArrival = ICE.reduce((s, f) => s + arrive[f] + order[f], 0);
    return res;
  }

  // 7-night outlook: each morning runs the same policy with expected sales
  function simulateWeek({ stock, soldTonight, pending, todayPlan, base, settings: st, nowStamp }) {
    const biz = stampBusinessDate(nowStamp);
    const S = {}; for (const f of ICE) S[f] = stock[f] || 0;
    const incoming = {}; // date -> lines
    for (const o of pending || []) { const t = (incoming[o.arrivesOn] ||= {}); for (const k in o.lines) t[k] = (t[k] || 0) + o.lines[k]; }
    if (todayPlan && todayPlan.mode === "order") { const t = (incoming[todayPlan.arriveOn] ||= {}); for (const f of ICE) t[f] = (t[f] || 0) + todayPlan.order[f]; }
    const nights = [];
    for (let k = 0; k < 7; k++) {
      const ds = addDays(biz, k);
      let ordered = null;
      if (k > 0) {
        const pend = Object.entries(incoming).filter(([d]) => d >= ds).map(([d, lines]) => ({ arrivesOn: d, lines }));
        const p = planGordon({ stock: S, soldTonight: {}, pending: pend, base, settings: st, nowStamp: ds + "T08:00:00" });
        if (p.mode === "order") { ordered = p.order; const t = (incoming[p.arriveOn] ||= {}); for (const f of ICE) t[f] = (t[f] || 0) + p.order[f]; }
      } else if (todayPlan && todayPlan.mode === "order") ordered = todayPlan.order;
      let arrived = null;
      if (incoming[ds]) { arrived = incoming[ds]; for (const f of ICE) S[f] += arrived[f] || 0; delete incoming[ds]; }
      const fc = forecastNight(ds, base, st, biz), pre = { ...S };
      for (const f of ICE) S[f] = Math.max(0, S[f] - (k === 0 ? Math.max(0, fc.mean[f] - ((soldTonight || {})[f] || 0) / st.yields[f]) : fc.mean[f]));
      nights.push({ ds, pre, post: { ...S }, arrived, ordered, closed: fc.closed, floor: nightFloor(ds, st) });
    }
    return nights;
  }

  // ---------- Sam's Club (batched) ----------
  // An order goes in only when something can't safely wait another day. Then
  // everything running low rides along, topped up to about two weeks, and the
  // basket is filled to the free-delivery minimum with the next items due.
  // Orders already placed (not yet arrived) count as on the way, so a placed
  // order stops the app from asking for the same things again.
  function planSupplies({ stock, base, usage, settings: st, nowStamp, pending }) {
    const biz = stampBusinessDate(nowStamp);
    const items = CATALOG.filter(c => c.group !== "ice" && !c.manual);
    const incoming = {};
    for (const o of pending || []) for (const [k, q] of Object.entries(o.lines || {})) {
      if (BY_KEY[k] && BY_KEY[k].group !== "ice" && q > 0) incoming[k] = (incoming[k] || 0) + q * (BY_KEY[k].pack || 1);
    }
    const rows = [];
    for (const c of items) {
      const nightsFc = []; for (let k = 0; k < 28; k++) nightsFc.push(mixNight(c.key, addDays(biz, k), base, usage, st, biz));
      const avg = nightsFc.slice(0, 14).reduce((s, n) => s + n.mean, 0) / 14;
      const s = stock[c.key];
      if (!s) { rows.push({ key: c.key, status: "uncounted", avg }); continue; }
      const inc = incoming[c.key] || 0;
      let left = Math.max(0, s.value) + inc, cover = 28;
      for (let k = 0; k < 28; k++) { left -= nightsFc[k].hi; if (left < 0) { cover = k; break; } }
      const status = cover <= 2 ? "now" : cover <= 6 ? "soon" : "ok";
      rows.push({ key: c.key, stock: s.value, incoming: inc, cover, status, avg, nightsFc });
    }
    const plans = {};
    for (const sup of ["sams", "gordon", "any"]) {
      const mine = rows.filter(r => BY_KEY[r.key].supplier === sup && r.status !== "uncounted");
      const due = mine.filter(r => r.cover <= 2);
      const minCover = mine.length ? Math.min(...mine.map(r => r.cover)) : 28;
      const needBy = minCover >= 28 ? null : addDays(biz, Math.max(0, minCover - 2));
      const basket = mine.filter(r => r.cover < st.supplies.topUpBelow).map(r => {
        const c = BY_KEY[r.key];
        const need = r.nightsFc.slice(0, st.supplies.coverTo).reduce((s, n) => s + n.mean, 0) + r.nightsFc[0].hi + r.nightsFc[1].hi - Math.max(0, r.stock) - r.incoming;
        return { key: r.key, packs: Math.max(1, Math.ceil(need / c.pack - 1e-9)), cover: r.cover };
      }).filter(x => x.packs > 0);
      const value = () => basket.reduce((s, x) => s + x.packs * BY_KEY[x.key].price, 0);
      // Pad toward the delivery minimum only when a real order exists; never invent one.
      if (sup === "sams" && basket.length) {
        const extra = mine.filter(r => !basket.find(b => b.key === r.key) && r.cover < 28).sort((a, b) => a.cover - b.cover);
        for (const r of extra) { if (value() >= st.supplies.samsMinimum) break; basket.push({ key: r.key, packs: 1, cover: r.cover, filler: true }); }
      }
      plans[sup] = { orderToday: due.length > 0, due: due.map(r => r.key), needBy, basket: basket.sort((a, b) => a.cover - b.cover), value: value() };
    }
    // Cleaning is counted by hand. At buyAt or fewer (and nothing already on order) it needs
    // buying, enough to get back to restockTo. It never forces an order on its own.
    const clean = CATALOG.filter(c => c.group === "clean").map(c => {
      const s = stock[c.key], inc = incoming[c.key] || 0;
      if (!s) return { key: c.key, status: "uncounted" };
      const have = Math.max(0, s.value);
      return { key: c.key, stock: s.value, incoming: inc, countedAt: s.countedAt, status: inc > 0 ? "ordered" : have <= c.buyAt + 1e-9 ? "buy" : "ok", packs: Math.max(1, Math.ceil(c.restockTo - have - inc - 1e-9)) };
    });
    plans.clean = { basket: clean.filter(r => r.status === "buy").map(r => ({ key: r.key, packs: r.packs, low: true })) };
    return { rows, plans, clean };
  }

  // ---------- learning from counts ----------
  function learn(key, est, newValue, st) {
    if (!est) return null;
    const consumedActual = est.counted + est.delivered - newValue, predicted = est.used;
    if (ICE.includes(key)) {
      if (est.usedRaw < 80 || consumedActual <= 0.25) return null;
      const implied = est.usedRaw / consumedActual;
      if (implied < 12 || implied > 40) return { flag: `${BY_KEY[key].name} count looks off: it works out to ${implied.toFixed(1)} servings per tub. Recount if that seems wrong.` };
      const old = st.yields[key], next = Math.round((0.75 * old + 0.25 * implied) * 10) / 10;
      return { yields: { [key]: next }, note: `${BY_KEY[key].name}: this count works out to ${implied.toFixed(1)} servings per tub. Now using ${next} (was ${old}).` };
    }
    if (predicted < 0.5 || consumedActual <= 0) return null;
    const ratio = consumedActual / predicted;
    if (ratio < 0.4 || ratio > 2.5) return { flag: `${BY_KEY[key].name} count looks off against sales. Recount if that seems wrong.` };
    const old = adjust(key, st), next = Math.round(Math.min(1.6, Math.max(0.6, old * (0.75 + 0.25 * ratio))) * 100) / 100;
    return { adjust: { [key]: next }, note: `${BY_KEY[key].name}: used ${Math.abs(Math.round((ratio - 1) * 100))}% ${ratio >= 1 ? "more" : "less"} than sales predicted. Adjusted.` };
  }

  return { TZ, CATALOG, BY_KEY, ICE, SUPPLIER, EXCLUSIVE_OPTIONS, DOW, DOW_LONG, usageOfRow, localStamp, businessDate, addDays, weekday, stampBusinessDate,
    exclusiveShare, exList, exActive, exclusiveStocks, afterCount, quarter, fmtQ, fmtUnits, dailyTables, usageSince, estimates, forecastNight, mixNight, nightFloor, shares, flavorFloors, planGordon, simulateWeek, planSupplies, learn, perUnit };
})();
if (typeof module !== "undefined") module.exports = Engine;
