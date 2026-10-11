"""Print the Playwright descriptors used by the touch tests."""
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    for name in ["Pixel 7", "Pixel 7 landscape", "iPhone 13", "iPhone 13 landscape", "iPad (gen 7)", "iPad (gen 7) landscape", "iPad Pro 11 landscape"]:
        d = pw.devices.get(name)
        if d:
            print(name, d["viewport"], d.get("screen"), d["device_scale_factor"], d["is_mobile"], d["has_touch"])
        else:
            print(name, "missing")
