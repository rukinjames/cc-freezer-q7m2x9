import sys, json, os
D = '/home/claude/creamery/app'
r = lambda f: open(os.path.join(D, f)).read()
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Unbounded:wght@500;600&display=swap">'
css, html, eng, ui = r('ui.css'), r('ui.html'), r('engine.js'), r('ui.js')
# artifact build
art = f"<title>Campus Creamery Inventory</title>\n{FONTS}\n<style>\n{css}\n</style>\n{html}\n<script>\n{eng}\n{r('adapter.artifact.js')}\n{ui}\n</script>\n"
open(os.path.join(D, 'Campus-Creamery-Inventory.html'), 'w').write(art)
# web build
fn = sys.argv[1] if len(sys.argv) > 1 else "__FUNCTION_URL__"
web_adapter = r('adapter.web.js').replace('"__FUNCTION_URL__"', json.dumps(fn))
os.makedirs(os.path.join(D, 'site'), exist_ok=True)
head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Creamery">
<meta name="theme-color" content="#f4f3f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#110e1d" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-192.png">
<title>Campus Creamery Inventory</title>
{FONTS}
<style>
{css}
body {{ padding-top: env(safe-area-inset-top, 0px); }}
</style>
</head>
<body>
"""
# On the website the app markup ships inside a <template>, so it is never on screen
# until the passcode has been accepted. #root starts empty.
OPEN = '<div id="root">'
s = html.index(OPEN) + len(OPEN); e = html.index('<div id="sheetRoot">')
inner = html[s:e].rstrip()
assert inner.endswith('</div>'), "ui.html: #root must close right before #sheetRoot"
web_html = f'<template id="shellTpl">{inner[:-len("</div>")]}</template>\n<div id="root"></div>\n' + html[e:]
web = head + web_html + f"\n<script>\n{eng}\n{web_adapter}\n{ui}\n</script>\n</body>\n</html>\n"
open(os.path.join(D, 'site', 'index.html'), 'w').write(web)
json.dump({"name": "Campus Creamery Inventory", "short_name": "Creamery", "start_url": "./", "scope": "./", "display": "standalone",
           "background_color": "#f4f3f8", "theme_color": "#5a34d0",
           "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
                     {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]},
          open(os.path.join(D, 'site', 'manifest.webmanifest'), 'w'), indent=1)
print("built", len(art), len(web), "fn:", fn)
