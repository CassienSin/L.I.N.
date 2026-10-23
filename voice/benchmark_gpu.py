"""Measure the real local GPU path and retain public example clips for review."""
import json
from pathlib import Path
from local_engine import LocalVoice, REFERENCE_TEXT
import soundfile as sf
import torch

out = Path(__file__).resolve().parent / 'gpu-benchmark'
out.mkdir(exist_ok=True)
print('Loading GPU model and preparing the selected synthetic A reference...', flush=True)
voice = LocalVoice()
report = {'device': voice.device, 'dtype': str(voice.dtype), 'torch': torch.__version__,
          'load_and_reference_seconds': voice.load_seconds,
          'network': 'Offline libraries, local model paths, outbound Python sockets blocked',
          'sample_rate': voice.sample_rate, 'runs': [],
          'quality_review': 'Not evaluated; reduced steps and reference transfer need listening review'}
cases = [
    ('gpu-design-32', REFERENCE_TEXT, 32, True),
    ('gpu-reference-32', REFERENCE_TEXT, 32, False),
    ('gpu-reference-16', REFERENCE_TEXT, 16, False),
    ('segment-1', 'Good morning. I am ready when you are.', 32, False),
    ('segment-2', 'You can pause my voice, or interrupt me at any time.', 32, False),
    ('segment-3', 'The card follows what you hear, so we stay on the same page.', 32, False),
]
for name, text, steps, design in cases:
    print(f'Generating {name}...', flush=True)
    wave, metrics = voice.generate(text, steps=steps, design=design)
    sf.write(out / f'{name}.wav', wave, voice.sample_rate, subtype='PCM_16')
    row = {'name': name, 'text': text, 'file': f'{name}.wav', **metrics}
    report['runs'].append(row)
    (out / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(row), flush=True)
print('GPU benchmark complete.', flush=True)
