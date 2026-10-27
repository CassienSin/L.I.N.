"""One-time public model download for search by meaning (meaning.py). No notes, memories or conversations are uploaded:
this only fetches the model files, checks each one against the SHA-256 that Hugging Face publishes, and records the
exact revision and licence in embeddings-model-source.json. Resumes from scratch if interrupted (the model is small)."""
import hashlib
import json
from pathlib import Path
from download_model import get

base = Path(__file__).resolve().parent
repo = 'intfloat/multilingual-e5-small'
dest = base / 'models' / 'embeddings' / 'multilingual-e5-small'
dest.mkdir(parents=True, exist_ok=True)
with get(f'https://huggingface.co/api/models/{repo}?blobs=true') as response:
    metadata = json.load(response)
revision = metadata['sha']
licence = (metadata.get('cardData') or {}).get('license') or 'see the model card'
# Only what the transformers tokenizer and model need, from the top of the repository (not the ONNX or other copies).
wanted = {'config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'sentencepiece.bpe.model'}
files = [f for f in metadata['siblings'] if f['rfilename'] in wanted]
if not any(f['rfilename'] == 'model.safetensors' for f in files):
    raise SystemExit('The model repository no longer has model.safetensors; Lin needs updating before it can download it.')
manifest = {'repository': repo, 'revision': revision, 'license': licence, 'files': []}
for info in files:
    name = info['rfilename']
    target = (dest / name).resolve()
    if not target.is_relative_to(dest.resolve()):
        raise ValueError('Unexpected model path')
    expected = info.get('size') or (info.get('lfs') or {}).get('size')
    expected_sha = (info.get('lfs') or {}).get('sha256')
    valid = target.exists() and target.stat().st_size == expected and (not expected_sha or hashlib.sha256(target.read_bytes()).hexdigest() == expected_sha)
    if not valid:
        print(f'Downloading {name}...', flush=True)
        part = target.with_suffix(target.suffix + '.part')
        digest = hashlib.sha256()
        with get(f'https://huggingface.co/{repo}/resolve/{revision}/{name}?download=true') as response, part.open('wb') as out:
            while chunk := response.read(4 * 1024 * 1024):
                out.write(chunk); digest.update(chunk)
        if expected and part.stat().st_size != expected:
            raise ValueError(f'{name}: size mismatch')
        if expected_sha and digest.hexdigest() != expected_sha:
            raise ValueError(f'{name}: checksum mismatch')
        part.replace(target)
    manifest['files'].append({'name': name, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(base / 'embeddings-model-source.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'Search by meaning is ready: {repo} at {revision[:12]}, licence {licence}.', flush=True)
