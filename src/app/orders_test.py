# Order flow: go back saves nothing, double tap saves once, a placed order replaces the
# "order now" card (no "due today" banner), Undo and Cancel work, arrival adds stock.
import json, asyncio, sys, uuid, copy
from playwright.async_api import async_playwright
SP = "/tmp/claude-0/-home-claude-cc-freezer-q7m2x9/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad"
daily = json.load(open('/home/claude/creamery/data/live_daily_1012.json'))
docs = json.load(open(f'{SP}/docs_now.json'))
html = open('/home/claude/creamery/app/site/index.html').read().replace('https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory', 'https://fn.test/inventory')
open(f'{SP}/ord.html', 'w').write(html)
H = {"access-control-allow-origin": "*"}; adds = []
def merge(a, b):
    out = dict(a)
    for k, v in b.items(): out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out
async def handle(route):
    req = route.request
    if req.method == "OPTIONS": return await route.fulfill(status=200, headers={**H, "access-control-allow-headers": "*"})
    b = json.loads(req.post_data or "{}"); op = b.get("op")
    if op == "state": return await route.fulfill(json={"docs": copy.deepcopy(docs)}, headers=H)
    if op == "sales": return await route.fulfill(json={"data": daily if b["query"]["timeDimensions"][0]["dimension"].endswith("reporting_day") else []}, headers=H)
    if op == "add":
        await asyncio.sleep(0.25)
        i = str(uuid.uuid4()); docs.append({"collection": b["collection"], "id": i, "data": b["data"]}); adds.append(b); return await route.fulfill(json={"id": i}, headers=H)
    if op == "update":
        for d in docs:
            if d["collection"] == b["collection"] and d["id"] == b["id"]: d["data"] = merge(d["data"], b["data"])
        return await route.fulfill(json={"id": b["id"]}, headers=H)
    return await route.fulfill(json={"id": "x"}, headers=H)
orders = lambda: [d for d in docs if d["collection"] == "orders"]
res = []
def check(name, ok, info=""):
    res.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  ({info})" if info else ""))
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); pg = await br.new_page(viewport={"width": 390, "height": 844}); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.clock.set_fixed_time("2026-10-13T01:55:00Z")
        await pg.add_init_script("localStorage.setItem('cc-inventory-passcode','x')")
        await pg.route("https://fn.test/**", handle)
        await pg.goto(f'file://{SP}/ord.html'); await pg.wait_for_timeout(1500)
        sams = lambda: pg.inner_text("#sams")
        check("starts with an order-now card", "Order from Sam's Club" in await sams())
        await pg.click("[data-act=place-sams]"); await pg.wait_for_timeout(200)
        check("sheet asks to confirm", "Confirm your Sam's Club order" in await pg.inner_text(".sheet"))
        check("arrives defaults to tomorrow after 4 PM", await pg.eval_on_selector("#arrivesSel", "e => e.value") == "2026-10-13")
        await pg.click(".sheet footer [data-act=close]"); await pg.wait_for_timeout(300)
        check("Go back saves nothing", len(orders()) == 0 and "Order from Sam's Club" in await sams() and "order placed" not in await sams())
        await pg.click("[data-act=place-sams]"); await pg.wait_for_timeout(200)
        await pg.evaluate("() => { const b = document.querySelector('[data-act=save-order]'); b.click(); b.click(); b.click(); }")
        await pg.wait_for_timeout(1200)
        check("triple tap on Save saves exactly one order", len(orders()) == 1, str(len(orders())))
        t = await sams()
        check("placed order replaces the order-now card", "Sam's Club order placed" in t and "Order from Sam's Club" not in t, t[:90].replace("\n", " | "))
        check("no 'delivery due today' banner", "due today" not in (await pg.inner_text("body")))
        check("arrives tomorrow shown", "Arrives tomorrow" in t)
        pantry = await pg.inner_text("#pantry")
        check("pantry marks Oreos as ordered", "Ordered" in pantry)
        toast_txt = await pg.inner_text("#toastRoot")
        check("toast offers Undo", "Undo" in toast_txt, toast_txt)
        await pg.click(".toast-act"); await pg.wait_for_timeout(800)
        check("Undo cancels the order", orders()[0]["data"]["status"] == "cancelled" and orders()[0]["data"].get("reason") == "undo")
        check("order-now card is back after Undo", "Order from Sam's Club" in await sams())
        await pg.click("[data-act=place-sams]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(1000)
        oid = [o for o in orders() if o["data"]["status"] == "placed"][0]["id"]
        await pg.click(f"#sams [data-act=cancel-order]"); await pg.wait_for_timeout(200)
        check("cancel asks first", "Cancel this order?" in await sams())
        await pg.click("[data-act=keep-order]"); await pg.wait_for_timeout(200)
        check("Keep it keeps the order", "Sam's Club order placed" in await sams() and [o for o in orders() if o["id"] == oid][0]["data"]["status"] == "placed")
        await pg.click("#sams [data-act=cancel-order]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=confirm-cancel]"); await pg.wait_for_timeout(800)
        check("Yes, cancel it cancels", [o for o in orders() if o["id"] == oid][0]["data"]["status"] == "cancelled" and "Order from Sam's Club" in await sams())
        # place for today and mark arrived
        await pg.click("[data-act=place-sams]"); await pg.wait_for_timeout(200)
        await pg.select_option("#arrivesSel", "2026-10-12"); await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(1000)
        t = await sams()
        check("today's order shows It arrived, still no separate banner", "It arrived" in t and "due today" not in (await pg.inner_text("body")))
        n0 = len(adds)
        await pg.click("#sams [data-act=arrived]"); await pg.wait_for_timeout(200)
        await pg.evaluate("() => { const b = document.querySelector('[data-act=save-arrive]'); b.click(); b.click(); }")
        await pg.wait_for_timeout(2500)
        dels = [a["data"] for a in adds[n0:] if a["collection"] == "deliveries"]
        got = {d["item"]: d["qty"] for d in dels}
        check("arrival adds each item once, in counting units", len(dels) == len(got) and got.get("oreos") == 7 and got.get("brownies") == 96, str(got))
        t = await sams()
        check("after arrival the placed card is gone", "order placed" not in t and "It arrived" not in t, t[:80].replace("\n", " | "))
        check("no page errors", not errs, str(errs))
        await pg.screenshot(path=f"{SP}/shots/orders-end.png", full_page=True)
        await br.close()
    print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
