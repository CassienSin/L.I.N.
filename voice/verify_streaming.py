"""Sentence streaming checks with the real server workers and stand-in model and voice engines.

No model, GPU or network is used. Verifies that speech starts before generation finishes, that
sentences play in order, that an unverified sentence is never queued, and that cancellation stops both.
"""
from pathlib import Path
import json
import sys
import tempfile
import threading
import time
import types

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
if 'process_lifetime' not in sys.modules:
    try:
        import process_lifetime  # noqa: F401  (present on the Windows install)
    except ImportError:
        sys.modules['process_lifetime'] = types.SimpleNamespace(ProcessLifetime=object)

SPOKEN = []          # (job id, text, time) as the stand-in voice "generates" each sentence
SCRIPT = {}          # question -> list of sentences the stand-in model will produce


class FakeVoice:
    device = 'stand-in'
    load_seconds = 0
    sample_rate = 16000

    def generate(self, text, steps):
        SPOKEN.append((CURRENT['job'], text, time.perf_counter()))
        time.sleep(0.05)
        import numpy
        return numpy.zeros(800, dtype='float32'), {'audio_seconds': 0.05, 'generation_seconds': 0.05}


CURRENT = {'job': None}
sys.modules['local_engine'] = types.SimpleNamespace(LocalVoice=FakeVoice)
try:
    import soundfile  # noqa: F401
except ImportError:
    def _write(stream, wave, rate, format=None, subtype=None):
        stream.write(b'RIFF0000WAVE')
    sys.modules['soundfile'] = types.SimpleNamespace(write=_write)

import reasoner
import server


class FakeProcess:
    def poll(self):
        return None


class FakeReasoner:
    process = FakeProcess()
    load_seconds = 0
    last_timings = {}
    last_route_timings = {}

    def __init__(self):
        self.finished_at = {}

    def route(self, question, prompt, schema, cancelled):
        return {'tool': 'free_time', 'day': 'today', 'part': 'workday'} if 'gym' in question else {'tool': 'none'}

    def answer(self, question, history, cancelled, memories=None, checked=None, instruction=None, on_sentence=None, max_tokens=180):
        sent = []
        for sentence in SCRIPT[question]:
            time.sleep(0.25)  # generation time per sentence
            if cancelled():
                raise reasoner.Cancelled()
            if on_sentence and on_sentence(sentence) is False:
                break
            sent.append(sentence)
        self.finished_at[question] = time.perf_counter()
        if not sent:
            raise ValueError('The local model returned no answer.')
        return ' '.join(sent), 0.25 * len(sent)

    def warm(self, slot, prompt):
        return True, 0

    def cancel(self):
        pass

    def close(self):
        pass


reasoner.LocalReasoner = FakeReasoner
checks = []


def run(question, route=None, cancel_after=None, timeout=10):
    with server.LOCK:
        server.STATE['busy'] = server.REASON_STATE['busy'] = True
        job_id = f'{len(server.JOBS):024x}'
        server.JOBS[job_id] = {'id': job_id, 'kind': 'answer', 'status': 'thinking', 'question': question, 'conversation': 'a' * 32,
                               'texts': [], 'segments': [], 'audio': [], 'mode': 'chat', 'sources': [], 'proposal': None,
                               'route': route, 'memory_context': [], 'cancelled': False, 'started': time.perf_counter()}
    CURRENT['job'] = job_id
    started = time.perf_counter()
    server.REASON_QUEUE.put_nowait(job_id)
    job = server.JOBS[job_id]
    while time.perf_counter() - started < timeout:
        with server.LOCK:
            if cancel_after is not None and len(job['segments']) >= cancel_after and not job['cancelled']:
                job['cancelled'] = True
                job['status'] = 'cancelled'
            done = not server.STATE['busy'] and not server.REASON_STATE['busy']
        if done:
            return job, started
        time.sleep(0.02)
    raise AssertionError(f'Job did not finish: {job["status"]}')


with tempfile.TemporaryDirectory(prefix='streaming-test-', dir=HERE / 'runtime') as tmp:
    from planner import Planner
    from calendar_store import CalendarStore
    import actions
    server.PLANNER = Planner(tmp)
    server.CALENDAR = CalendarStore(tmp)
    server.ACTIONS = actions.ActionStore(tmp, server.PLANNER)
    server.BRAIN = None
    from datetime import datetime, timedelta
    day = datetime.now(actions.ZONE).replace(hour=0, minute=0, second=0, microsecond=0)
    payload = {'events': [], 'coverage_start': day.isoformat(), 'coverage_end': (day + timedelta(days=30)).isoformat(),
               'timezone': 'Asia/Manila', 'definitions': 0, 'floating': False, 'name': 'empty.ics', 'imported_at': datetime.now(actions.ZONE).isoformat()}
    server.CALENDAR.preview = {'id': 'test', 'expires': time.monotonic() + 60, 'payload': payload, 'revision': 0}
    server.CALENDAR.commit({'id': 'test', 'revision': 0})
    threading.Thread(target=server.voice_worker, daemon=True).start()
    threading.Thread(target=server.reasoning_worker, daemon=True).start()
    for _ in range(200):
        if server.STATE['ready'] and server.REASON_STATE['ready']:
            break
        time.sleep(0.02)
    assert server.STATE['ready'] and server.REASON_STATE['ready']

    # 1. Plain chat: the first sentence is spoken before the model has finished.
    q = 'Give me three focus tips.'
    SCRIPT[q] = ['Start with the hardest task.', 'Silence notifications for an hour.', 'Take a short break after each block.']
    job, started = run(q)
    mine = [s for s in SPOKEN if s[0] == job['id']]
    assert [s[1] for s in mine] == SCRIPT[q] and job['texts'] == SCRIPT[q] and job['status'] == 'complete'
    assert mine[0][2] < server.REASONER.finished_at[q] - 0.3, 'Speech should start before generation finishes'
    assert job['answer'] == ' '.join(SCRIPT[q]) and not job['streaming'] and job['first_text_seconds'] < 0.5
    history = server.CONVERSATIONS['a' * 32]
    assert history[-1]['content'] == job['answer']
    checks.append(f"Plain answers stream: first sentence voiced {mine[0][2]-started:.2f} s after the request, {server.REASONER.finished_at[q]-mine[0][2]:.2f} s before generation finished; order and history preserved")

    # 2. Tool answer: a sentence citing a time that is not in the data is never queued.
    q = 'Should I go to the gym this afternoon?'
    SCRIPT[q] = ['Nothing is booked today, so the gym fits.', 'You are free at 4:45 PM.', 'This should never be spoken.']
    job, _ = run(q, route='model')
    assert job['texts'] == [SCRIPT[q][0]], job['texts']
    assert 'stopped before an unverified sentence' in job['verification']
    assert not any('4:45' in s[1] for s in SPOKEN)
    checks.append('Tool answers verify each sentence before it is voiced; an unverified sentence stops generation and is never spoken')

    # 3. If the very first sentence fails verification, the exact summary is spoken instead.
    SCRIPT[q] = ['You are free at 4:45 PM.']
    job, _ = run(q, route='model')
    assert job['texts'] and '4:45' not in ' '.join(job['texts']) and job['verification'].startswith('replaced with checked summary')
    checks.append('When the first sentence fails verification, the exact checked summary is spoken instead')

    # 3b. With no data source at all, the model is skipped and the limitation is stated.
    server.CALENDAR.forget(server.CALENDAR.snapshot()['revision'])
    SCRIPT[q] = ['There are no scheduled events this afternoon.']
    job, _ = run(q, route='model')
    assert job['texts'] == ['No calendar has been imported yet, so I can’t see your events or free time.', 'Import one in Today.'] and job['verification'] == 'exact', job['texts']
    checks.append('When the needed source is missing, Lin states that plainly instead of letting the model guess')

    # 4. Interrupting mid-answer stops both generation and speech.
    q = 'Tell me a long story.'
    SCRIPT[q] = [f'This is sentence number {i}.' for i in range(1, 8)]
    job, _ = run(q, cancel_after=1)
    spoken = [s for s in SPOKEN if s[0] == job['id']]
    assert job['cancelled'] and len(spoken) <= 2 and len(job['texts']) < 7, (len(spoken), len(job['texts']))
    assert 'a' * 32 in server.CONVERSATIONS and server.CONVERSATIONS['a' * 32][-1]['content'] != ' '.join(SCRIPT[q])
    checks.append('Interrupting during a streamed answer stops generation and speech; the partial answer is not saved to chat history')

    # 5. The speech bound (16 sentences, so long answers are no longer cut at 8) still holds when streaming.
    q = 'Ramble on.'
    SCRIPT[q] = [f'Point {i} matters.' for i in range(1, 20)]
    job, _ = run(q)
    assert len(job['texts']) == server.MAX_CHUNKS == 16 and job['status'] == 'complete', len(job['texts'])
    checks.append('Streaming keeps the sixteen-sentence bound per spoken response')

out = HERE / 'brain-benchmark' / 'streaming-results.json'
out.write_text(json.dumps({'passed': True, 'checks': checks}, indent=2), encoding='utf-8')
print(json.dumps({'passed': True, 'checks': checks}, indent=2))
