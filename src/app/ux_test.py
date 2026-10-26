# End-to-end check of every screen against a stateful mock of the server.
import json, asyncio, sys, uuid, copy
from playwright.async_api import async_playwright
SP = "/tmp/claude-0/-home-claude-cc-freezer-q7m2x9/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad"
daily = json.load(open('/home/claude/creamery/data/live_daily_1013.json'))
hourly = json.load(open(f'{SP}/hourly_tue.json'))
html = open('/home/claude/creamery/app/site/index.html').read().replace('https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory', 'https://fn.test/inventory')
open(f'{SP}/ux.html', 'w').write(html)
H = {"access-control-allow-origin": "*"}
def merge(a, b):
    out = dict(a)
    for k, v in b.items(): out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out
class Srv:
    def __init__(self, docs): self.docs = copy.deepcopy(docs); self.log = []
    def get(self, col, i): return next((d for d in self.docs if d["collection"] == col and d["id"] == i), None)
    def of(self, col): return [d for d in self.docs if d["collection"] == col]
    async def handle(self, route):
        req = route.request
        if req.method == "OPTIONS": return await route.fulfill(status=200, headers={**H, "access-control-allow-headers": "*"})
        b = json.loads(req.post_data or "{}"); op = b.get("op"); self.log.append(op)
        if req.headers.get("x-passcode") != "1234": return await route.fulfill(status=401, json={"error": "wrong_passcode"}, headers=H)
        if op == "state": return await route.fulfill(json={"docs": copy.deepcopy(self.docs)}, headers=H)
        if op == "sales": return await route.fulfill(json={"data": daily if b["query"]["timeDimensions"][0]["dimension"].endswith("reporting_day") else hourly}, headers=H)
        if op == "add":
            i = str(uuid.uuid4()); self.docs.append({"collection": b["collection"], "id": i, "data": b["data"]}); return await route.fulfill(json={"id": i}, headers=H)
        if op == "set":
            d = self.get(b["collection"], b["id"])
            if d: d["data"] = b["data"]
            else: self.docs.append({"collection": b["collection"], "id": b["id"], "data": b["data"]})
            return await route.fulfill(json={"id": b["id"]}, headers=H)
        if op == "update":
            d = self.get(b["collection"], b["id"])
            if not d: return await route.fulfill(status=404, json={"error": "not_found"}, headers=H)
            d["data"] = merge(d["data"], b["data"])
            for k in b.get("replace") or []:   # same as the server: listed keys overwrite
                if k in b["data"]: d["data"][k] = b["data"][k]
            return await route.fulfill(json={"id": b["id"]}, headers=H)
        return await route.fulfill(status=400, json={"error": "bad_request"}, headers=H)
# ---- tabs (Today, Stock, Activity) ----
TABOF = {"#freezer": "stock", "#pantry": "stock", "#exclusive": "stock", "#week": "stock", "#tab-stock": "stock", "#activity": "activity", "#today": "today"}
async def tab(pg, name):
    for sel in (f".bar-bottom [data-tab={name}]", f".tabs-top [data-tab={name}]"):
        el = await pg.query_selector(sel)
        if el and await el.is_visible():
            await el.click(); await pg.wait_for_timeout(150); return
async def tin(pg, sel):
    t = TABOF.get(sel.split(" ")[0])
    if t: await tab(pg, t)
    if sel.split(" ")[0] in ("#pantry", "#activity"):   # folded parts count as shown
        await pg.evaluate("s => document.querySelectorAll(s + ' details').forEach(d => { d.open = true; })", sel.split(" ")[0])
    return await pg.inner_text(sel)
async def tdo(pg, sel, **kw):
    # buttons on the Today tab; folded lists there count as open
    if not await pg.query_selector(".sheet"):
        await tab(pg, "today")
        await pg.evaluate("() => document.querySelectorAll('#today details').forEach(d => { d.open = true; })")
    return await pg.click(sel, **kw)
async def tclick(pg, sel, **kw):
    t = TABOF.get(sel.split(" ")[0])
    if t: await tab(pg, t)
    return await pg.click(sel, **kw)

res = []
def check(name, ok, info=""):
    res.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  ({info})" if info else ""))
async def page(br, srv, when, vp=(390, 844)):
    ctx = await br.new_context(viewport={"width": vp[0], "height": vp[1]})
    await ctx.add_init_script("localStorage.setItem('cc-inventory-passcode','1234')")
    await ctx.route("https://fn.test/**", srv.handle)
    pg = await ctx.new_page(); pg.errs = []
    pg.on("pageerror", lambda e: pg.errs.append(str(e)))
    await pg.clock.set_fixed_time(when)
    await pg.goto(f'file://{SP}/ux.html'); await pg.wait_for_timeout(1500)
    return pg
async def step(pg, id_, n=1, dirn=1):
    for _ in range(n): await pg.click(f'.sheet [data-step="{dirn}"][data-id="{id_}"]')


AUD = "/tmp/claude-0/-home-claude/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad/audit_docs.json"
async def main():
    docs = json.load(open(AUD))
    async with async_playwright() as p:
        br = await p.chromium.launch()
        srv = Srv(docs); pg = await page(br, srv, "2026-10-26T16:15:00Z")
        check("opens on Today", await pg.is_visible("#today") and not await pg.is_visible("#freezer") and not await pg.is_visible("#activity"))
        head_txt = await pg.inner_text(".today-head")
        badge = await pg.inner_text(".bar-bottom [data-badge]")
        check("headline counts what needs doing, badge agrees", "1 thing to do" in head_txt and badge == "1", f"{head_txt!r} {badge!r}")
        t = await pg.inner_text("#today")
        check("the due delivery is first, with pickup and actions", t.index("Sam's Club delivery") < t.index("Coming up") and "I'll pick it up" in t and "It arrived" in t)
        check("nothing-to-do items sit under Coming up", t.index("Coming up") < t.index("No Gordon's order"))
        await pg.click(".bar-bottom [data-tab=stock]"); await pg.wait_for_timeout(150)
        check("Stock shows freezer, pantry and exclusive", await pg.is_visible("#freezer") and await pg.is_visible("#pantry") and await pg.is_visible("#exclusive") and not await pg.is_visible("#today"))
        check("Stock tab is marked current", await pg.get_attribute(".bar-bottom [data-tab=stock]", "aria-current") == "page")
        pos = await pg.evaluate("() => ['freezer','pantry','exclusive','week'].map(id => document.getElementById(id).getBoundingClientRect().top)")
        check("on a phone, pantry comes right after the freezer", pos == sorted(pos), str(pos))
        check("pantry starts with what's running low, the rest folded", "Running low" in await pg.inner_text("#pantry") and not await pg.is_visible("#pantry details.shelves .goods"))
        await pg.click("#pantry details.shelves summary"); await pg.wait_for_timeout(100)
        await pg.click("[data-act=refresh]"); await pg.wait_for_timeout(900)
        check("an opened fold stays open after a refresh", await pg.is_visible("#pantry details.shelves .goods"))
        await pg.click(".bar-bottom [data-tab=activity]"); await pg.wait_for_timeout(150)
        check("Activity shows the log", await pg.is_visible("#activity") and "Counted" in await pg.inner_text("#activity"))
        await pg.click(".top [data-act=open-settings]"); await pg.wait_for_timeout(200)
        check("settings opens from the gear", "Settings" in await pg.inner_text(".sheet header"))
        await pg.click(".sheet footer [data-act=close]")
        for w in (320, 390):
            await pg.set_viewport_size({"width": w, "height": 740})
            for tb in ("today", "stock", "activity"):
                await pg.click(f".bar-bottom [data-tab={tb}]"); await pg.wait_for_timeout(100)
                ok = await pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
                if not ok: check(f"no sideways scroll at {w}px on {tb}", False)
        check("no sideways scroll at 320 and 390 px on any tab", True)
        check("no page errors (phone)", not pg.errs, str(pg.errs))
        # laptop: tabs in the header, pantry open
        pg2 = await page(br, Srv(docs), "2026-10-26T16:15:00Z", (1366, 900))
        check("laptop: tabs in the header, no bottom bar", await pg2.is_visible(".tabs-top") and not await pg2.is_visible(".bar-bottom"))
        await pg2.click(".tabs-top [data-tab=stock]"); await pg2.wait_for_timeout(150)
        check("laptop: pantry list starts open", await pg2.is_visible("#pantry details.shelves .goods"))
        check("laptop: Count and Add delivery in the header", await pg2.is_visible(".top [data-act=open-count]") and await pg2.is_visible(".top [data-act=open-delivery]"))
        check("no page errors (laptop)", not pg2.errs, str(pg2.errs))
        # Square down: the placed order and its pickup still show
        class Down(Srv):
            async def handle(self, route):
                b = json.loads(route.request.post_data or "{}")
                if b.get("op") == "sales": return await route.fulfill(status=502, json={"error": "square_error", "message": "down"}, headers=H)
                return await Srv.handle(self, route)
        pg3 = await page(br, Down(docs), "2026-10-26T16:15:00Z")
        t3 = await pg3.inner_text("#today")
        check("Square down: placed orders and pickup still on Today", "Sam's Club delivery" in t3 and "I'll pick it up" in t3 and "Sales aren't updating" in await pg3.inner_text("#alerts"), t3[:200].replace("\n", " | "))
        check("no page errors (Square down)", not pg3.errs, str(pg3.errs))
        await br.close()
    print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
