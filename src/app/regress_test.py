# Regression checks for the issues the independent review found.
import json, asyncio, sys
sys.argv = [sys.argv[0]]
exec(open('/home/claude/creamery/app/full_test.py').read().split("async def main():")[0])
def with_counts(docs, extra, cfg=None, drop_orders=True):
    d = [x for x in copy.deepcopy(docs) if not (drop_orders and x["collection"] == "orders")]
    for i, (item, v) in enumerate(extra.items()): d.append({"collection": "counts", "id": f"r{i}{item}", "data": {"at": "2026-10-14T12:00:00.000Z", "item": item, "value": v}})
    if cfg: c = [x for x in d if x["collection"] == "config"][0]; c["data"] = merge(c["data"], cfg)
    return d
async def main():
    base = json.load(open(f'{SP}/docs_tue.json'))
    async with async_playwright() as p:
        br = await p.chromium.launch()
        # 1. Change quantities removes a line
        srv = Srv(with_counts(base, {"vanilla": 3, "chocolate": 1.5})); pg = await page(br, srv, "2026-10-14T13:00:00Z")
        await tdo(pg, "[data-act=place-gordon]"); await pg.wait_for_timeout(200); await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(900)
        await tclick(pg, "#today [data-sup=gordon] [data-act=edit-order]"); await pg.wait_for_timeout(200)
        for _ in range(12): await pg.click('.sheet [data-step="-1"][data-id="o-chocolate"]')
        await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(900)
        o = [o for o in srv.of("orders")][0]["data"]
        check("1 change quantities can remove a line", "chocolate" not in o["lines"] and o["lines"].get("vanilla", 0) > 0 and o["status"] == "placed", str(o["lines"]))
        check("1 card no longer shows chocolate", "Chocolate" not in await tin(pg, "#today"))
        # 12. arrival with everything lowered to 0 = didn't come
        await tclick(pg, "#today [data-sup=gordon] [data-act=arrived]"); await pg.wait_for_timeout(200)
        for _ in range(20): await pg.click('.sheet [data-step="-1"][data-id="a-vanilla"]')
        await pg.click("[data-act=save-arrive]"); await pg.wait_for_timeout(900)
        o = [o for o in srv.of("orders")][0]["data"]
        check("12 arrival of nothing marks it not coming", o["status"] == "cancelled" and o.get("reason") == "not_coming" and not srv.of("deliveries"), o["status"])
        # 13. default window at 8 AM is the earliest open one
        await tdo(pg, "[data-act=place-gordon]"); await pg.wait_for_timeout(200)
        check("13 window defaults to the earliest open one", await pg.eval_on_selector("#windowSel", "e => e.value") == "10 AM to 2 PM")
        await pg.click(".sheet footer [data-act=close]")
        check("no page errors (1)", not pg.errs, str(pg.errs))
        # 2. bananas prompt when only bananas are due
        srv = Srv(with_counts(base, {"vanilla": 12, "chocolate": 5, "bananas": 0})); pg = await page(br, srv, "2026-10-14T13:00:00Z")
        g = await tin(pg, "#today")
        check("2 bananas almost out shows on Gordon's card", "Bananas is almost out" in g and "Order from Gordon's" in g, g[:200].replace("\n", " | "))
        await tdo(pg, "[data-act=place-gordon-addons]"); await pg.wait_for_timeout(200)
        check("2 order sheet holds bananas", "Bananas" in await pg.inner_text(".sheet"))
        await pg.click(".sheet footer [data-act=close]")
        await tclick(pg, '#today [data-sup=gordon] [data-act=bought-any]'); await pg.wait_for_timeout(200)
        check("2 picked up opens a delivery from somewhere else", await pg.eval_on_selector("#delItem", "e => e.value") == "bananas" and await pg.eval_on_selector("#delSrc", "e => e.value") == "other")
        await pg.click(".sheet footer [data-act=close]")
        # 10. delivery: no exclusive when off; brownie packs
        await tclick(pg, "#tab-stock [data-act=open-delivery]"); await pg.wait_for_timeout(200)
        opts = await pg.eval_on_selector_all("#delItem option", "els => els.map(e => e.value)")
        check("10 delivery never lists the exclusive (set from Update exclusive)", "exclusive" not in opts and "chips" in opts and "spray" in opts)
        await pg.select_option("#delItem", "brownies"); await pg.wait_for_timeout(100)
        await pg.click('.sheet [data-step="1"][data-id="delpk"]'); await pg.click('.sheet [data-step="1"][data-id="delpk"]')
        await pg.click("[data-act=save-delivery]"); await pg.wait_for_timeout(800)
        dl = srv.of("deliveries")[-1]["data"]
        check("10 two brownie boxes add 97 servings (1 + 2×48)", dl["item"] == "brownies" and dl["qty"] == 97, str(dl))
        check("no page errors (2)", not pg.errs, str(pg.errs))
        # 3. editing a late order keeps its date
        srv = Srv(base, ); pg = await page(br, srv, "2026-10-14T19:30:00Z")
        oid = srv.of("orders")[0]["id"]
        await tclick(pg, "#today [data-sup=sams] [data-act=edit-order]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(900)
        check("3 editing a late order keeps its date", srv.get("orders", oid)["data"]["arrivesOn"] == "2026-10-13")
        # 7/8. activity
        # 4 / 18. settings validation
        await pg.click(".top [data-act=open-settings]"); await pg.wait_for_timeout(200)
        cap0 = srv.get("config", "settings")["data"]["cap"]
        for val, field, word in [("180", "#s-cap", "4 to 40"), ("3", "#s-cap", "4 to 40")]:
            await pg.fill(field, val); await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(300)
            check(f"4 cap {val} refused with a message", srv.get("config", "settings")["data"]["cap"] == cap0 and word in await pg.inner_text("#toastRoot"))
        await pg.fill("#s-cap", "18"); await pg.fill("#s-fsw", "19"); await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(300)
        check("4 floor above cap refused", "floor" in (await pg.inner_text("#toastRoot")).lower())
        await pg.fill("#s-fsw", "6"); await pg.fill("#s-c1", "14:00"); await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(300)
        check("18 reversed cutoffs refused", "earlier" in await pg.inner_text("#toastRoot"))
        await pg.fill("#s-c1", "09:30"); await pg.fill("#s-fsw", "5.5"); await pg.click("[data-act=save-settings]"); await pg.wait_for_timeout(700)
        check("valid settings still save", srv.get("config", "settings")["data"]["floors"]["sunWed"] == 5.5 and not await pg.is_visible(".sheet"))
        # 6. quarters
        check("6 floor shows as 5½", "Floor 5½ tonight" in await tin(pg, "#freezer"))
        check("no page errors (3)", not pg.errs, str(pg.errs))
        # 5. floor equal to cap stays inside the page
        srv = Srv(with_counts(base, {}, {"floors": {"sunWed": 18, "thuSat": 18}}, drop_orders=False)); pg = await page(br, srv, "2026-10-14T19:30:00Z")
        check("5 floor = cap causes no sideways scroll", await pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
        # 7. activity keeps each exclusive's own name; 8. undone orders hidden
        srv = Srv(base); pg = await page(br, srv, "2026-10-14T19:30:00Z")
        await tclick(pg, "#exclusive [data-act=open-exclusive]"); await pg.wait_for_timeout(200); await pg.fill("#x-new", "Mint Chip"); await pg.click("[data-act=add-flavor]"); await pg.click('.sheet [data-step="1"][data-id="xf0"]'); await pg.click("[data-act=save-exclusive]"); await pg.wait_for_timeout(800)
        await pg.clock.set_fixed_time("2026-10-14T19:40:00Z")
        await tclick(pg, "#exclusive [data-act=open-exclusive]"); await pg.wait_for_timeout(200); await pg.click('[data-act=rm-flavor][data-i="0"]'); await pg.fill("#x-new", "Moose Tracks"); await pg.click("[data-act=add-flavor]"); await pg.click('.sheet [data-step="1"][data-id="xf0"]'); await pg.click("[data-act=save-exclusive]"); await pg.wait_for_timeout(800)
        act = await tin(pg, "#activity"); fr = await tin(pg, "#exclusive")
        check("7 activity keeps the old flavor's name", "counted mint chip ¼" in act.lower() and "counted moose tracks" in act.lower(), act[:200].replace("\n", " | "))
        check("7 exclusive shows only the new flavor", "Moose Tracks" in fr and "Mint Chip" not in fr)
        if await pg.query_selector("[data-act=place-sams]"):
            await tdo(pg, "[data-act=place-sams]"); await pg.wait_for_timeout(200); await pg.click("[data-act=save-order]"); await pg.wait_for_timeout(800)
            await pg.click(".toast-act"); await pg.wait_for_timeout(800)
            check("8 an undone order is not in Activity", (await tin(pg, "#activity")).count("Ordered from Sam's Club") == 1)
        # 14. late Gordon order doesn't count as stock
        late = with_counts(base, {"vanilla": 3, "chocolate": 1.5})
        late.append({"collection": "orders", "id": "lateg", "data": {"supplier": "gordon", "lines": {"vanilla": 8, "chocolate": 4}, "placedAt": "2026-10-12T14:00:00.000Z", "arrivesOn": "2026-10-13", "status": "placed"}})
        srv = Srv(late); pg = await page(br, srv, "2026-10-14T13:00:00Z")
        g = await tin(pg, "#today")
        check("14 a late, unconfirmed Gordon order isn't counted as stock", "was due tuesday" in g.lower() and "Order from Gordon's" in g, g[:160].replace("\n", " | "))
        # 16. a week out reads "next"
        # 17. after closing
        pg = await page(br, Srv(base), "2026-10-15T05:30:00Z")
        st = await pg.inner_text("#status")
        check("17 after midnight says closed and the next opening", "Closed for the night. Open Thursday 8 PM to 2 AM" in st, st)
        pg = await page(br, Srv(base), "2026-10-15T02:00:00Z")
        check("17 during hours says open now", "Open now until 11 PM" in await pg.inner_text("#status"))
        await br.close()
    print(f"\n{sum(res)}/{len(res)} passed"); sys.exit(0 if all(res) else 1)
asyncio.run(main())
