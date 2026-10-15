# Pickup texts: team settings, arrival window, claim / unclaim, claim links, edits keep the claimer.
import json, asyncio, sys
sys.argv = [sys.argv[0]]
exec(open('/home/claude/creamery/app/full_test.py').read().split("async def main():")[0])
class PSrv(Srv):
    def __init__(self, docs): super().__init__(docs); self.ops = []
    async def handle(self, route):
        req = route.request
        if req.method != "OPTIONS":
            b = json.loads(req.post_data or "{}"); op = b.get("op"); self.ops.append(b)
            if op == "update" and b.get("replace"):
                d = self.get(b["collection"], b["id"]); d["data"] = merge(d["data"], b["data"])
                for k in b["replace"]: d["data"][k] = b["data"][k]
                return await route.fulfill(json={"id": b["id"]}, headers=H)
            if op in ("claim", "unclaim"):
                d = self.get("orders", b["id"]); p = d["data"].setdefault("pickup", {})
                if op == "claim":
                    if not p.get("by"): p["by"] = b["name"]
                    return await route.fulfill(json={"by": p["by"]}, headers=H)
                ok = p.get("by") == b["name"]
                if ok: p["by"] = None
                return await route.fulfill(json={"ok": ok}, headers=H)
            if op == "test_sms":
                team = self.get("config", "settings")["data"].get("team", [])
                return await route.fulfill(json={"results": [{"name": t["name"], "ok": True} for t in team]}, headers=H)
        return await Srv.handle(self, route)
async def main():
    base = json.load(open(f'{SP}/docs_tue.json'))
    docs = [d for d in copy.deepcopy(base) if d["collection"] != "orders"]
    for i, (k, v) in enumerate({"oreos": 0.5, "strawberries": 0.25}.items()):
        docs.append({"collection": "counts", "id": f"p{i}", "data": {"at": "2026-10-15T15:00:00.000Z", "item": k, "value": v}})
    async with async_playwright() as p:
        br = await p.chromium.launch()
        srv = PSrv(docs); pg = await page(br, srv, "2026-10-15T17:30:00Z")   # 12:30 PM Thursday
        # team settings
        await pg.click(".bar-bottom [data-act=open-settings]"); await pg.wait_for_timeout(200)
        await pg.fill("#t-name-0", "James"); await pg.fill("#t-phone-0", "(314) 555-0101")
        await pg.fill("#t-name-1", "Alex"); await pg.fill("#t-phone-1", "555-0102")
        await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(300)
        check("bad number is refused with a message", "number doesn't look right" in await pg.inner_text("#toastRoot") and not srv.get("config", "settings")["data"].get("team"))
        await pg.fill("#t-phone-1", "314.555.0102"); await pg.fill("#t-name-2", "Sam"); await pg.fill("#t-phone-2", "1-314-555-0103")
        await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(700)
        team = srv.get("config", "settings")["data"].get("team")
        check("team saved with clean numbers", team == [{"name": "James", "phone": "+13145550101"}, {"name": "Alex", "phone": "+13145550102"}, {"name": "Sam", "phone": "+13145550103"}], str(team))
        await pg.click(".bar-bottom [data-act=open-settings]"); await pg.wait_for_timeout(200)
        await pg.select_option("#t-me", "James"); await pg.click("[data-act=test-texts]"); await pg.wait_for_timeout(500)
        check("test text reports each person", "James sent" in await pg.inner_text("#toastRoot"))
        await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(600)
        # Sam's order with an arrival window and texts
        await pg.click("[data-act=place-sams]"); await pg.wait_for_timeout(200)
        sheet = await pg.inner_text(".sheet")
        check("order sheet has Between times and the text option", await pg.is_visible("#winFrom") and "Text James, Alex, Sam" in sheet)
        await pg.fill("#winFrom", "16:00"); await pg.fill("#winTo", "14:00"); await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(300)
        check("window ending before it starts is refused", "end after it starts" in await pg.inner_text("#toastRoot") and not srv.of("orders"))
        await pg.fill("#winFrom", "14:00"); await pg.fill("#winTo", "16:00")
        await pg.click('.sheet [data-step="1"][data-id="o-oreos"]')   # re-render must keep the times
        check("times survive + taps", await pg.input_value("#winFrom") == "14:00" and await pg.input_value("#winTo") == "16:00")
        await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(900)
        o = srv.of("orders")[0]; od = o["data"]
        check("order saved with window and pickup", od["window"] == "2 to 4 PM" and od["windowStart"] == "14:00" and od["pickup"]["text"] is True and od["pickup"]["sendAfter"] > od["placedAt"], json.dumps(od)[:200])
        check("toast says texts go out in a minute, with Undo", "Texts go out in a minute" in await pg.inner_text("#toastRoot") and "Undo" in await pg.inner_text("#toastRoot"))
        s = await pg.inner_text("#sams")
        check("card shows window and nobody yet", "2 to 4 PM" in s and "Nobody is picking it up yet" in s, s[:200].replace("\n", " | "))
        await pg.click("#sams [data-act=claim]"); await pg.wait_for_timeout(800)
        s = await pg.inner_text("#sams")
        check("I'll pick it up claims as this phone's person", srv.get("orders", o["id"])["data"]["pickup"]["by"] == "James" and "James is picking it up" in s)
        await pg.click("#sams [data-act=edit-order]"); await pg.wait_for_timeout(200)
        await pg.click('.sheet [data-step="-1"][data-id="o-oreos"]'); await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(800)
        od = srv.get("orders", o["id"])["data"]
        check("editing the order keeps who's picking it up", od["pickup"]["by"] == "James" and od["window"] == "2 to 4 PM", json.dumps(od.get("pickup")))
        await pg.click("#sams [data-act=unclaim]"); await pg.wait_for_timeout(800)
        check("I can't anymore hands it back", srv.get("orders", o["id"])["data"]["pickup"]["by"] is None and "Nobody is picking it up yet" in await pg.inner_text("#sams"))
        check("no page errors (1)", not pg.errs, str(pg.errs))
        # claim link on a phone that hasn't said who it is
        ctx = await br.new_context(viewport={"width": 390, "height": 844})
        await ctx.add_init_script("localStorage.setItem('cc-inventory-passcode','1234')"); await ctx.route("https://fn.test/**", srv.handle)
        pg2 = await ctx.new_page(); pg2.errs = []; pg2.on("pageerror", lambda e: pg2.errs.append(str(e)))
        await pg2.clock.set_fixed_time("2026-10-15T17:40:00Z")
        await pg2.goto(f'file://{SP}/full.html?claim={o["id"]}'); await pg2.wait_for_timeout(1700)
        t = await pg2.inner_text(".sheet")
        check("claim link opens the claim screen", "Pick up this order?" in t and "2 to 4 PM" in t, t[:120].replace("\n", " | "))
        await pg2.click(".sheet [data-act=claim]"); await pg2.wait_for_timeout(300)
        check("asks who you are first", "Who are you?" in await pg2.inner_text(".sheet"))
        await pg2.click('[data-act=pick-me][data-name="Alex"]'); await pg2.wait_for_timeout(800)
        check("claim goes to the chosen person", srv.get("orders", o["id"])["data"]["pickup"]["by"] == "Alex" and "Alex is picking it up" in await pg2.inner_text("#sams"))
        check("link is removed from the address", "claim=" not in pg2.url)
        await pg.reload(); await pg.wait_for_timeout(1500)
        check("other phones see who claimed it, without an unclaim button", "Alex is picking it up" in await pg.inner_text("#sams") and not await pg.query_selector("#sams [data-act=unclaim]"))
        check("no page errors (2)", not pg2.errs and not pg.errs, str(pg2.errs + pg.errs))
        # Gordon window start from its label
        low = copy.deepcopy(srv.docs) + [{"collection": "counts", "id": "gv", "data": {"at": "2026-10-15T12:00:00.000Z", "item": "vanilla", "value": 3}}, {"collection": "counts", "id": "gc", "data": {"at": "2026-10-15T12:00:00.000Z", "item": "chocolate", "value": 1.5}}]
        srv3 = PSrv(low); pg3 = await page(br, srv3, "2026-10-15T13:00:00Z")
        await pg3.click("[data-act=place-gordon]"); await pg3.wait_for_timeout(200)
        check("Gordon's sheet offers texts too", await pg3.is_visible("#textTeam"))
        await pg3.click("[data-act=save-order]"); await pg3.wait_for_timeout(900)
        g = [x for x in srv3.of("orders") if x["data"]["supplier"] == "gordon"][-1]["data"]
        check("Gordon's order keeps its window start", g["window"] == "10 AM to 2 PM" and g["windowStart"] == "10:00" and g["pickup"]["text"], json.dumps(g)[:160])
        check("Gordon's card shows the pickup line", "Nobody is picking it up yet" in await pg3.inner_text("#gordon"))
        check("no page errors (3)", not pg3.errs, str(pg3.errs))
        await br.close()
    print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
