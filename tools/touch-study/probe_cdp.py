"""Probe: how does CDP Input.dispatchTouchEvent release one of two fingers?"""
from playwright.sync_api import sync_playwright

HTML = """<html><body style="height:100vh;touch-action:none"><script>
window.log = [];
for (const t of ['touchstart','touchmove','touchend','touchcancel'])
  document.addEventListener(t, e => log.push(t + ' changed=' + [...e.changedTouches].map(x => x.identifier) + ' touches=' + e.touches.length), {passive:false});
</script></body></html>"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(**pw.devices["Pixel 7 landscape"])
    page = ctx.new_page()
    page.set_content(HTML)
    cdp = ctx.new_cdp_session(page)
    A = {"x": 100, "y": 200, "id": 1}
    B = {"x": 600, "y": 200, "id": 2}
    for variant, release in [("touchEnd with released B", {"type": "touchEnd", "touchPoints": [B]}),
                             ("touchMove with remaining", {"type": "touchMove", "touchPoints": [A]})]:
        page.evaluate("log.length = 0")
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [A]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [A, B]})
        cdp.send("Input.dispatchTouchEvent", release)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{**A, "x": 120}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        print(variant, page.evaluate("log"))
    b.close()
