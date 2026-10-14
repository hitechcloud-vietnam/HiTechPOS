"""Smoke-test the downloaded standalone APK; no Metro or backend is started."""

from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

evidence = Path('smoke-evidence')
evidence.mkdir(exist_ok=True)


def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=30)


def screen(name, expected, scroll_search=False):
    for attempt in range(30):
        if not adb('shell', 'pidof', 'com.posnic.business').strip():
            raise RuntimeError('App exited before the expected screen appeared')
        adb('shell', 'uiautomator', 'dump', '/sdcard/business-ui.xml')
        xml = adb('shell', 'cat', '/sdcard/business-ui.xml')
        (evidence / f'{name}.xml').write_bytes(xml)
        root = ET.fromstring(xml)
        for node in root.iter('node'):
            label = node.get('text', '') + ' ' + node.get('content-desc', '')
            if expected.lower() in label.lower():
                (evidence / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
                return node
        if scroll_search and attempt in (3, 6, 9):
            (evidence / f'{name}-scroll-{attempt}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
            for node in root.iter('node'):
                if node.get('scrollable') == 'true' and node.get('package') == 'com.posnic.business':
                    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
                    center = str((x1 + x2) // 2)
                    adb('shell', 'input', 'swipe', center, str(y1 + (y2 - y1) * 4 // 5), center, str(y1 + (y2 - y1) // 5), '350')
                    break
        time.sleep(1)
    (evidence / f'{name}-failed.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    raise RuntimeError(f'{expected!r} did not appear on {name}')


def tap(node):
    coordinates = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
    if len(coordinates) != 4:
        raise RuntimeError('Control has no valid screen bounds')
    x1, y1, x2, y2 = coordinates
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


try:
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', 'com.posnic.business/.MainActivity')
    tap(screen('welcome', 'Explore sample business', scroll_search=True))
    screen('sample', 'Today')
    tap(screen('tabs', 'Insights'))
    tap(screen('insights', 'Masala dosa', scroll_search=True))
    screen('item', 'Previous')
    tap(screen('item-next', 'Next'))
    screen('next-item', 'Previous')
    adb('shell', 'input', 'keyevent', '3')
    adb('shell', 'am', 'start', '-W', '-n', 'com.posnic.business/.MainActivity')
    screen('resumed', 'Previous')
    print('Standalone install, welcome, dashboard, insights, item paging and resume passed.')
finally:
    (evidence / 'logcat.txt').write_bytes(adb('logcat', '-d'))
