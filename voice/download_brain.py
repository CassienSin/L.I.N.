"""One-time explicit setup for Lin's bigger local brain; never imported by the offline service.
Downloads Qwen3.6-35B-A3B (mixture of experts: 35B total, ~3B active per word) as a GGUF from
Hugging Face, verifies it against the SHA-256 that Hugging Face publishes for the file, and records
the exact commit. Resumes if interrupted. Log: runtime/download-brain.log"""
import hashlib, json, sys, time, urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = 'unsloth/Qwen3.6-35B-A3B-GGUF'
WANT = 'UD-Q3_K_XL'          # ~17 GB: leaves room in 32 GB RAM for the voice, Windows and a browser
TARGET = BASE / 'models' / 'reasoning'
LOG = BASE / 'runtime' / 'download-brain.log'

def log(m):
    line = f"{time.strftime('%H:%M:%S')} {m}"
    print(line, flush=True)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(line + '\n')

def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Lin-local-setup'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def main():
    TARGET.mkdir(parents=True, exist_ok=True); LOG.parent.mkdir(exist_ok=True); LOG.write_text('', encoding='utf-8')
    info = get_json(f'https://huggingface.co/api/models/{REPO}')
    commit = info['sha']
    tree = get_json(f'https://huggingface.co/api/models/{REPO}/tree/{commit}')
    files = [f for f in tree if f['type'] == 'file' and f['path'].endswith('.gguf') and WANT in f['path'] and 'mmproj' not in f['path']]
    if len(files) != 1:
        raise SystemExit(f'Expected one {WANT} file, found: {[f["path"] for f in files]} (all: {[f["path"] for f in tree]})')
    f = files[0]; name = f['path'].split('/')[-1]; sha = f['lfs']['oid']; size = f['lfs']['size']
    log(f'{REPO}@{commit[:10]}: {name}, {size/1e9:.1f} GB')
    path = TARGET / name; partial = path.with_suffix('.partial')
    if not path.exists():
        url = f'https://huggingface.co/{REPO}/resolve/{commit}/{f["path"]}'
        have = partial.stat().st_size if partial.exists() else 0
        req = urllib.request.Request(url, headers={'User-Agent': 'Lin-local-setup', **({'Range': f'bytes={have}-'} if have else {})})
        with urllib.request.urlopen(req, timeout=90) as r, partial.open('ab' if have else 'wb') as out:
            if have and r.status != 206:
                out.truncate(0); have = 0
            count, last = have, 0
            while chunk := r.read(8 * 1024 * 1024):
                out.write(chunk); count += len(chunk)
                if time.monotonic() - last > 20:
                    last = time.monotonic(); log(f'{count/1e9:.2f} / {size/1e9:.2f} GB')
        log('Verifying SHA-256…')
        with partial.open('rb') as s:
            got = hashlib.file_digest(s, 'sha256').hexdigest()
        if got != sha:
            partial.unlink(); raise SystemExit('Checksum mismatch; the partial file was removed. Run again.')
        partial.replace(path)
    record = {'file': name, 'url': f'https://huggingface.co/{REPO}/resolve/{commit}/{f["path"]}', 'sha256': sha, 'bytes': size,
              'license': 'Apache-2.0 (Qwen3.6)', 'repo': REPO, 'commit': commit}
    (BASE / 'brain-model-source.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    log('RESULT: DONE ' + name)

if __name__ == '__main__':
    try:
        main()
    except SystemExit as e:
        log(f'RESULT: FAILED {e}'); raise
    except Exception as e:
        log(f'RESULT: FAILED {e!r}'); raise
