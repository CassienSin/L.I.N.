"""Compares the reasoning models on this computer with llama-bench. Output: speed-lab/brain.json"""
from offline import BASE
import json, subprocess, sys, time
RT = BASE / 'models' / 'reasoning'
out = {}
for name in sys.argv[1:]:
    r = subprocess.run([str(RT / 'runtime' / 'llama-bench.exe'), '-m', str(RT / name), '-t', '4,6,8', '-p', '256', '-n', '64', '-r', '2', '-o', 'json'],
                       capture_output=True, text=True, timeout=1800, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        out[name] = [{'threads': x['n_threads'], 'test': 'prompt' if x['n_prompt'] else 'write', 'tokens_per_second': round(x['avg_ts'], 2)} for x in json.loads(r.stdout)]
    except Exception:
        out[name] = {'error': r.stderr[-1500:]}
    (BASE / 'speed-lab' / 'brain.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
print('DONE')
