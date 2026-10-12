# Passcode gate tests against the built website with a mocked server.
# The server answers slowly (like the real one, which waits 500 ms on a wrong passcode),
# and we sample the page every 20 ms to prove nothing from the app ever shows without a valid passcode.
import json, asyncio, sys
from playwright.async_api import async_playwright
SP = "/tmp/claude-0/-home-claude-cc-freezer-q7m2x9/afdc10b5-bbe0-56c2-96d3-b3cf3620324d/scratchpad"
GOOD = "correct horse"
LOCKED_IP_PASS = "trigger-lockout"
html = open('app/site/index.html').read().replace('https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory', 'https://fn.test/inventory')
open(f'{SP}/sec.html', 'w').write(html)
URL = f'file://{SP}/sec.html'
docs = [{"collection": "counts", "id": "c1", "data": {"at": "2026-10-12T21:03:00.000Z", "item": "vanilla", "value": 10.5}},
        {"collection": "counts", "id": "c2", "data": {"at": "2026-10-12T21:03:00.000Z", "item": "chocolate", "value": 3.5}}]
H = {"access-control-allow-origin": "*"}
async def handle(route):
    req = route.request
    if req.method == "OPTIONS": return await route.fulfill(status=200, headers={**H, "access-control-allow-headers": "*"})
    p = req.headers.get("x-passcode", "")
    if p == LOCKED_IP_PASS:
        await asyncio.sleep(0.3); return await route.fulfill(status=429, json={"error": "too_many_attempts"}, headers=H)
    if p != GOOD:
        await asyncio.sleep(0.8); return await route.fulfill(status=401, json={"error": "wrong_passcode"}, headers=H)
    await asyncio.sleep(0.3)
    body = json.loads(req.post_data or "{}")
    if body.get("op") == "state": return await route.fulfill(json={"docs": docs}, headers=H)
    if body.get("op") == "sales": return await route.fulfill(json={"data": []}, headers=H)
    return await route.fulfill(json={"id": "x"}, headers=H)

LEAK_JS = """() => ({ app: !!document.getElementById('freezer') || !!document.getElementById('shell'),
  data: document.body.innerText.includes('10½') || document.body.innerText.includes('3½'),
  gate: !!document.getElementById('gateForm') })"""
async def watch(pg, ms):
    seen = {"app": False, "data": False}
    for _ in range(ms // 20):
        s = await pg.evaluate(LEAK_JS)
        seen["app"] |= s["app"]; seen["data"] |= s["data"]
        await pg.wait_for_timeout(20)
    return seen
async def submit(pg, code):
    await pg.fill("#pass", code); await pg.press("#pass", "Enter")
results = []
def check(name, ok, info=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  ({info})" if info else ""))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        await ctx.route("https://fn.test/**", handle)
        pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(300)
        check("fresh visit shows the passcode screen", await pg.is_visible("#gateForm"))
        await submit(pg, "wrong1"); seen = await watch(pg, 1600)
        check("wrong passcode never shows the app", not seen["app"], str(seen))
        check("wrong passcode is not remembered", await pg.evaluate("localStorage.getItem('cc-inventory-passcode')") is None)
        check("wrong passcode shows an error", "didn't work" in (await pg.inner_text("body")))
        await submit(pg, GOOD); await pg.wait_for_timeout(1500)
        check("right passcode opens the app with data", "10½" in (await pg.inner_text("body")))
        await pg.reload(); seen = await watch(pg, 1200)
        check("after reload it remembers you (no passcode screen)", (await pg.query_selector("#gateForm")) is None and "10½" in (await pg.inner_text("body")))
        # sign out from Settings
        await pg.click(".bar-bottom [data-act=open-settings]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=signout]"); await pg.wait_for_timeout(300)
        check("sign out shows the passcode screen", await pg.is_visible("#gateForm"))
        check("sign out forgets the passcode", await pg.evaluate("localStorage.getItem('cc-inventory-passcode')") is None)
        await submit(pg, "wrong2"); seen = await watch(pg, 1600)
        check("after sign out, a wrong passcode never shows old counts", not seen["data"] and not seen["app"], str(seen))
        # same link in a different browser (fresh context, nothing stored)
        ctx2 = await b.new_context(viewport={"width": 390, "height": 844}); await ctx2.route("https://fn.test/**", handle)
        pg2 = await ctx2.new_page(); await pg2.goto(URL); seen = await watch(pg2, 800)
        check("pasting the link in another browser asks for the passcode", await pg2.is_visible("#gateForm") and not seen["app"], str(seen))
        # passcode changed on the server while one was remembered
        ctx3 = await b.new_context(viewport={"width": 390, "height": 844}); await ctx3.route("https://fn.test/**", handle)
        await ctx3.add_init_script("if (!sessionStorage.getItem('x')) { localStorage.setItem('cc-inventory-passcode','old-code'); sessionStorage.setItem('x','1'); }")
        pg3 = await ctx3.new_page(); await pg3.goto(URL); seen = await watch(pg3, 1600)
        check("an old remembered passcode never shows the app", not seen["app"], str(seen))
        check("an old remembered passcode lands on the passcode screen", await pg3.is_visible("#gateForm"))
        # too many tries
        await submit(pg3, LOCKED_IP_PASS); await pg3.wait_for_timeout(800)
        body = await pg3.inner_text("body")
        check("lockout shows a wait message", "Too many" in body, body[:120].replace("\n", " | "))
        check("no page errors", not errs, str(errs))
        await b.close()
    print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
asyncio.run(main())
