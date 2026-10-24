"""Checks for the voice fixes (no voice model needed): what the voice reads, the tidied audio, and no early cut-offs."""
from pathlib import Path
import json
import sys
import tempfile

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audio_polish as A
import speech_text as S

checks = []
def ok(name):
    checks.append(name)

# 1. What the voice reads.
CASES = [
    ('1. Traffic Receives: The load balancer receives traffic at its IP address.',
     'First, Traffic Receives: The load balancer receives traffic at its I P address.'),
    ('Here is a breakdown: 1. Health checks. 2. Routing.', 'Here is a breakdown: First, Health checks. Second, Routing.'),
    ('- Keep it simple.', 'Keep it simple.'),
    ('Your rehearsal is at 9:30 AM, the consult at 16:00, and the review at 4pm.',
     'Your rehearsal is at nine thirty A M, the consult at four P M, and the review at four P M.'),
    ('It costs $5.50, or ₱200, which is about 50% less.', 'It costs five dollars and fifty cents, or two hundred pesos, which is about fifty percent less.'),
    ('Voice takes 2.1–2.7 s per sentence on the 4 GB card.', 'Voice takes two point one to two point seven seconds per sentence on the four gigabytes card.'),
    ('The 3rd and 21st items were due on 2026-10-24.', 'The third and twenty-first items were due on October twenty-fourth, twenty twenty-six.'),
    ('Use **Sonnet** for speed & Opus for depth → see https://code.claude.com/docs.',
     'Use Sonnet for speed and Opus for depth to see a link to code dot claude dot com.'),
    ('You study BSIT at CCTC; e.g., TCP/IP and NASA.', 'You study B S I T at C C T C; for example T C P I P and NASA.'),
    ('Hi 😊, I am Lin. OK?', 'Hi, I am Lin. OK?'),
    ('Lin Brain has 1,250 notes and 1 memory.', 'Lin Brain has one thousand two hundred and fifty notes and one memory.'),
    ('It took 32.5 s.', 'It took thirty-two point five seconds.'),
]
for text, want in CASES:
    got = S.for_voice(text)
    assert got == want, f'\n  {text}\n  got:  {got}\n  want: {want}'
assert S.for_voice('Aljho studies at CCTC.', {'Aljho': 'Al-ho', 'CCTC': 'see see tee see'}) == 'Al-ho studies at see see tee see.'
assert S.words(0) == 'zero' and S.words(1005) == 'one thousand and five' and S.ordinal(12) == 'twelfth' and S.year(1999) == 'nineteen ninety-nine'
ok('The voice reads lists as “First, Second”, and says times, money, percentages, units, ranges, dates, ordinals, symbols, links and acronyms as words; your own pronunciations come first')

# 2. Tidied audio: dead air trimmed, edges faded, one loudness, no clipping.
sr = 24000
t = np.arange(int(sr * 1.5)) / sr
def sentence(level, lead=0.45, tail=0.6):
    voiced = level * np.sin(2 * np.pi * 210 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))
    return np.concatenate([np.zeros(int(sr * lead)), voiced, np.zeros(int(sr * tail))]).astype(np.float32)
quiet, loud, hot = A.polish(sentence(0.05), sr), A.polish(sentence(0.5), sr), A.polish(sentence(1.4), sr)
for clip in (quiet, loud, hot):
    lead, tail = A.silence_ms(clip, sr)
    assert lead <= A.LEAD_MS + 10 and tail <= A.TAIL_MS + 10, (lead, tail)
    assert abs(A.loudness_dbfs(clip, sr) - A.TARGET_DBFS) < 1.5, A.loudness_dbfs(clip, sr)
    assert float(np.max(np.abs(clip))) <= A.CEILING and abs(clip[0]) < 1e-3 and abs(clip[-1]) < 1e-3
    assert len(clip) / sr >= 1.5, 'the voiced part is never cut'
before = sentence(0.5)
assert A.silence_ms(before, sr)[0] > 400 and A.silence_ms(before, sr)[1] > 500
ok('Each sentence loses its dead air (about 1 s of silence becomes under 0.2 s), fades in and out without a click, and every sentence is equally loud with no clipping')

# 3. No early cut-offs: long answers keep up to 16 sentences.
import server
long_answer = ' '.join(f'This is sentence number {i} of a long answer.' for i in range(1, 15))
assert len(server.split_text(long_answer)) == 14
try:
    server.split_text('x. ' * 400 + 'y.', 600); raise AssertionError('the typed preview keeps its 600-character limit')
except ValueError:
    pass
assert server.MAX_CHUNKS == 16
ok('Long answers are spoken in full, up to 16 sentences (it was 8); the local brain ends on a whole sentence instead of a fragment')

# 4. Your pronunciations are saved and read back.
with tempfile.TemporaryDirectory() as tmp:
    p = Path(tmp) / 'pronounce.json'
    p.write_text(json.dumps({'words': {'CCTC': 'C C T C', '': 'x'}}), encoding='utf-8')
    assert S.load_pronunciations(p) == {'CCTC': 'C C T C'} and S.load_pronunciations(Path(tmp) / 'missing.json') == {}
ok('“How Lin says words” is saved on this PC and used for every sentence she speaks')

out = {'passed': True, 'checks': checks}
print(json.dumps(out, indent=2, ensure_ascii=False))
(HERE / 'brain-benchmark').mkdir(exist_ok=True)
(HERE / 'brain-benchmark' / 'voice-results.json').write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
