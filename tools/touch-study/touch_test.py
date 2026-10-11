"""Drive the touch prototype in Chromium with real multi-touch (CDP Input.dispatchTouchEvent).

    uv run --with playwright python tools/touch-study/touch_test.py [base_url] [shots_dir]

Needs the game served (PORT=5181 npm start). Emulates Pixel 7 / iPhone 13 landscape and an iPad, checks
that the stick moves, pads switch (tap and slide), DASH dashes, BLOW fires the nova, pause works, the
right-side drag aims by hand, auto-fire clears wave 1, and saves screenshots.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5181/"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/Users/mkt/.claude/jobs/3c010f2e/tmp/touch/shots"

LOG_JS = """
window.__tlog = [];
for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
  window.addEventListener(t, (e) => window.__tlog.push(t + ':' + e.touches.length), { capture: true, passive: true });
"""


class Fingers:
    """Tracks active touch points and sends the full set on every CDP touch event."""

    def __init__(self, cdp):
        self.cdp = cdp
        self.pts = {}

    def _send(self, typ):
        pts = [{"x": x, "y": y, "id": i, "radiusX": 6, "radiusY": 6, "force": 1} for i, (x, y) in self.pts.items()]
        self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": pts})

    def down(self, fid, x, y):
        self.pts[fid] = (x, y)
        self._send("touchStart")

    def move(self, fid, x, y):
        self.pts[fid] = (x, y)
        self._send("touchMove")

    def up(self, fid):
        x, y = self.pts.pop(fid)
        # CDP touchEnd lists the finger(s) being lifted (probe_cdp.py); the others stay down
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": x, "y": y, "id": fid}]})


def center(page, sel):
    b = page.locator(sel).bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def st(page, expr):
    return page.evaluate(f"(() => {{ const s = window.elementalBlow.state; const p = s && s.player; return {expr}; }})()")


def run_device(pw, name, desc, report, fight_seconds=8, clear_wave=False):
    browser = pw.chromium.launch()
    ctx = browser.new_context(**desc)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.add_init_script(LOG_JS)
    page.goto(BASE + "?seed=7")
    page.wait_for_function("window.elementalBlow && window.elementalBlow.app === 'menu'")
    time.sleep(0.6)
    vw, vh = desc["viewport"]["width"], desc["viewport"]["height"]
    r = {"device": name, "viewport": f"{vw}x{vh}", "touchClass": page.evaluate("document.documentElement.classList.contains('touch')")}
    page.screenshot(path=f"{SHOTS}/{name}-1-menu.png")
    page.tap(".overlay.menu .btn.primary.big")
    page.wait_for_function("window.elementalBlow.app === 'playing'")
    time.sleep(0.3)
    r["layerVisible"] = page.locator("#touch").is_visible()
    cdp = ctx.new_cdp_session(page)
    f = Fingers(cdp)

    # geometry: how much of the arena the controls cover
    geo = page.evaluate("""() => {
      const W = innerWidth, H = innerHeight, sc = Math.min(W / 1600, H / 900);
      const ar = { x: (W - 1600 * sc) / 2, y: (H - 900 * sc) / 2, w: 1600 * sc, h: 900 * sc };
      const out = { arena: ar, boxes: {} };
      let covered = 0;
      for (const sel of ['.t-diamond', '.t-dash', '.t-nova', '.t-pause', '.t-stick.ghost', '.hud-tl', '.hud-tr', '.hud-tc']) {
        const el = document.querySelector(sel); if (!el) continue;
        const b = el.getBoundingClientRect();
        const ix = Math.max(0, Math.min(b.right, ar.x + ar.w) - Math.max(b.left, ar.x));
        const iy = Math.max(0, Math.min(b.bottom, ar.y + ar.h) - Math.max(b.top, ar.y));
        out.boxes[sel] = { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), inArenaPct: +(100 * ix * iy / (ar.w * ar.h)).toFixed(1) };
      }
      const pad = document.querySelector('.t-pad').getBoundingClientRect();
      out.padPx = Math.round(pad.width);
      out.hudFontPx = parseFloat(getComputedStyle(document.querySelector('#ui')).fontSize);
      out.smallestHudText = Math.min(...[...document.querySelectorAll('.hud *')].filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize)));
      return out;
    }""")
    r["padPx"] = geo["padPx"]
    r["hudFontPx"] = geo["hudFontPx"]
    r["smallestHudTextPx"] = geo["smallestHudText"]
    r["controlsInArenaPct"] = round(sum(v["inArenaPct"] for k, v in geo["boxes"].items() if k.startswith(".t-")), 1)
    r["hudInArenaPct"] = round(sum(v["inArenaPct"] for k, v in geo["boxes"].items() if k.startswith(".hud")), 1)
    r["arena"] = f'{round(geo["arena"]["w"])}x{round(geo["arena"]["h"])}'

    # 1. stick: hold right for 0.8 s
    x0 = st(page, "p.x")
    sx, sy = vw * 0.18, vh * 0.72
    f.down(1, sx, sy)
    for i in range(1, 6):
        f.move(1, sx + i * 10, sy)
        time.sleep(0.02)
    time.sleep(0.8)
    r["stickMovesRight"] = st(page, "p.x") - x0 > 60
    r["stickVisible"] = page.locator(".t-stick:not(.ghost)").is_visible()

    # 2. second finger taps the water pad while the stick is held
    wx, wy = center(page, ".t-pad[data-el=water]")
    f.down(2, wx, wy)
    time.sleep(0.1)
    f.up(2)
    time.sleep(0.1)
    r["tapWater"] = st(page, "p.element") == "water"
    x1 = st(page, "p.x")
    time.sleep(0.3)
    r["stickStillHeldAfterTap"] = st(page, "p.x") - x1 > 20

    # 3. slide from the water pad to fire, then to air
    fx, fy = center(page, ".t-pad[data-el=fire]")
    ax, ay = center(page, ".t-pad[data-el=air]")
    f.down(3, wx, wy)
    for k in range(1, 7):
        f.move(3, wx + (fx - wx) * k / 6, wy + (fy - wy) * k / 6)
        time.sleep(0.02)
    time.sleep(0.08)
    r["slideToFire"] = st(page, "p.element") == "fire"
    for k in range(1, 7):
        f.move(3, fx + (ax - fx) * k / 6, fy + (ay - fy) * k / 6)
        time.sleep(0.02)
    time.sleep(0.08)
    r["slideToAir"] = st(page, "p.element") == "air"
    f.up(3)

    # 4. dash
    time.sleep(1.2)  # dash cooldown from nothing; be safe
    dx, dy = center(page, ".t-dash")
    f.down(4, dx, dy)
    time.sleep(0.05)
    f.up(4)
    time.sleep(0.1)
    r["dash"] = st(page, "p.dashCd") > 0

    # 5. nova
    page.evaluate("window.elementalBlow.state.player.blow = 100")
    time.sleep(0.1)
    used0 = st(page, "s.stats.blowsUsed")
    nx, ny = center(page, ".t-nova")
    r["novaReadyClass"] = "ready" in (page.get_attribute(".t-nova", "class") or "")
    f.down(5, nx, ny)
    time.sleep(0.05)
    f.up(5)
    time.sleep(0.1)
    r["nova"] = st(page, "s.stats.blowsUsed") == used0 + 1
    f.up(1)

    # 5b. player under the right-hand controls: they fade but keep working
    page.evaluate("Object.assign(window.elementalBlow.state.player, { x: 1520, y: 820, vx: 0, vy: 0 })")
    time.sleep(0.15)
    r["controlsFadeOverPlayer"] = page.evaluate("[...document.querySelectorAll('.t-diamond, .t-dash, .t-nova')].some(e => e.classList.contains('faded'))")
    page.screenshot(path=f"{SHOTS}/{name}-5-faded.png")
    page.evaluate("Object.assign(window.elementalBlow.state.player, { x: 800, y: 450 })")
    time.sleep(0.15)

    # 6. let enemies arrive; auto-fire / auto-aim with the stick circling
    t_end = time.time() + fight_seconds
    f.down(1, sx, sy)
    k = 0
    shot_taken = False
    while time.time() < t_end:
        k += 1
        ang = k * 0.25
        f.move(1, sx + 40 * __import__("math").cos(ang), sy + 40 * __import__("math").sin(ang))
        time.sleep(0.05)
        if not shot_taken and st(page, "s.enemies.length") >= 2 and time.time() > t_end - fight_seconds / 2:
            page.screenshot(path=f"{SHOTS}/{name}-2-fight.png")
            shot_taken = True
    r["autoFireDamage"] = round(st(page, "s.stats.damageDealt"))
    r["reticleShown"] = page.locator(".t-reticle").is_visible()
    if not shot_taken:
        page.screenshot(path=f"{SHOTS}/{name}-2-fight.png")

    # 7. manual aim: drag on free space in the right half, upward
    mx, my = vw * 0.62, vh * 0.35
    f.down(6, mx, my)
    for i in range(1, 6):
        f.move(6, mx, my - i * 8)
        time.sleep(0.03)
    time.sleep(0.15)
    ang = st(page, "p.angle")
    r["manualAimUp"] = -2.2 < ang < -0.9  # roughly straight up (-pi/2)
    f.up(6)

    if clear_wave:
        t_end = time.time() + 60
        while time.time() < t_end and page.evaluate("window.elementalBlow.app") == "playing":
            k += 1
            ang = k * 0.2
            f.move(1, sx + 40 * __import__("math").cos(ang), sy + 40 * __import__("math").sin(ang))
            time.sleep(0.05)
        r["wave1ClearedBy"] = page.evaluate("window.elementalBlow.app")
        r["wave1Time"] = round(st(page, "s.time"), 1)
        r["hpLeft"] = round(st(page, "p.hp"))
        if r["wave1ClearedBy"] == "upgrade":
            time.sleep(0.6)
            page.screenshot(path=f"{SHOTS}/{name}-4-upgrade.png")
            page.tap(".card >> nth=0")
            time.sleep(0.4)
            r["upgradeTapResumes"] = page.evaluate("window.elementalBlow.app") == "playing"
    f.up(1)

    # 8. pause button, then Resume by tap
    px, py = center(page, ".t-pause")
    f.down(7, px, py)
    time.sleep(0.05)
    f.up(7)
    time.sleep(0.2)
    r["pauseButton"] = page.evaluate("window.elementalBlow.app") == "paused"
    page.screenshot(path=f"{SHOTS}/{name}-3-pause.png")
    page.tap(".overlay.pause .btn.primary")
    time.sleep(0.2)
    r["resumeTap"] = page.evaluate("window.elementalBlow.app") == "playing"
    r["touchEventsSeen"] = page.evaluate("window.__tlog.length")
    r["errors"] = errors[:5]
    report.append(r)
    browser.close()


def run_portrait(pw, desc, report):
    browser = pw.chromium.launch()
    ctx = browser.new_context(**desc)
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_function("window.elementalBlow && window.elementalBlow.app === 'menu'")
    time.sleep(0.5)
    page.screenshot(path=f"{SHOTS}/iphone13-portrait-rotate.png")
    report.append({"device": "iPhone 13 portrait", "rotateNoticeVisible": page.locator(".t-rotate").is_visible()})
    browser.close()


def run_before(pw, desc, report):
    """The game today on a phone (touch layer off): what a friend sees after tapping PLAY."""
    browser = pw.chromium.launch()
    ctx = browser.new_context(**desc)
    page = ctx.new_page()
    page.goto(BASE + "?seed=7&touch=0")
    page.wait_for_function("window.elementalBlow && window.elementalBlow.app === 'menu'")
    page.tap(".overlay.menu .btn.primary.big")
    time.sleep(7)
    page.screenshot(path=f"{SHOTS}/pixel7-before-no-touch.png")
    report.append({"device": "Pixel 7 landscape, touch=0", "hpAfter7s": page.evaluate("Math.round(window.elementalBlow.state.player.hp)")})
    browser.close()


def main():
    report = []
    with sync_playwright() as pw:
        d = pw.devices
        run_device(pw, "pixel7", d["Pixel 7 landscape"], report, clear_wave=True)
        run_device(pw, "iphone13", d["iPhone 13 landscape"], report)
        run_device(pw, "ipad", d["iPad (gen 7) landscape"], report)
        run_portrait(pw, d["iPhone 13"], report)
        run_before(pw, d["Pixel 7 landscape"], report)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
