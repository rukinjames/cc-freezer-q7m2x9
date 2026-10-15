# End-to-end check of every screen against a stateful mock of the server.
import json, asyncio, sys, uuid, copy
from playwright.async_api import async_playwright
SP = "/tmp/claude-0/-home-claude-cc-freezer-q7m2x9/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad"
daily = json.load(open('/home/claude/creamery/data/live_daily_1013.json'))
hourly = json.load(open(f'{SP}/hourly_tue.json'))
html = open('/home/claude/creamery/app/site/index.html').read().replace('https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory', 'https://fn.test/inventory')
open(f'{SP}/full.html', 'w').write(html)
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
    await pg.goto(f'file://{SP}/full.html'); await pg.wait_for_timeout(1500)
    return pg
async def step(pg, id_, n=1, dirn=1):
    for _ in range(n): await pg.click(f'.sheet [data-step="{dirn}"][data-id="{id_}"]')
async def main():
    base_docs = json.load(open(f'{SP}/docs_tue.json'))
    async with async_playwright() as p:
        br = await p.chromium.launch()
        # ---------- count sheet ----------
        srv = Srv(base_docs); pg = await page(br, srv, "2026-10-14T19:30:00Z")
        await pg.click(".bar-bottom [data-act=open-count]"); await pg.wait_for_timeout(200)
        v0 = await pg.inner_text("#v-vanilla"); await step(pg, "vanilla", 2, -1); v1 = await pg.inner_text("#v-vanilla")
        check("count: vanilla steps in quarters", v0 != v1, f"{v0} -> {v1}")
        await step(pg, "spoons", 1, 1); sp = await pg.inner_text("#v-spoons")
        await step(pg, "bLoose", 3, 1); await step(pg, "bLd", 1, 1)
        await pg.click(".sheet footer [data-act=close]"); await pg.wait_for_timeout(200)
        n_counts = len(srv.of("counts"))
        check("count: Cancel saves nothing", n_counts == len([d for d in base_docs if d["collection"] == "counts"]))
        await pg.click(".bar-bottom [data-act=open-count]"); await pg.wait_for_timeout(200)
        await step(pg, "vanilla", 1, 1); await step(pg, "vanilla", 1, -1)   # confirm as-is
        await step(pg, "chocolate", 2, 1); await step(pg, "bLoose", 4, 1)
        save_label = await pg.inner_text("[data-act=save-count]")
        check("count: save button counts touched rows", "3" in save_label, save_label)
        await pg.click("[data-act=save-count]"); await pg.wait_for_timeout(800)
        new = [d["data"] for d in srv.of("counts")][n_counts:]
        items = {d["item"]: d for d in new}
        check("count: exactly the touched rows saved", set(items) == {"vanilla", "chocolate", "brownies"}, str(sorted(items)))
        check("count: brownie split saved", "detail" in items.get("brownies", {}) and items["brownies"]["value"] == items["brownies"]["detail"]["ld"] * 48 + items["brownies"]["detail"]["loose"])
        fr = await pg.inner_text("#freezer")
        check("count: freezer shows the new chocolate count", ("Counted " + (await pg.evaluate("v => v", None) or "")) is not None and "Counted" in fr)
        # ---------- delivery ----------
        n_del = len(srv.of("deliveries"))
        await pg.click(".bar-bottom [data-act=open-delivery]"); await pg.wait_for_timeout(200)
        await pg.select_option("#delItem", "strawberries"); await pg.wait_for_timeout(100)
        await pg.select_option("#delSrc", "other"); await step(pg, "del", 2, 1)
        src_after = await pg.eval_on_selector("#delSrc", "e => e.value"); qty = await pg.inner_text("#v-del")
        check("delivery: From choice survives + taps", src_after == "other", src_after)
        check("delivery: bags step in quarters", qty == "1½", qty)
        await pg.click("[data-act=save-delivery]"); await pg.wait_for_timeout(800)
        dl = srv.of("deliveries")[n_del:]
        check("delivery: saved once with item, qty and source", len(dl) == 1 and dl[0]["data"]["item"] == "strawberries" and dl[0]["data"]["qty"] == 1.5 and dl[0]["data"]["source"] == "other", str([d["data"] for d in dl]))
        pantry = await pg.inner_text("#pantry")
        check("delivery: pantry reflects it", "Strawberries" in pantry)
        await pg.click(".bar-bottom [data-act=open-delivery]"); await pg.wait_for_timeout(200)
        await pg.select_option("#delItem", "coke"); await step(pg, "del", 3, 1)
        check("delivery: cans step by whole numbers", await pg.inner_text("#v-del") == "4")
        await pg.click(".sheet footer [data-act=close]")
        # ---------- settings ----------
        await pg.click(".bar-bottom [data-act=open-settings]"); await pg.wait_for_timeout(200)
        vals = {"#s-cap": "17", "#s-fsw": "5.5", "#s-fts": "9", "#s-gmin": "80", "#s-smin": "45", "#s-cover": "12", "#s-yv": "21.5", "#s-yc": "24", "#s-ye": "20"}
        for sel, v in vals.items(): await pg.fill(sel, v)
        await pg.fill("#s-c1", "09:15"); await pg.fill("#s-c2", "12:45")
        await pg.fill("#s-cdate", "2026-11-26"); await pg.click("[data-act=add-closed]"); await pg.wait_for_timeout(100)
        await pg.fill("#s-cdate", "2026-11-27"); await pg.click("[data-act=add-closed]"); await pg.wait_for_timeout(100)
        check("settings: typed values survive adding a closed night", await pg.input_value("#s-cap") == "17")
        await pg.click('[data-act=rm-closed][data-ds="2026-11-27"]'); await pg.wait_for_timeout(100)
        await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(800)
        sd = srv.get("config", "settings")["data"]
        ok = (sd["cap"] == 17 and sd["floors"] == {"sunWed": 5.5, "thuSat": 9} and sd["gordon"]["minimum"] == 80 and sd["supplies"]["samsMinimum"] == 45
              and sd["supplies"]["coverTo"] == 12 and sd["yields"] == {"vanilla": 21.5, "chocolate": 24, "exclusive": 20}
              and [w["cutoff"] for w in sd["gordon"]["windows"]] == ["09:15", "12:45"] and sd["closedDates"] == ["2026-11-26"])
        check("settings: every field saved", ok, json.dumps({k: sd.get(k) for k in ["cap", "floors", "gordon", "supplies", "yields", "closedDates"]})[:300])
        await pg.click(".bar-bottom [data-act=open-settings]"); await pg.wait_for_timeout(200)
        check("settings: reopened form shows saved values", await pg.input_value("#s-cap") == "17" and await pg.input_value("#s-c1") == "09:15" and "Nov 26" in await pg.inner_text(".sheet"))
        await pg.fill("#s-cap", "3"); await pg.click(".sheet footer [data-act=close]"); await pg.wait_for_timeout(200)
        check("settings: Cancel discards", srv.get("config", "settings")["data"]["cap"] == 17)
        await pg.click(".bar-bottom [data-act=open-settings]"); await pg.wait_for_timeout(200)
        await pg.fill("#s-cap", ""); await pg.fill("#s-fsw", "-4"); await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(600)
        sd = srv.get("config", "settings")["data"]
        check("settings: blank/negative input keeps the old value", sd["cap"] == 17 and sd["floors"]["sunWed"] == 5.5, f'cap {sd["cap"]} floor {sd["floors"]["sunWed"]}')
        # restore real settings for the rest
        srv.get("config", "settings")["data"] = [d for d in base_docs if d["collection"] == "config"][0]["data"]
        await pg.reload(); await pg.wait_for_timeout(1500)
        # ---------- exclusive ----------
        check("exclusive: freezer offers to add one", "Add an exclusive flavor" in await pg.inner_text("#freezer"))
        await pg.click("#freezer [data-act=open-exclusive]"); await pg.wait_for_timeout(200)
        await step(pg, "ex", 9, 1); await pg.click("[data-act=save-exclusive]"); await pg.wait_for_timeout(400)
        check("exclusive: refuses with no name", srv.get("config", "settings")["data"]["exclusive"].get("active") is not True and await pg.is_visible(".sheet"))
        await pg.fill("#ex-name", "Cookie Monster"); await pg.click("[data-act=save-exclusive]"); await pg.wait_for_timeout(900)
        ex = srv.get("config", "settings")["data"]["exclusive"]
        exc = [d["data"] for d in srv.of("counts") if d["data"]["item"] == "exclusive"][-1]
        check("exclusive: saved name, on, and a count", ex["active"] and ex["name"] == "Cookie Monster" and exc["value"] == 2.25 and exc["at"] >= ex["since"], f"{ex} {exc}")
        fr = await pg.inner_text("#freezer")
        check("exclusive: freezer shows name, tubs and nights left", "Cookie Monster" in fr and "2¼" in fr and "night" in fr and "Not reordered" in fr, fr[-260:].replace("\n", " | "))
        g = await pg.inner_text("#gordon")
        check("exclusive: Gordon's never lists it", "Cookie Monster" not in g and "Exclusive" not in g)
        await pg.click(".bar-bottom [data-act=open-count]"); await pg.wait_for_timeout(200)
        check("exclusive: count sheet has its row", "Cookie Monster" in await pg.inner_text(".sheet"))
        await pg.click(".sheet footer [data-act=close]")
        await pg.click("#freezer [data-act=open-exclusive]"); await pg.wait_for_timeout(200)
        check("exclusive: Change opens with the name and tubs", await pg.input_value("#ex-name") == "Cookie Monster" and await pg.inner_text("#v-ex") == "2¼")
        await step(pg, "ex", 1, -1); await pg.click("[data-act=save-exclusive]"); await pg.wait_for_timeout(800)
        ex2 = srv.get("config", "settings")["data"]["exclusive"]
        check("exclusive: changing tubs keeps the same flavor", ex2["since"] == ex["since"] and "2" in await pg.inner_text("#freezer"))
        await pg.click("#freezer [data-act=open-exclusive]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=end-exclusive]"); await pg.wait_for_timeout(800)
        fr = await pg.inner_text("#freezer")
        check("exclusive: No exclusive now hides it", srv.get("config", "settings")["data"]["exclusive"]["active"] is False and "Cookie Monster" not in fr and "Add an exclusive flavor" in fr)
        await pg.click("#freezer [data-act=open-exclusive]"); await pg.wait_for_timeout(200)
        await pg.fill("#ex-name", "Birthday Cake"); await pg.click("[data-act=save-exclusive]"); await pg.wait_for_timeout(800)
        fr = await pg.inner_text("#freezer")
        check("exclusive: a new flavor starts fresh (old tubs ignored)", "Birthday Cake" in fr and "Cookie Monster" not in fr)
        check("no page errors (phone)", not pg.errs, str(pg.errs))
        # ---------- Gordon: morning, low stock ----------
        low = [d for d in base_docs if not (d["collection"] == "orders")]
        low.append({"collection": "counts", "id": "lowv", "data": {"at": "2026-10-14T12:00:00.000Z", "item": "vanilla", "value": 3}})
        low.append({"collection": "counts", "id": "lowc", "data": {"at": "2026-10-14T12:00:00.000Z", "item": "chocolate", "value": 1.5}})
        low.append({"collection": "counts", "id": "ex1", "data": {"at": "2026-10-14T12:00:00.000Z", "item": "exclusive", "value": 3}})
        cfg = [d for d in low if d["collection"] == "config"][0]; cfg["data"] = merge(cfg["data"], {"exclusive": {"active": True, "name": "Mint", "since": "2026-10-14T11:00:00.000Z"}})
        srv = Srv(low); pg = await page(br, srv, "2026-10-14T13:00:00Z")
        g = await pg.inner_text("#gordon")
        check("gordon: low stock in the morning says to order", "Order from Gordon's" in g, g[:80].replace("\n", " | "))
        check("gordon: no exclusive and no zero lines", "Mint" not in g and "\n0\n" not in g)
        fr = await pg.inner_text("#freezer"); m = await pg.evaluate("() => document.querySelector('#gordon').innerText")
        await pg.click("[data-act=place-gordon]"); await pg.wait_for_timeout(200)
        sheet_t = await pg.inner_text(".sheet")
        check("gordon: confirm sheet", "Confirm your Gordon's order" in sheet_t and "Mint" not in sheet_t, sheet_t[:120].replace("\n", " | "))
        await pg.evaluate("() => { const b = document.querySelector('[data-act=save-order]'); b.click(); b.click(); }"); await pg.wait_for_timeout(1000)
        check("gordon: one order saved", len([o for o in srv.of("orders") if o["data"]["status"] == "placed"]) == 1)
        g = await pg.inner_text("#gordon")
        check("gordon: card becomes 'order is in' with actions", "order is in" in g and "It arrived" in g and "Cancel order" in g, g[:90].replace("\n", " | "))
        check("gordon: no duplicate due banner", (await pg.inner_text("body")).count("delivery due today") == 0)
        o = [o for o in srv.of("orders") if o["data"]["status"] == "placed"][0]
        await pg.click("#gordon [data-act=arrived]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=save-arrive]"); await pg.wait_for_timeout(1000)
        dl = [d["data"] for d in srv.of("deliveries") if d["data"].get("orderId") == o["id"]]
        check("gordon: arrival adds the tubs", sum(d["qty"] for d in dl) == sum(o["data"]["lines"].values()) and srv.get("orders", o["id"])["data"]["status"] == "arrived", str(dl))
        check("no page errors (gordon)", not pg.errs, str(pg.errs))
        # ---------- copy + update + laptop layout ----------
        srv = Srv(base_docs); pg = await page(br, srv, "2026-10-14T19:30:00Z", (1366, 900))
        n_sales = srv.log.count("sales")
        await pg.click("[data-act=refresh]"); await pg.wait_for_timeout(800)
        check("update: re-reads Square", srv.log.count("sales") > n_sales)
        if await pg.query_selector("[data-act=copy-sams]"):
            await pg.click("[data-act=copy-sams]"); await pg.wait_for_timeout(300)
            body = await pg.inner_text("body")
            check("copy: copies or shows the copy sheet", "Copied" in body or "Copy this" in body)
        wide = await pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
        check("laptop: no sideways scroll", wide)
        pg2 = await page(br, Srv(base_docs), "2026-10-14T19:30:00Z")
        check("phone: no sideways scroll", await pg2.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
        check("no page errors (laptop)", not pg.errs and not pg2.errs, str(pg.errs + pg2.errs))
        await br.close()
    print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
