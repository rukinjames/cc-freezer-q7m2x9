# End-to-end check of every screen against a stateful mock of the server.
import json, asyncio, sys, uuid, copy
from playwright.async_api import async_playwright
SP = "/tmp/claude-0/-home-claude-cc-freezer-q7m2x9/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad"
daily = json.load(open('/home/claude/creamery/data/live_daily_1013.json'))
hourly = json.load(open(f'{SP}/hourly_tue.json'))
html = open('/home/claude/creamery/app/site/index.html').read().replace('https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory', 'https://fn.test/inventory')
open(f'{SP}/items.html', 'w').write(html)
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
    await pg.goto(f'file://{SP}/items.html'); await pg.wait_for_timeout(1500)
    return pg
async def step(pg, id_, n=1, dirn=1):
    for _ in range(n): await pg.click(f'.sheet [data-step="{dirn}"][data-id="{id_}"]')

T0 = "2026-10-14T19:00:00.000Z"
def docs_with(extra):
    d = copy.deepcopy(json.load(open(f'{SP}/docs_tue.json')))
    d = [x for x in d if x["collection"] != "orders"]
    return d + extra
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        extra = [
            {"collection": "counts", "id": "c-bis", "data": {"item": "biscoff", "value": 1, "at": T0}},
            {"collection": "counts", "id": "c-spray", "data": {"item": "spray", "value": 1, "at": T0}},
            {"collection": "counts", "id": "c-wipes", "data": {"item": "wipes", "value": 2, "at": T0}},
            {"collection": "deliveries", "id": "d-chips", "data": {"item": "chips", "qty": 2, "at": T0, "source": "sams"}},
            {"collection": "orders", "id": "o-sams", "data": {"supplier": "sams", "lines": {"oreos": 4, "matcha": 1, "brownies": 2}, "placedAt": "2026-10-14T15:49:40.006Z", "arrivesOn": "2026-10-14", "window": "2 to 4 PM", "windowStart": "14:00", "winFrom": "14:00", "winTo": "16:00", "status": "placed", "pickup": {"text": True, "by": "Cooper Hazday", "alertedAt": "2026-10-14T15:51:00Z"}}},
        ]
        srv = Srv(docs_with(extra)); pg = await page(br, srv, "2026-10-14T19:30:00Z")
        pan = await pg.inner_text("#pantry")
        check("Biscoff is in the pantry", "Biscoff" in pan, pan[:300].replace("\n", " | "))
        check("cleaning shelf shows amount and when it was updated", "Cleaning spray" in pan and "1 bottle, updated" in pan and "Cleaning wipes" in pan and "2 packs, updated" in pan, pan[-300:].replace("\n", " | "))
        check("spray at 1 says buy more, wipes at 2 are fine", "Buy more" in pan and "Fine" in pan)
        sams = await pg.inner_text("#sams")
        check("Sam's side says to buy more spray", "spray" in sams.lower(), sams[:300].replace("\n", " | "))
        exs = await pg.inner_text("#exclusive")
        check("delivered chips show before they're counted", "2 bags delivered Wed 2:00 PM, not counted yet" in exs, exs.replace("\n", " | ")[:300])
        check("pantry has no exclusive toppings", "Chips" not in pan and "Pretzels" not in pan)
        # change an order: add something that wasn't listed
        await pg.click('[data-act=edit-order][data-id="o-sams"]'); await pg.wait_for_timeout(200)
        opts = await pg.eval_on_selector_all("#addLine option", "els => els.map(e => e.value)")
        check("order picker offers what isn't listed", "chips" in opts and "pretzels" in opts and "reesescups" in opts and "spray" in opts and "oreos" not in opts and "vanilla" not in opts and "exclusive" not in opts, str(opts))
        await pg.select_option("#addLine", "chips"); await pg.wait_for_timeout(150)
        await pg.click('.sheet [data-step="1"][data-id="o-chips"]')
        await pg.select_option("#addLine", "pretzels"); await pg.wait_for_timeout(150)
        check("picked items become rows and the window is kept", await pg.inner_text("#v-o-chips") == "2" and await pg.inner_text("#v-o-pretzels") == "1" and await pg.input_value("#winFrom") == "14:00")
        await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(900)
        o = srv.get("orders", "o-sams")["data"]
        check("saved with the new items, pickup untouched", o["lines"] == {"oreos": 4, "matcha": 1, "brownies": 2, "chips": 2, "pretzels": 1} and o["pickup"]["by"] == "Cooper Hazday", str(o))
        card = await pg.inner_text("#sams")
        check("order card lists the added items", "Ruffles" in card and "Utz" in card, card[:400].replace("\n", " | "))
        # partial arrival: what's still shipping stays on order
        await pg.click('#sams [data-act=arrived][data-id="o-sams"]'); await pg.wait_for_timeout(200)
        check("no rest option when everything came", await pg.query_selector("#restComing") is None)
        await pg.click('.sheet [data-step="-1"][data-id="a-matcha"]'); await pg.click('.sheet [data-step="-1"][data-id="a-pretzels"]'); await pg.wait_for_timeout(100)
        check("lowering something offers to keep the rest on order", await pg.is_checked("#restComing") and "stays on order" in await pg.inner_text(".sheet"))
        await pg.click("[data-act=save-arrive]"); await pg.wait_for_timeout(1000)
        o = srv.get("orders", "o-sams")["data"]
        rest = [d for d in srv.of("orders") if d["data"].get("restOf") == "o-sams"]
        check("the order is in with what came", o["status"] == "arrived" and o["received"] == {"oreos": 4, "matcha": 0, "brownies": 2, "chips": 2, "pretzels": 0}, str(o.get("received")))
        check("the rest is a new order on its way, no texts", len(rest) == 1 and rest[0]["data"]["lines"] == {"matcha": 1, "pretzels": 1} and rest[0]["data"]["status"] == "placed" and "pickup" not in rest[0]["data"], str(rest))
        dl = {d["data"]["item"]: d["data"]["qty"] for d in srv.of("deliveries") if d["data"].get("orderId") == "o-sams"}
        check("what came is added to stock in counting units", dl == {"oreos": 4, "brownies": 96, "chips": 2}, str(dl))
        exs = await pg.inner_text("#exclusive")
        check("chips now show 4 bags and pretzels as ordered", "4 bags" in exs and "Ordered" in exs, exs.replace("\n", " | ")[:400])
        # same again, but the rest isn't coming
        await pg.click(f'#sams [data-act=arrived][data-id="{rest[0]["id"]}"]'); await pg.wait_for_timeout(200)
        await pg.click('.sheet [data-step="-1"][data-id="a-pretzels"]'); await pg.wait_for_timeout(100)
        await pg.uncheck("#restComing"); await pg.wait_for_timeout(100)
        check("unticking says the rest is dropped", "dropped from the order" in await pg.inner_text(".sheet"))
        await pg.click("[data-act=save-arrive]"); await pg.wait_for_timeout(900)
        check("nothing is kept on order when the rest isn't coming", not [d for d in srv.of("orders") if d["data"].get("restOf") == rest[0]["id"]] and srv.get("orders", rest[0]["id"])["data"]["status"] == "arrived")
        # log a new Sam's order from nothing
        btn = await pg.query_selector("[data-act=log-sams]")
        if btn:
            await btn.click(); await pg.wait_for_timeout(200)
            sh = await pg.inner_text(".sheet")
            check("logging a Sam's order starts with just the picker", await pg.query_selector(".sheet [data-step]") is None and "Add an item" in await pg.inner_html(".sheet"))
            await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(300)
            check("an empty order can't be saved", await pg.is_visible(".sheet"))
            await pg.click(".sheet footer [data-act=close]")
        # count sheet saves cleaning in whole numbers
        await pg.click(".bar-bottom [data-act=open-count]"); await pg.wait_for_timeout(200)
        await pg.click('.sheet [data-step="1"][data-id="spray"]'); await pg.click('.sheet [data-step="1"][data-id="spray"]')
        await pg.click('.sheet [data-step="1"][data-id="biscoff"]')
        await pg.click("[data-act=save-count]"); await pg.wait_for_timeout(900)
        sp = [d["data"] for d in srv.of("counts") if d["data"]["item"] == "spray"][-1]
        bi = [d["data"] for d in srv.of("counts") if d["data"]["item"] == "biscoff"][-1]
        check("cleaning counts are whole bottles", sp["value"] == 3, str(sp))
        check("Biscoff counts in quarter packs", bi["value"] == 1.25, str(bi))
        pan = await pg.inner_text("#pantry")
        check("spray back to 3 says fine", "3 bottles, updated" in pan and "Buy more" not in pan, pan[-300:].replace("\n", " | "))
        check("phone: no sideways scroll", await pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
        check("no page errors", not pg.errs, str(pg.errs))
        await br.close()
    print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
