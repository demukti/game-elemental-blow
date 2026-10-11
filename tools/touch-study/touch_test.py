"""Drive the touch prototype in Chromium with real multi-touch (CDP Input.dispatchTouchEvent).

    uv run --with playwright python tools/touch-study/touch_test.py [base_url] [shots_dir]

Needs the game served (PORT=5181 npm start). Emulates Pixel 7 / iPhone 13 landscape and an iPad and checks
the element circle: the stick moves; holding an element button switches to it and attacks (auto-aim held
still, by hand when dragged) while the circle steps back; nothing fires with the right thumb up; earth
slams once on a tap, and only on release after a drag; free space keeps the element; a flick on the left
dashes; DASH, BLOW and pause work; holding the hinted element clears wave 1. Saves screenshots.
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


def fired(page, el, seconds):
    """Highest cooldown fraction of `el` seen while polling for `seconds`: above 0 means it was cast."""
    top = 0.0
    t_end = time.time() + seconds
    while time.time() < t_end:
        top = max(top, page.evaluate(f"window.elementalBlow.state.player.cooldowns.{el}"))
        time.sleep(0.03)
    return round(top, 2)


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
    r["stickVisible"] = page.locator(".t-stick:not(.ghost):not(.t-aim)").is_visible()

    # 2. holding the water button switches, attacks and steps the circle back; the move stick keeps working
    wx, wy = center(page, ".t-pad[data-el=water]")
    f.down(2, wx, wy)
    time.sleep(0.15)
    r["holdWaterSwitches"] = st(page, "p.element") == "water"
    r["circleStepsBack"] = "holding" in (page.get_attribute(".t-diamond", "class") or "")
    r["aimStickShown"] = page.locator(".t-aim").is_visible()
    r["holdWaterFires"] = fired(page, "water", 0.6) > 0
    x1 = st(page, "p.x")
    time.sleep(0.3)
    r["moveStickStillWorks"] = st(page, "p.x") - x1 > 20
    page.screenshot(path=f"{SHOTS}/{name}-6-holding.png")
    f.up(2)
    time.sleep(0.1)
    r["circleBackAfterRelease"] = "holding" not in (page.get_attribute(".t-diamond", "class") or "")

    # 3. right thumb up: nothing fires (the last element stays)
    time.sleep(1.4)  # let the water cooldown run out
    r["noFireWhenUp"] = fired(page, "water", 0.6) == 0
    r["elementKeptAfterRelease"] = st(page, "p.element") == "water"

    # 3b. earth: a tap slams once; a drag slams only on release, in the dragged direction
    ex, ey = center(page, ".t-pad[data-el=earth]")
    f.down(3, ex, ey)
    time.sleep(0.06)
    f.up(3)
    r["earthTapSlams"] = fired(page, "earth", 0.3) > 0
    time.sleep(1.0)  # earth cooldown 0.85 s
    f.down(3, ex, ey)
    for k in range(1, 6):
        f.move(3, ex, ey - k * 9)
        time.sleep(0.03)
    r["earthHeldDoesNotSlam"] = fired(page, "earth", 0.5) == 0
    f.up(3)
    # read the facing in the frame the slam lands: auto-aim turns the player back right after
    cd, ang = page.evaluate("""new Promise((res) => {
      const t0 = performance.now();
      const tick = () => {
        const p = window.elementalBlow.state.player;
        if (p.cooldowns.earth > 0 || performance.now() - t0 > 400) res([p.cooldowns.earth, p.angle]);
        else requestAnimationFrame(tick);
      };
      tick();
    })""")
    r["earthReleaseSlams"] = cd > 0
    r["earthSlamAimedUp"] = -2.2 < ang < -0.9

    # 3c. fire button dragged up: aims by hand and attacks
    fx, fy = center(page, ".t-pad[data-el=fire]")
    f.down(3, fx, fy)
    for k in range(1, 6):
        f.move(3, fx, fy - k * 9)
        time.sleep(0.03)
    r["dragAimsByHand"] = -2.2 < st(page, "p.angle") < -0.9
    r["dragFires"] = fired(page, "fire", 0.5) > 0
    f.up(3)

    # 3d. free space on the right: aims and attacks with the element already held
    time.sleep(1.0)
    f.down(6, vw * 0.62, vh * 0.35)
    time.sleep(0.1)
    r["freeSpaceKeepsElement"] = st(page, "p.element") == "fire"
    r["freeSpaceFires"] = fired(page, "fire", 0.5) > 0
    f.up(6)
    f.up(1)

    # 3e. a quick flick on the left dashes that way
    time.sleep(1.2)
    f.down(1, sx, sy)
    for k in range(1, 3):
        f.move(1, sx + k * 40, sy)  # a quick flick: two moves, no pause
    f.up(1)
    time.sleep(0.15)
    # by direction, not distance: the player may already stand at the right wall
    r["flickDashes"] = st(page, "p.dashCd") > 0 and st(page, "p._dashX") > 0.8
    f.down(1, sx, sy)

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

    # 6. let enemies arrive: circle the move stick and hold the hinted element still (auto-aim)
    def past_upgrade():
        """The checks above can clear wave 1: pick the first card and play on."""
        if page.evaluate("window.elementalBlow.app") == "upgrade":
            r["upgradeScreens"] = r.get("upgradeScreens", 0) + 1
            if 8 in f.pts:
                f.up(8)
            time.sleep(0.7)
            page.tap(".card >> nth=0")
            time.sleep(0.3)

    def hold_hint(fid):
        """Press the button that beats the nearest enemy (the pulsing one), or fire; returns its element."""
        past_upgrade()
        el = page.evaluate("(document.querySelector('.t-pad.hint') || {}).dataset?.el || window.elementalBlow.state.player.element")
        if page.locator(f".t-pad[data-el={el}]").bounding_box() is None:
            raise RuntimeError(f"no {el} button: " + json.dumps(page.evaluate(
                "({ app: elementalBlow.app, hp: elementalBlow.state && elementalBlow.state.player.hp, layerHidden: document.getElementById('touch').hidden, vw: innerWidth, vh: innerHeight })")))
        bx, by = center(page, f".t-pad[data-el={el}]")
        f.down(fid, bx, by)
        return el

    past_upgrade()
    dealt0 = st(page, "s.stats.damageDealt")
    t_end = time.time() + fight_seconds
    f.down(1, sx, sy)
    k = 0
    shot_taken = False
    held = hold_hint(8)
    t_switch = time.time() + 1.5
    while time.time() < t_end:
        k += 1
        ang = k * 0.25
        f.move(1, sx + 40 * __import__("math").cos(ang), sy + 40 * __import__("math").sin(ang))
        time.sleep(0.05)
        if time.time() > t_switch:
            f.up(8)
            held = hold_hint(8)
            t_switch = time.time() + 1.5
        fighting = page.evaluate("window.elementalBlow.app") == "playing" and st(page, "s.enemies.length") >= 1
        if fighting and page.locator(".t-reticle").is_visible():
            r["reticleShown"] = True
        if not shot_taken and fighting and st(page, "s.enemies.length") >= 2 and time.time() > t_end - fight_seconds / 2:
            page.screenshot(path=f"{SHOTS}/{name}-2-fight.png")
            shot_taken = True
    r.setdefault("reticleShown", False)
    r["holdStillDamage"] = round(st(page, "s.stats.damageDealt") - dealt0)
    if not shot_taken:
        page.screenshot(path=f"{SHOTS}/{name}-2-fight.png")

    if clear_wave:
        t_end = time.time() + 60
        while time.time() < t_end and page.evaluate("window.elementalBlow.app") == "playing":
            k += 1
            ang = k * 0.2
            f.move(1, sx + 40 * __import__("math").cos(ang), sy + 40 * __import__("math").sin(ang))
            time.sleep(0.05)
            if time.time() > t_switch:
                f.up(8)
                held = hold_hint(8)
                t_switch = time.time() + 1.5
        r["fightEndedIn"] = page.evaluate("window.elementalBlow.app")
        r["waveReached"] = st(page, "s.wave")
        r["gameTime"] = round(st(page, "s.time"), 1)
        r["hpLeft"] = round(st(page, "p.hp"))
        if r["fightEndedIn"] == "upgrade":
            time.sleep(0.6)
            page.screenshot(path=f"{SHOTS}/{name}-4-upgrade.png")
            f.up(8)
            page.tap(".card >> nth=0")
            time.sleep(0.4)
            r["upgradeTapResumes"] = page.evaluate("window.elementalBlow.app") == "playing"
    if 8 in f.pts:
        f.up(8)
    f.up(1)

    # 8. pause button, then Resume by tap
    past_upgrade()
    if page.evaluate("window.elementalBlow.app") != "playing":
        r["pauseSkipped"] = page.evaluate("window.elementalBlow.app")
        r["errors"] = errors[:5]
        report.append(r)
        browser.close()
        return
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
