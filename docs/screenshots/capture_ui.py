"""Capture Skill Manager window screenshots for README."""

from __future__ import annotations

import sys
import time
from pathlib import Path

from PIL import ImageGrab
from pywinauto import Application
from pywinauto.findwindows import ElementNotFoundError

OUT = Path(__file__).resolve().parent
# Prefer exact button names as exposed by WebView2 accessibility.
VIEWS = [
    ("Skill 库", "01-library.png"),
    ("已安装", "02-installed.png"),
    ("安装", "03-installations.png"),
    ("项目", "04-projects.png"),
    ("备份记录", "05-backups.png"),
    ("设置", "06-settings.png"),
]


def capture_hwnd(hwnd: int, dest: Path) -> None:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    bbox = (rect.left + 8, rect.top + 1, rect.right - 8, rect.bottom - 8)
    image = ImageGrab.grab(bbox=bbox, all_screens=True)
    image.save(dest)
    print(f"saved {dest.name} ({image.size[0]}x{image.size[1]})")


def button_names(wrapper) -> list[str]:
    names: list[str] = []
    for desc in wrapper.descendants(control_type="Button"):
        name = (desc.window_text() or "").strip()
        if name:
            names.append(name)
    return names


def click_nav(wrapper, label: str) -> bool:
    """Click sidebar nav. Exact label match; for 安装 avoid 已安装."""
    candidates = []
    for desc in wrapper.descendants(control_type="Button"):
        name = (desc.window_text() or "").strip()
        if not name:
            continue
        # WebView often concatenates label + count: "安装0" / "已安装1"
        if name == label or name.startswith(label):
            if label == "安装" and name.startswith("已安装"):
                continue
            # Prefer shorter / closer matches
            score = 0 if name == label else len(name)
            candidates.append((score, name, desc))
    if not candidates:
        return False
    candidates.sort(key=lambda item: item[0])
    _score, name, desc = candidates[0]
    print(f"  click button: {name!r}")
    desc.click_input()
    return True


def main() -> int:
    try:
        app = Application(backend="uia").connect(title="Skill Manager", timeout=20)
    except ElementNotFoundError:
        print("Skill Manager window not found", file=sys.stderr)
        return 1

    win = app.window(title="Skill Manager")
    win.set_focus()
    time.sleep(0.5)
    hwnd = win.handle

    names = button_names(win)
    print("buttons:", names)

    for label, filename in VIEWS:
        print(f"navigating -> {label}")
        if not click_nav(win, label):
            print(f"WARN: could not click {label}", file=sys.stderr)
        time.sleep(1.0)
        capture_hwnd(hwnd, OUT / filename)

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
