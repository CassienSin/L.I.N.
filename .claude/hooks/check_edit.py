"""Claude Code hook for Lin. pre: block edits to private or installed folders. post: syntax-check the edited file.
Reads the hook JSON from stdin. Exit 2 = tell Claude what is wrong (stderr)."""
import json
import os
import py_compile
import shutil
import subprocess
import sys
from pathlib import Path

PROTECTED = ('voice/data/', 'voice/models/', 'voice/runtime/', 'voice/demo/', 'tools/', '.venv-voice/', 'lin brain/')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'post'
    event = json.load(sys.stdin)
    path = (event.get('tool_input') or {}).get('file_path') or ''
    if not path:
        return 0
    root = Path(os.environ.get('CLAUDE_PROJECT_DIR') or event.get('cwd') or '.').resolve()
    try:
        rel = Path(path).resolve().relative_to(root).as_posix().lower() + ('/' if Path(path).is_dir() else '')
    except ValueError:
        return 0
    if mode == 'pre':
        if any(rel.startswith(p) for p in PROTECTED):
            print(f'Blocked: {rel} is private data or an installed program (memories, sign-in tokens, models, notes). '
                  'Change it through Lin, or ask the user to do it.', file=sys.stderr)
            return 2
        return 0
    file = Path(path)
    if file.suffix == '.py':
        try:
            py_compile.compile(str(file), doraise=True)
        except py_compile.PyCompileError as exc:
            print(f'Python syntax error in {rel}:\n{exc.msg}', file=sys.stderr)
            return 2
    elif file.suffix in ('.js', '.cjs', '.mjs'):
        node = shutil.which('node')
        if node:
            r = subprocess.run([node, '--check', str(file)], capture_output=True, text=True)
            if r.returncode:
                print(f'JavaScript syntax error in {rel}:\n{r.stderr.strip()[-1500:]}', file=sys.stderr)
                return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
