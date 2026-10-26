// Engine checks for Biscoff, hand-counted items, cleaning and exclusive flavors.
const E = require("./engine.js");
let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? "PASS " : "FAIL ") + name + (info !== undefined && !ok ? "  (" + JSON.stringify(info) + ")" : "")); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const st = { cap: 16, floors: { sunWed: 6, thuSat: 10 }, yields: { vanilla: 21, chocolate: 25, exclusive: 22 }, adjust: {}, closedDates: [], supplies: { topUpBelow: 10, coverTo: 14, samsMinimum: 50 }, gordon: { windows: [{ label: "10 AM to 2 PM", cutoff: "09:30" }, { label: "2 to 5 PM", cutoff: "13:00" }], minimum: 75, fee: 10 } };
const T = "2026-10-26T15:00:00.000Z"; // 10 AM Chicago
const row = (list, mod, qty, hour = "2026-10-26T21:00:00", item = "Regular Ice Cream") => ({ list, mod, item, qty, hour });

// Biscoff comes from Square, one cookie a serving, 32 a pack
const u = E.usageOfRow("Mix-In's", "Biscoff", "Mini Ice Cream", 5);
check("Biscoff sales map to biscoff servings", u.items.biscoff === 5 && u.unmapped === null, u);
let est = E.estimates([{ item: "biscoff", value: 1, at: T }], [], [row("Mix-In's", "Biscoff", 8)], st);
check("a pack of Biscoff lasts 32 servings", near(est.stock.biscoff.value, 0.75), est.stock.biscoff);

// Hand-counted items never move with sales; uncounted ones show deliveries
est = E.estimates([{ item: "spray", value: 3, at: T }], [{ item: "chips", qty: 2, at: T }], [row("Mix-In's", "Oreo's", 40)], st);
check("cleaning spray stays at its count", est.stock.spray.value === 3 && est.stock.spray.used === 0, est.stock.spray);
check("uncounted chips show what was delivered", est.stock.chips.value === 2 && est.stock.chips.uncounted === true, est.stock.chips);
check("uncounted pretzels with nothing delivered are unknown", est.stock.pretzels === null);

// Cleaning: at 1 it needs buying, back up to 3 bottles / 2 packs, and never forces a Sam's order
const base = {}, usage = {};
for (let k = 1; k <= 21; k++) { const d = E.addDays("2026-10-26", -k); base[d] = { vanilla: 60, chocolate: 30, exclusive: 0, any: 90 }; usage[d] = { oreos: 3 }; }
const stock = {}; for (const c of E.CATALOG) stock[c.key] = { value: 50, countedAt: T };
stock.spray = { value: 1, countedAt: T }; stock.wipes = { value: 2, countedAt: T };
let p = E.planSupplies({ stock, base, usage, settings: st, nowStamp: "2026-10-26T10:00:00", pending: [] });
const spray = p.clean.find(r => r.key === "spray"), wipes = p.clean.find(r => r.key === "wipes");
check("spray at 1 needs buying, 2 bottles", spray.status === "buy" && spray.packs === 2, spray);
check("wipes at 2 are fine", wipes.status === "ok", wipes);
check("cleaning goes in the cleaning list", p.plans.clean.basket.length === 1 && p.plans.clean.basket[0].key === "spray");
check("cleaning alone makes no Sam's order", p.plans.sams.basket.length === 0 && !p.plans.sams.orderToday, p.plans.sams);
check("hand-counted items are not planned from sales", !p.rows.some(r => ["spray", "wipes", "chips", "pretzels", "reesescups"].includes(r.key)));
p = E.planSupplies({ stock, base, usage, settings: st, nowStamp: "2026-10-26T10:00:00", pending: [{ lines: { spray: 2 } }] });
check("spray on order shows ordered, not buy", p.clean.find(r => r.key === "spray").status === "ordered" && p.plans.clean.basket.length === 0);

// Exclusive flavors: one Exclusive button, split across the flavors on the menu
const fl = since => [{ name: "Mint Chip", serving: true, since }, { name: "Moose Tracks", serving: true, since }];
const counts = [{ item: "exclusive", name: "Mint Chip", value: 3, at: T }, { item: "exclusive", name: "Moose Tracks", value: 2, at: T }];
let ex = E.exclusiveStocks(counts, [], [row("Ice Cream Base", "Exclusive", 22)], Object.assign({}, st, { exclusives: fl(T) }));
check("two on the menu split Exclusive sales evenly", near(ex["Mint Chip"].value, 2.5) && near(ex["Moose Tracks"].value, 1.5), ex);
ex = E.exclusiveStocks(counts, [], [row("Ice Cream Base", "Exclusive", 22)], Object.assign({}, st, { exclusives: [{ name: "Mint Chip", serving: true, since: T }, { name: "Moose Tracks", serving: false, since: T }] }));
check("only the flavor on the menu counts down", near(ex["Mint Chip"].value, 2) && near(ex["Moose Tracks"].value, 2), ex);
ex = E.exclusiveStocks(counts, [], [row("Ice Cream Base", "Moose Tracks", 11)], Object.assign({}, st, { exclusives: fl(T) }));
check("a base option named after a flavor counts for it alone", near(ex["Moose Tracks"].value, 1.5) && near(ex["Mint Chip"].value, 3), ex);
ex = E.exclusiveStocks(counts, [], [], Object.assign({}, st, { exclusives: fl("2026-10-27T00:00:00.000Z") }));
check("counts from before a flavor was added don't apply", ex["Mint Chip"] === null && ex["Moose Tracks"] === null, ex);
ex = E.exclusiveStocks(counts, [], [row("Ice Cream Base", "Exclusive", 22, "2026-10-26T09:00:00")], Object.assign({}, st, { exclusives: fl(T) }));
check("sales before the count don't count", near(ex["Mint Chip"].value, 3), ex);
check("forecast includes the exclusive while one is on the menu", E.exActive(Object.assign({}, st, { exclusives: fl(T) })) && !E.exActive(Object.assign({}, st, { exclusives: [{ name: "Mint Chip", serving: false }] })));
const tbl = E.dailyTables([{ day: "2026-10-20", list: "Ice Cream Base", mod: "Moose Tracks", item: "Regular Ice Cream", qty: 4 }], new Set(["moose tracks"]));
check("a flavor-named base option counts as exclusive in history", tbl.base["2026-10-20"].exclusive === 4 && tbl.base["2026-10-20"].any === 4);

console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
