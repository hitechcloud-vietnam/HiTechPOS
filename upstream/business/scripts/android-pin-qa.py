"""Actual AccountScreen + SecureStore + Hermes in an isolated QA application."""
import os, re, subprocess, time, json
from pathlib import Path
import xml.etree.ElementTree as ET

app = 'com.posnic.business.pinqa'
pin = os.environ.get('QA_PIN', '826493')
evidence = Path('pin-evidence') / (str(len(pin)) + '-digit'); evidence.mkdir(parents=True,exist_ok=True)
timings = {}
def adb(*args): return subprocess.check_output(['adb', *args], timeout=30)
def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/pin-ui.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/pin-ui.xml'))
def find(text, timeout=35):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        root = tree()
        for n in root.iter('node'):
            if text in (n.get('text','') + ' ' + n.get('content-desc','')): return n
        time.sleep(.3)
    (evidence / 'failed.xml').write_bytes(ET.tostring(root))
    raise AssertionError('Did not reach: '+text)
def tap(n):
    a,b,c,d = map(int,re.findall(r'\d+',n.get('bounds','')))
    adb('shell','input','tap',str((a+c)//2),str((b+d)//2))
def enter(value, confirm=False):
    inputs = [n for n in tree().iter('node') if n.get('class') == 'android.widget.EditText']
    tap(inputs[1 if confirm else 0]); adb('shell','input','text',value)
    adb('shell','input','keyevent','111')
def capture(name): (evidence / (name+'.png')).write_bytes(adb('exec-out','screencap','-p'))
def launch(): adb('shell','am','start','-W','-n',app+'/.MainActivity')
try:
    adb('shell','pm','clear',app); adb('logcat','-c'); launch(); find('Create your app PIN'); capture('setup')
    enter(pin); enter(pin,True)
    started=time.monotonic(); tap(find('Save PIN and continue')); find('PIN test business')
    timings['save_seconds']=round(time.monotonic()-started,2); capture('saved')
    assert timings['save_seconds'] < 12, 'Saving PIN exceeds 12s including UI inspection'
    adb('shell','am','force-stop',app); launch(); find('Welcome back'); capture('restart-locked')
    enter(pin); started=time.monotonic(); tap(find('Unlock')); find('PIN test business')
    timings['unlock_seconds']=round(time.monotonic()-started,2); capture('unlocked')
    assert timings['unlock_seconds'] < 12, 'Unlock exceeds 12s including UI inspection'
    adb('shell','input','keyevent','3'); launch(); find('Welcome back'); capture('background-locked')
    for attempt in range(5):
        enter('0000' if len(pin)==4 else '000000'); tap(find('Unlock'))
        find('Please sign in again to continue.' if attempt==4 else 'Incorrect PIN.')
        adb('shell','am','force-stop',app); launch(); find('Welcome back')
    enter(pin); tap(find('Unlock')); find('Please sign in again to continue.'); capture('locked-out')
    print('PASS native PIN lifecycle',timings)
finally:
    (evidence/'timings.json').write_text(json.dumps(timings))
    capture('final')
    (evidence/'logcat.txt').write_bytes(adb('logcat','-d','-t','500'))
    timings_log = adb('logcat','-d','ReactNativeJS:I','*:S')
    (evidence/'pin-timings.log').write_bytes(timings_log)
    print(timings_log.decode(errors='replace'))
