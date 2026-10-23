"""One-time explicit setup; never imported by the offline service."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

BASE = Path(__file__).resolve().parent
SOURCES = [
    {'file':'llama-b11669-bin-win-cpu-x64.zip', 'url':'https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-cpu-x64.zip', 'sha256':'37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b', 'license':'MIT'},
    {'file':'Qwen3-4B-Q4_K_M.gguf', 'url':'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf', 'sha256':'7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5', 'license':'Apache-2.0'},
]

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def main():
    target = BASE/'models'/'reasoning'
    target.mkdir(parents=True, exist_ok=True)
    for source in SOURCES:
        path = target/source['file']
        if not path.exists() or digest(path) != source['sha256']:
            partial = path.with_suffix('.partial')
            request = urllib.request.Request(source['url'], headers={'User-Agent':'Lin-local-setup'})
            with urllib.request.urlopen(request, timeout=90) as response, partial.open('wb') as out:
                count = 0
                reported = -1
                while chunk := response.read(4*1024*1024):
                    out.write(chunk)
                    count += len(chunk)
                    if count//(256*1024*1024) != reported:
                        reported = count//(256*1024*1024)
                        print(f"{source['file']}: {count//(1024*1024)} MB", flush=True)
            if digest(partial) != source['sha256']:
                raise RuntimeError('Download checksum mismatch')
            partial.replace(path)
        print(f"Verified {source['file']}", flush=True)
    with zipfile.ZipFile(target/SOURCES[0]['file']) as archive:
        # Official archive, verified before extraction; also constrain paths.
        runtime = target/'runtime'
        for item in archive.infolist():
            if not (runtime/item.filename).resolve().is_relative_to(runtime.resolve()):
                raise RuntimeError('Unsafe archive path')
        archive.extractall(runtime)
    (BASE/'reasoning-model-source.json').write_text(json.dumps(SOURCES, indent=2)+'\n', encoding='utf-8')

if __name__ == '__main__':
    main()
