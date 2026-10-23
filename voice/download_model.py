"""Download public OmniVoice model files; no text/audio is uploaded."""
import hashlib
import json
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
DEST = BASE / "models" / "omnivoice"
REPO = "k2-fsa/OmniVoice"

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Lin-Local-Voice-Audition/0.1"}), timeout=90)

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    with get(f"https://huggingface.co/api/models/{REPO}?blobs=true") as response:
        metadata = json.load(response)
    revision = metadata["sha"]
    files = [f for f in metadata["siblings"] if f["rfilename"].endswith((".safetensors", ".json", ".jinja")) or f["rfilename"] == "README.md"]
    manifest = {"repository": REPO, "revision": revision, "files": files, "downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (BASE / "model-source.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Pinned model revision: {revision}; {len(files)} files", flush=True)
    for info in files:
        name = info["rfilename"]
        target = (DEST / name).resolve()
        if not target.is_relative_to(DEST.resolve()):
            raise ValueError("Unexpected file path")
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = info.get("size") or info.get("lfs", {}).get("size")
        digest = info.get("lfs", {}).get("sha256")
        if target.exists() and (not expected or target.stat().st_size == expected):
            print(f"Already downloaded: {name}", flush=True)
            continue
        partial = target.with_suffix(target.suffix + ".part")
        written = 0
        reported = 0
        hasher = hashlib.sha256()
        print(f"Downloading {name} ({(expected or 0)/1e6:.1f} MB)", flush=True)
        with get(f"https://huggingface.co/{REPO}/resolve/{revision}/{name}?download=true") as response, partial.open("wb") as output:
            while chunk := response.read(4 * 1024 * 1024):
                output.write(chunk)
                hasher.update(chunk)
                written += len(chunk)
                if written - reported >= 100 * 1024 * 1024:
                    print(f"  {name}: {written/1e6:.0f} MB", flush=True)
                    reported = written
        if expected and written != expected:
            raise ValueError(f"Size mismatch for {name}: {written} != {expected}")
        if digest and hasher.hexdigest() != digest:
            raise ValueError(f"Checksum mismatch for {name}")
        partial.replace(target)
        print(f"Verified: {name}", flush=True)
    print("Model download complete. Generation can run offline.", flush=True)

if __name__ == "__main__":
    main()
