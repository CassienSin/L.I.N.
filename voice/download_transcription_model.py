"""One-time public model download. No recordings or user text are uploaded."""
import hashlib
import json
from pathlib import Path
from download_model import get

base = Path(__file__).resolve().parent
repo = 'Systran/faster-whisper-base.en'
dest = base / 'models' / 'faster-whisper-base.en'
dest.mkdir(parents=True, exist_ok=True)
with get(f'https://huggingface.co/api/models/{repo}?blobs=true') as response:
    metadata = json.load(response)
revision = metadata['sha']
files = [f for f in metadata['siblings'] if f['rfilename'].endswith('.json') or f['rfilename'] in {'model.bin','README.md','vocabulary.txt'}]
manifest = {'repository':repo,'revision':revision,'license':'MIT (publisher model card)','files':[]}
for info in files:
    name = info['rfilename']
    target = (dest / name).resolve()
    if not target.is_relative_to(dest.resolve()):
        raise ValueError('Unexpected model path')
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = info.get('size') or info.get('lfs',{}).get('size')
    expected_sha = info.get('lfs',{}).get('sha256')
    if target.exists():
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        valid = target.stat().st_size == expected and (not expected_sha or digest == expected_sha)
    else:
        valid = False
    if not valid:
        print(f'Downloading {name}...',flush=True)
        part = target.with_suffix(target.suffix+'.part')
        digest = hashlib.sha256()
        with get(f'https://huggingface.co/{repo}/resolve/{revision}/{name}?download=true') as response, part.open('wb') as out:
            while chunk := response.read(4*1024*1024):
                out.write(chunk); digest.update(chunk)
        if expected and part.stat().st_size != expected:
            raise ValueError('Model size mismatch')
        if expected_sha and digest.hexdigest() != expected_sha:
            raise ValueError('Model checksum mismatch')
        part.replace(target)
    manifest['files'].append({'name':name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(base/'transcription-model-source.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(f'Local transcription model ready: {revision}',flush=True)
