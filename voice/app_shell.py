"""Lin as a Windows app: her own window, a tray icon, the Ctrl+Space quick bar, a floating emblem, notifications when
she needs you, and "Start with Windows". A thin shell around the same local server and pages as the browser version,
so it can be swapped for a Tauri build later without touching Lin herself.

Run with pythonw (no console): .venv-voice\\Scripts\\pythonw.exe voice\\app_shell.py   (the Lin shortcut does this)
  --background   start in the tray (used by Start with Windows)
  --make-icon    write voice/ui/lin.ico (used by the installer)
Needs pywebview and pystray (design/Install-LinApp.cmd). Everything stays on this PC; the windows only open 127.0.0.1."""
from pathlib import Path
import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RUNTIME = HERE / 'runtime'
SESSION = RUNTIME / 'session.json'
LOG = RUNTIME / 'app-shell.log'
APP_ID = 'Lin'
RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, VK_SPACE, WM_HOTKEY = 0x1, 0x2, 0x4000, 0x20, 0x0312
HOTKEYS = [(MOD_CONTROL, VK_SPACE, 'Ctrl+Space'), (MOD_CONTROL | MOD_ALT, VK_SPACE, 'Ctrl+Alt+Space')]


def log(message):
    try:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        with LOG.open('a', encoding='utf-8') as f:
            f.write(time.strftime('%H:%M:%S ') + message + '\n')
    except OSError:
        pass


# ---- Lin's server --------------------------------------------------------
def session():
    try:
        data = json.loads(SESSION.read_text(encoding='utf-8'))
        url = data['url']
    except (OSError, ValueError, KeyError):
        return None
    if not url.startswith('http://127.0.0.1:'):
        return None   # only ever open Lin's own local address
    base, _, token = url.partition('/#token=')
    return {'url': url, 'base': base, 'token': token, 'pid': data.get('pid')}


def call(s, path, body=None, timeout=4):
    req = urllib.request.Request(s['base'] + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={'X-Lin-Token': s['token'], 'Content-Type': 'application/json'},
                                 method='GET' if body is None else 'POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def start_lin():
    """Start Lin (or reuse the running one) with the same script as Open Lin.cmd, without a browser."""
    flags = 0x08000000 if os.name == 'nt' else 0   # CREATE_NO_WINDOW
    # No pipes: Lin's server inherits the script's handles and lives on, so waiting for captured output would never end.
    try:
        subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / 'Start-LinVoice.ps1'), '-NoBrowser'],
                       cwd=ROOT, creationflags=flags, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       close_fds=True, timeout=180)
    except subprocess.TimeoutExpired:
        log('the start script is still running; waiting for Lin anyway')
    for _ in range(240):
        s = session()
        if s:
            try:
                call(s, '/api/status', timeout=2)
            except OSError:
                time.sleep(0.5)
                continue
            if not has_app_pages(s):
                # A Lin started from older code (before the app existed) is still running: restart it once.
                log('the running Lin is older than the app; restarting it')
                try:
                    call(s, '/api/shutdown', {}, timeout=5)
                except OSError:
                    pass
                time.sleep(3)
                return start_lin()
            return s
        time.sleep(0.5)
    raise RuntimeError('Lin did not start. See voice/runtime/server-error.log.')


def has_app_pages(s):
    try:
        with urllib.request.urlopen(s['base'] + '/shell.js', timeout=3) as r:
            return r.status == 200
    except OSError:
        return False


# ---- Windows helpers -----------------------------------------------------
def single_instance():
    """True for the first Lin app; a second launch asks the first to show its window and exits."""
    k32 = ctypes.windll.kernel32
    single_instance.mutex = k32.CreateMutexW(None, False, 'Local\\LinAppShell')
    if k32.GetLastError() == 183:   # ERROR_ALREADY_EXISTS
        event = k32.OpenEventW(0x0002, False, 'Local\\LinAppShellShow')   # EVENT_MODIFY_STATE
        if event:
            k32.SetEvent(event)
        return False
    single_instance.event = k32.CreateEventW(None, False, False, 'Local\\LinAppShellShow')
    return True


def wait_for_show(callback):
    k32 = ctypes.windll.kernel32
    while True:
        if k32.WaitForSingleObject(single_instance.event, 0xFFFFFFFF) == 0:
            callback()


def hotkey_loop(callback, report):
    """Ctrl+Space (or Ctrl+Alt+Space when Ctrl+Space is taken, e.g. by a keyboard-language switch)."""
    from ctypes import wintypes
    u32 = ctypes.windll.user32
    for mods, vk, name in HOTKEYS:
        if u32.RegisterHotKey(None, 1, mods | MOD_NOREPEAT, vk):
            report(name)
            break
    else:
        report(None)
        return
    msg = wintypes.MSG()
    while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        if msg.message == WM_HOTKEY:
            callback()


def startup_command():
    pythonw = Path(sys.executable).with_name('pythonw.exe')
    return f'"{pythonw if pythonw.is_file() else sys.executable}" "{Path(__file__).resolve()}" --background'


def starts_with_windows():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            return winreg.QueryValueEx(k, APP_ID)[0] == startup_command()
    except OSError:
        return False


def set_start_with_windows(on):
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, APP_ID, 0, winreg.REG_SZ, startup_command())
        else:
            try:
                winreg.DeleteValue(k, APP_ID)
            except OSError:
                pass


def icon_image(size=64):
    """Lin's emblem, drawn: a dashed ring, an orbit and the core."""
    from PIL import Image, ImageDraw
    k = size / 64
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cyan = (79, 243, 255, 255)
    d.ellipse([4 * k, 4 * k, 60 * k, 60 * k], fill=(10, 16, 24, 235))
    for a in range(0, 360, 30):
        d.arc([7 * k, 7 * k, 57 * k, 57 * k], a, a + 21, fill=cyan, width=max(1, round(3 * k)))
    d.ellipse([22 * k, 22 * k, 42 * k, 42 * k], fill=cyan)
    d.ellipse([28 * k, 28 * k, 36 * k, 36 * k], fill=(10, 16, 24, 255))
    return img


def make_icon():
    path = HERE / 'ui' / 'lin.ico'
    icon_image(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(path)


# ---- The app ------------------------------------------------------------
class Api:
    """What the pages can ask of the app (window.pywebview.api)."""
    def __init__(self, app):
        self._app = app

    def open_main(self):
        self._app.show_main()

    def hide_quick(self):
        self._app.hide_quick()


class App:
    def __init__(self, background):
        self.background = background
        self.lin = None
        self.main = self.quick = self.orb = None
        self.main_visible = not background
        self.quick_visible = self.orb_visible = False
        self.quitting = False
        self.tray = None
        self.hotkey = None
        self.pending = None

    # windows
    def show_main(self):
        self.main.show(); self.main.restore(); self.main_visible = True
        self.hide_quick()

    def hide_main(self):
        self.main.hide(); self.main_visible = False

    def make_window(self, kind):
        import webview
        base, token = self.lin['base'], self.lin['token']
        if kind == 'quick':
            w = webview.create_window('Lin · quick bar', f'{base}/?view=quick#token={token}', width=760, height=380,
                                      frameless=True, on_top=True, js_api=self.api, easy_drag=False)
        else:
            w = webview.create_window('Lin · emblem', f'{base}/?view=orb#token={token}', width=132, height=132,
                                      frameless=True, on_top=True, js_api=self.api, background_color='#0A1018')
        w.events.loaded += (lambda *_: self.allow_microphone(w))
        return w

    def toggle_quick(self):
        if self.quick_visible:
            self.hide_quick()
            return
        if not self.quick:
            self.quick = self.make_window('quick')   # opens itself
        else:
            self.quick.show()
        self.quick_visible = True
        try:
            self.quick.evaluate_js('window.linFocusAsk && window.linFocusAsk()')
        except Exception:
            pass

    def hide_quick(self):
        if self.quick and self.quick_visible:
            self.quick.hide(); self.quick_visible = False

    def toggle_orb(self, *_):
        if self.orb_visible:
            self.orb.hide()
        elif not self.orb:
            self.orb = self.make_window('orb')
        else:
            self.orb.show()
        self.orb_visible = not self.orb_visible

    def on_main_closing(self):
        if self.quitting:
            return True
        # Closing the window keeps Lin in the tray (Quit Lin is in the tray menu). This handler runs on the window's own
        # thread, so the hiding happens just after it returns.
        threading.Thread(target=self.hide_main, daemon=True).start()
        if self.tray and not getattr(self, 'told_tray', False):
            self.told_tray = True
            self.notify('Lin is still here, in the tray. Press ' + (self.hotkey or 'the tray icon') + ' to talk to her.')
        return False

    def notify(self, text):
        try:
            self.tray.notify(text, 'Lin')
        except Exception as exc:
            log(f'notify failed: {exc!r}')

    def quit(self, *_):
        self.quitting = True
        try:
            call(self.lin, '/api/shutdown', {}, timeout=5)
        except OSError:
            pass
        try:
            self.tray.stop()
        except Exception:
            pass
        for w in (self.quick, self.orb, self.main):
            try:
                w.destroy()
            except Exception:
                pass

    # microphone: the app window asks WebView2 for the microphone like a browser tab would; allow it for Lin's own page only
    def allow_microphone(self, window):
        if getattr(window, '_lin_mic', None):
            return
        try:
            from System import Action
            from Microsoft.Web.WebView2.Core import CoreWebView2PermissionKind, CoreWebView2PermissionState
            form = window.native
            if not hasattr(form, 'webview'):
                raise RuntimeError('this window has no WebView2 control')
            def handler(sender, args):
                if args.PermissionKind == CoreWebView2PermissionKind.Microphone and str(args.Uri).startswith(self.lin['base']):
                    args.State = CoreWebView2PermissionState.Allow
            def attach():
                form.webview.CoreWebView2.PermissionRequested += handler
            form.Invoke(Action(attach))   # CoreWebView2 can only be touched from the window's own thread
            window._lin_mic = handler
            log('microphone allowed for Lin\'s page')
        except Exception as exc:
            log(f'microphone handler not set ({exc!r}); the page will ask instead')

    # tray
    def build_tray(self):
        import pystray
        item = pystray.MenuItem
        menu = pystray.Menu(
            item('Open Lin', lambda *_: self.show_main(), default=True),
            item(lambda _: f'Quick bar ({self.hotkey})' if self.hotkey else 'Quick bar', lambda *_: self.toggle_quick()),
            item('Floating emblem', self.toggle_orb, checked=lambda _: self.orb_visible),
            item('Start with Windows', lambda *_: set_start_with_windows(not starts_with_windows()), checked=lambda _: starts_with_windows()),
            pystray.Menu.SEPARATOR,
            item('Quit Lin', self.quit))
        self.tray = pystray.Icon('Lin', icon_image(64), 'Lin', menu)
        threading.Thread(target=self.tray.run, daemon=True).start()

    # "Lin needs you": an approval card is waiting and her window is not on screen
    def watch(self):
        while not self.quitting:
            time.sleep(4)
            try:
                waiting = sum(1 for a in call(self.lin, '/api/actions')['actions'] if a['state'] == 'proposed')
            except Exception:
                continue
            if self.pending is not None and waiting > self.pending and not self.main_visible and not self.quick_visible:
                # (the quick bar shows approval cards too)
                self.notify('Lin is waiting for your approval. Open Lin to review it.')
            self.pending = waiting

    def run(self):
        import webview
        log('starting')
        self.lin = start_lin()
        log(f"Lin is running at {self.lin['base']}")
        self.api = Api(self)
        self.main = webview.create_window('Lin', self.lin['url'], width=1320, height=860, min_size=(760, 560),
                                          hidden=self.background, js_api=self.api, background_color='#0A1018')
        self.main.events.closing += self.on_main_closing
        self.main.events.loaded += (lambda *_: self.allow_microphone(self.main))
        self.build_tray()
        def got_hotkey(name):
            self.hotkey = name
            log(f'hotkey: {name or "none (both Ctrl+Space and Ctrl+Alt+Space are taken)"}')
        threading.Thread(target=hotkey_loop, args=(self.toggle_quick, got_hotkey), daemon=True).start()
        threading.Thread(target=wait_for_show, args=(self.show_main,), daemon=True).start()
        threading.Thread(target=self.watch, daemon=True).start()
        log('opening the window')
        webview.start(private_mode=False, storage_path=str(RUNTIME / 'webview'))
        log('closed')


def main():
    if '--make-icon' in sys.argv:
        make_icon()
        return
    if os.name != 'nt':
        raise SystemExit('The Lin app runs on Windows.')
    if not single_instance():
        return
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('Lin.Assistant')
    try:
        App('--background' in sys.argv).run()
    except Exception as exc:
        log(f'stopped: {exc!r}')
        ctypes.windll.user32.MessageBoxW(None, f'Lin could not start: {exc}', 'Lin', 0x10)


if __name__ == '__main__':
    main()
