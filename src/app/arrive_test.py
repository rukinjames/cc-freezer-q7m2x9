# An arrived Sam's order must add store packs converted to counting units.
import json, asyncio, sys
from playwright.async_api import async_playwright
SP = "/tmp/claude-0/-home-claude-cc-freezer-q7m2x9/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad"
daily = json.load(open('data/live_daily_1012.json'))
docs = json.load(open(f'{SP}/docs_now.json'))
docs.append({"collection": "orders", "id": "o1", "data": {"supplier": "sams", "lines": {"brownies": 2, "ctc": 1, "oreos": 7}, "placedAt": "2026-10-13T01:10:00.000Z", "arrivesOn": "2026-10-12", "window": None, "status": "placed"}})
html = open('app/site/index.html').read().replace('https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory', 'https://fn.test/inventory')
open(f'{SP}/arr.html', 'w').write(html)
H = {"access-control-allow-origin": "*"}; added = []
async def handle(route):
    req = route.request
    if req.method == "OPTIONS": return await route.fulfill(status=200, headers={**H, "access-control-allow-headers": "*"})
    b = json.loads(req.post_data or "{}")
    if b.get("op") == "state": return await route.fulfill(json={"docs": docs}, headers=H)
    if b.get("op") == "sales": return await route.fulfill(json={"data": daily if b["query"]["timeDimensions"][0]["dimension"].endswith("reporting_day") else []}, headers=H)
    if b.get("op") == "add": added.append(b["data"])
    return await route.fulfill(json={"id": "x"}, headers=H)
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); pg = await br.new_page(viewport={"width": 390, "height": 844})
        await pg.clock.set_fixed_time("2026-10-13T01:20:00Z")
        await pg.add_init_script("localStorage.setItem('cc-inventory-passcode','x')")
        await pg.route("https://fn.test/**", handle)
        await pg.goto(f'file://{SP}/arr.html'); await pg.wait_for_timeout(1500)
        await pg.click("[data-act=arrived]"); await pg.wait_for_timeout(200)
        sheet = (await pg.inner_text(".sheet")).replace("\n", " | ")
        await pg.click("[data-act=save-arrive]"); await pg.wait_for_timeout(500)
        got = {a["item"]: a["qty"] for a in added}
        print("sheet:", sheet[:200])
        print("added:", got)
        ok = got == {"brownies": 96, "ctc": 2.6, "oreos": 7}
        print("PASS" if ok else "FAIL"); await br.close(); sys.exit(0 if ok else 1)
asyncio.run(main())
