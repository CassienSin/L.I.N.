"""Checks for search by meaning (meaning.py). Uses a stand-in model, so it runs anywhere; when the real model is
installed (design/Install-Meaning.cmd), it also checks that real paraphrases are found and unrelated text is not."""
from datetime import timedelta
from pathlib import Path
import hashlib
import json
import re
import sys
import tempfile
import time

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import meaning as M
from brain import Brain
import conversations as C

checks = []
def ok(name):
    checks.append(name)

# A stand-in that knows a few synonyms: words with the same idea share a direction.
IDEAS = {'worry': 'concern', 'worried': 'concern', 'worries': 'concern', 'concerns': 'concern', 'concerned': 'concern', 'asked': 'concern',
         'panel': 'panel', 'panelists': 'panel', 'examiners': 'panel', 'lea': 'panel',
         'testing': 'test', 'test': 'test', 'tests': 'test', 'load': 'test', 'stress': 'test',
         'defense': 'defense', 'defence': 'defense', 'thesis': 'defense', 'capstone': 'defense',
         'date': 'when', 'when': 'when', 'november': 'when', 'schedule': 'when'}
class StandIn:
    name = 'stand-in'
    dim = 64
    calls = 0
    def encode(self, texts, kind='passage', max_length=256):
        StandIn.calls += 1
        out = []
        for t in texts:
            v = np.zeros(self.dim, dtype=np.float32)
            for w in re.findall(r'[a-z]+', t.lower()):
                idea = IDEAS.get(w)
                if idea:
                    v[int(hashlib.md5(idea.encode()).hexdigest(), 16) % self.dim] += 1
            out.append(v / (np.linalg.norm(v) or 1))
        return np.stack(out)

with tempfile.TemporaryDirectory(prefix='meaning-test-') as tmp:
    tmp = Path(tmp)
    index = M.MeaningIndex(tmp / 'data', embedder=StandIn(), floor=0.5)

    # 1. Keeping the index in step: new, changed and removed items; a busy Lin pauses it.
    items = [('a', 'file', 'Panel feedback: Dr. Lea asked for load testing beyond 50 patients.'),
             ('b', 'file', 'Library until 6.'), ('c', 'memory', 'Defense date: November 12')]
    assert index.sync(items) == 3 and index.status()['items'] == 3
    assert index.sync(items) == 0, 'nothing is embedded twice'
    items[1] = ('b', 'file', 'Library until 7.')
    assert index.sync(items) == 1
    assert index.sync(items[:2]) == 0 and index.status()['items'] == 2, 'removed items leave the index'
    many = [(f'n{i}', 'file', f'note {i} about testing') for i in range(40)]
    calls = {'n': 0}
    def busy_after_two():
        calls['n'] += 1
        return calls['n'] > 2
    added = index.sync(items + many, stop=busy_after_two, batch=8)
    assert added == 16 and index.status()['pending'] == 25, (added, index.status())
    assert index.sync(items + many, batch=8) == 25 and index.status()['pending'] == 0
    raw = (tmp / 'data' / 'meaning.sqlite3').read_bytes()
    assert b'load testing' not in raw, 'only numbers are stored, never the words'
    ok('The meaning index adds new and changed passages, drops removed ones, never embeds twice, pauses when Lin is busy and resumes; it stores numbers, not your words')

    # 2. Searching by meaning, with a floor and a kind filter; and mixing with word search.
    index.sync(items)
    hits = index.search('What were the examiners worried about?')
    assert hits and hits[0][0] == 'a', hits
    assert index.search('What were the examiners worried about?', kind='memory') == []
    assert index.search('lunch menu') == [], 'unrelated questions find nothing'
    assert M.fuse(['b', 'a'], [('a', .9)], 3) == [('a', 'both'), ('b', 'words')]
    assert M.fuse([], [('c', .9)], 3) == [('c', 'meaning')]
    ok('“What were the examiners worried about?” finds “Dr. Lea asked for load testing” with no word in common; unrelated questions find nothing; word and meaning results are mixed, both ranking first')

    # 3. Lin Brain: exact names still win, paraphrases are found, the card says how.
    notes = tmp / 'notes'; notes.mkdir()
    (notes / 'Panel feedback.md').write_text('# Panel feedback\nDr. Lea asked for load testing beyond 50 patients.', encoding='utf-8')
    (notes / 'Library.md').write_text('# Library\nOpen until 6 on weekdays.', encoding='utf-8')
    brain = Brain(tmp / 'brain', notes)
    assert brain.search('What were the examiners worried about?', refresh=False) == [], 'without the model: word search only'
    brain.meaning = M.MeaningIndex(tmp / 'brain', embedder=StandIn(), floor=0.5)
    brain.meaning.sync(brain.index_items())
    found = brain.search('What were the examiners worried about?', refresh=False)
    assert found and found[0]['title'] == 'Panel feedback.md' and found[0]['match'] == 'meaning', found
    exact = brain.search('library', refresh=False)
    assert exact and exact[0]['title'] == 'Library.md' and exact[0]['match'] in ('words', 'both'), exact
    import honesty
    lines = honesty.for_job({'mode': 'brain', 'question': 'What were the examiners worried about?', 'sources': found})
    assert any('found by meaning' in l for l in lines), lines
    ok('In Lin Brain, a question in other words finds the right note (marked “found by meaning”), exact names still come first, and the honest line says so')

    # 4. Conversations: private and recall turns are never indexed; forgetting drops them from meaning search at once.
    store = C.ConversationStore(tmp / 'conv')
    now = C.local_now()
    A, P = 'a' * 32, 'p' * 32
    store.add_turn(A, 'What did the panel ask for?', 'More load testing.', now=now - timedelta(hours=2))
    store.add_turn(A, 'What did we talk about today?', 'The panel.', {'tool': 'conversations'}, now=now - timedelta(hours=1))
    store.set_private(P, True); store.add_turn(P, 'secret thesis worries', 'ok')
    turns = store.index_items()
    assert len(turns) == 1 and turns[0][0].startswith('turn:'), turns
    tid = turns[0][0].split(':')[1]
    assert [r['question'] for r in store.by_ids([tid])] == ['What did the panel ask for?']
    assert store.by_ids([tid], start=now - timedelta(minutes=30)) == []
    cindex = M.MeaningIndex(tmp / 'conv', embedder=StandIn(), floor=0.5)
    cindex.sync(turns)
    assert cindex.search('examiners stress tests', kind='turn')
    payload = store.preview_forget('this', A)
    store.forget(payload, 'b1')
    assert cindex.prune('turn', [i for i, _, _ in store.index_items()]) == 1 and cindex.search('examiners stress tests', kind='turn') == []
    ok('Saved turns are searchable by meaning; private conversations and earlier recall questions never are; forgetting a conversation removes it from meaning search at once')

    # 5. The real model, when installed: each question finds its passage first; questions with no answer find nothing.
    if (M.MODEL_DIR / 'config.json').is_file():
        real = M.Embedder()
        t = time.perf_counter(); real.encode(['warm up'], 'query'); query_ms = (time.perf_counter() - t) * 1000
        corpus = {'lea': 'Dr. Lea asked for load testing beyond 50 patients.', 'defense': 'Defense date: November 12',
                  'library': 'The library is open until 10 PM on weekdays.', 'groceries': 'Buy rice, eggs and coffee on Saturday.',
                  'colour': 'My favourite colour is blue.', 'chapter': 'Chapter 4 covers the SMS notification results.',
                  'room': 'Room 204 is booked for the rehearsal on Friday.'}
        asks = [('What were the panel worried about?', 'lea'), ('When is my defense?', 'defense'), ('Where can I study late?', 'library'),
                ('Ano ang sinabi ng panel?', 'lea'), ('What do I need from the grocery?', 'groceries'), ('Where are we rehearsing?', 'room'),
                ('How do I fix a flat bicycle tire?', None), ("What's the capital of Japan?", None), ('Recommend a good anime to watch.', None)]
        live = M.MeaningIndex(tmp / 'real', embedder=real)
        live.sync([(k, 'file', v) for k, v in corpus.items()])
        report, good_z, bad_z = [], [], []
        for q, want in asks:
            qv = real.encode([q], 'query', 64)[0]
            scores = live.matrix @ qv
            lift = live.standout(qv, scores)
            top = sorted(zip(live.ids, scores, lift), key=lambda r: -r[1])[:3]
            found = [i for i, _ in live.search(q)]
            report.append({'question': q, 'expected': want, 'found': found,
                           'top': [{'passage': i, 'similarity': round(float(sc), 3), 'z': round(float(z), 2)} for i, sc, z in top]})
            (good_z if want else bad_z).append(float(top[0][2]) if (not want or top[0][0] == want) else float('nan'))
        print(json.dumps({'query_ms': round(query_ms, 1), 'z_now': M.Z, 'floor': M.FLOOR, 'results': report}, indent=2, ensure_ascii=False))
        good = [z for z in good_z if z == z]
        print(f'Top-hit z for questions with an answer: {sorted(round(z, 2) for z in good)}; '
              f'for questions without one: {sorted(round(z, 2) for z in bad_z)}. '
              + (f'Any Z between {max(bad_z):.2f} and {min(good):.2f} separates them.' if good and max(bad_z) < min(good) else 'They overlap.'))
        wrong = [r for r in report if (r['expected'] and r['found'][:1] != [r['expected']]) or (not r['expected'] and r['found'])]
        assert not wrong, json.dumps(wrong, ensure_ascii=False)
        ok(f'With the real model ({real.load_seconds} s to load, a question in {query_ms:.0f} ms): each of 6 questions in other words '
           f'(one in Filipino) finds its passage first, and 3 questions with no answer in your notes find nothing')
    else:
        print('(The meaning model is not installed here, so the real-model check was skipped.)')

out = {'passed': True, 'checks': checks}
print(json.dumps(out, indent=2, ensure_ascii=False))
(HERE / 'brain-benchmark').mkdir(exist_ok=True)
(HERE / 'brain-benchmark' / 'meaning-results.json').write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
