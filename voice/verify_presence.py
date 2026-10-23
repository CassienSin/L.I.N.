"""Checks for the greeting, "what I couldn't check" and Save to brain (no model or voice needed)."""
from datetime import datetime, timedelta
from pathlib import Path
import json
import sys
import tempfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import honesty
import presence
from actions import ActionStore, receipt_answer, ZONE
from brain import Brain, Conflict
from calendar_store import CalendarStore
from planner import Planner

checks = []
(HERE / 'runtime').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='presence-test-') as tmp:
    tmp = Path(tmp)
    notes = tmp / 'notes'
    notes.mkdir()
    (notes / 'Panel feedback.md').write_text('# Panel feedback\nDr. Lea asked for load testing beyond 50 patients.\n', encoding='utf-8')
    brain = Brain(tmp / 'data', notes)
    brain.save({'title': 'Defense room', 'fact': 'The defense is in room 204.', 'scope': 'personal'})
    planner = Planner(tmp / 'data')
    for title, p in [('Finish slides', 1), ('Print copies', 2)]:
        planner.mutate('save', {'revision': planner.revision(), 'title': title, 'scope': 'personal', 'minutes': 30, 'priority': p})
    calendar = CalendarStore(tmp / 'data')
    now = datetime(2026, 10, 23, 19, 5, tzinfo=ZONE)

    g = presence.greeting('Aljho', brain.status(), planner, calendar, now)
    assert g.startswith('Good evening, Aljho.') and 'Lin Brain has 1 note and 1 memory.' in g and '2 open tasks, 1 high priority.' in g, g
    assert 'calendar' not in g.lower(), 'no calendar sentence without an imported calendar'
    assert presence.greeting('Aljho', {'files': 3, 'memories': 6}, planner, calendar, now.replace(hour=8)).startswith('Good morning')
    assert presence.greeting('Aljho', {}, planner, calendar, now.replace(hour=0, minute=18)).startswith('Good evening'), 'just after midnight is still evening'
    assert '3 notes and 6 memories' in presence.greeting('Aljho', {'files': 3, 'memories': 6}, planner, calendar, now)
    checks.append(f'Greeting uses real counts and the time of day: “{g}”')

    chat = honesty.for_job({'question': 'Give me a tip for focus'})
    assert 'general knowledge' in chat[0]
    facts = honesty.for_job({'question': 'Where is my defense?', 'memory_context': [{'id': 1}]})
    assert facts[0].startswith('Used 1 saved fact')
    src = brain.search('panel feedback zeppelin', refresh=False)
    brainjob = honesty.for_job({'question': 'panel feedback zeppelin', 'mode': 'brain', 'sources': src})
    assert any('“zeppelin”' in x for x in brainjob) and not any('panel' in x for x in brainjob), brainjob
    assert honesty.for_job({'question': 'x', 'mode': 'brain', 'sources': []})[0].startswith('Nothing in Lin Brain matched')
    cal = honesty.for_job({'question': 'agenda', 'checked': {'tool': 'agenda', 'available': False, 'note': 'No calendar has been imported yet.'}})
    assert cal == ['No calendar has been imported yet.']
    many = honesty.for_job({'question': 'tasks', 'checked': {'tool': 'tasks', 'available': True, 'tasks': [1] * 10, 'open': 14, 'more': 4}})
    assert 'shows 10 of 14' in many[0]
    replaced = honesty.for_job({'question': 'q', 'checked': {'tool': 'plan'}, 'verification': 'replaced with checked summary (x)'})
    assert any('exact summary' in x for x in replaced)
    assert 'Lin can\'t confirm' in honesty.for_job({'question': 'q', 'checked': {'tool': 'mcp', 'name': 'add_numbers'}})[0]
    checks.append('“What I couldn’t check” comes from what was actually looked at: general knowledge, saved facts, unmatched words, missing calendar, cut lists, replaced wording and tool output')

    job = {'kind': 'answer', 'status': 'complete', 'question': 'What did the panel say about load testing?',
           'answer': 'They asked for load testing beyond 50 patients.', 'mode': 'brain', 'sources': src,
           'unchecked': ['Only the 1 closest passage were read, not every note.']}
    note = presence.note_from_job(job, now)
    assert note['title'] == 'What did the panel say about load testing' and '## You asked' in note['body'] and '- [[Panel feedback]]' in note['body']
    store = ActionStore(tmp / 'data', planner)
    store.brain = brain
    action = store.propose('save_note', note, 'Save to brain: ' + job['question'])
    target = notes / action['payload']['file']
    assert action['state'] == 'proposed' and not target.exists() and action['payload']['file'].startswith('Saved answers/2026-')
    revised = store.revise(action['id'], {'title': 'Panel on load testing'})
    assert revised['payload']['title'] == 'Panel on load testing' and revised['hash'] != action['hash']
    try:
        store.approve(action['id'], action['hash'])
        raise AssertionError('old approval accepted')
    except Conflict:
        pass
    done = store.approve(revised['id'], revised['hash'])
    target = notes / done['payload']['file']
    assert done['state'] == 'executed' and target.read_text(encoding='utf-8').startswith('# Panel on load testing\n')
    assert any(s['title'].replace('\\', '/') == done['payload']['file'] for s in brain.search('load testing', refresh=False))
    assert receipt_answer(done).startswith('Saved.')
    second = store.propose('save_note', {**note, 'title': 'Panel on load testing'}, 'again')
    assert second['payload']['file'] != done['payload']['file'], 'never overwrites an existing note'
    store.reject(second['id'])
    store.undo(done['id'])
    assert not target.exists()
    assert not any(s['title'].replace('\\', '/') == done['payload']['file'] for s in brain.search('load testing', refresh=False))
    fresh = store.propose('save_note', note, 'x')
    again = store.approve(fresh['id'], fresh['hash'])
    p2 = notes / again['payload']['file']
    p2.write_text(p2.read_text(encoding='utf-8') + 'edited by me\n', encoding='utf-8')
    try:
        store.undo(again['id'])
        raise AssertionError('undo deleted an edited note')
    except Conflict:
        pass
    assert p2.exists()
    for bad in [{'title': '', 'body': 'x'}, {'title': 'ok', 'body': ''}, {'title': 'ok', 'body': 'x' * 12001}]:
        try:
            store.propose('save_note', bad, 'x')
            raise AssertionError(f'accepted {bad}')
        except ValueError:
            pass
    checks.append('Save to brain is a proposal with an editable title; edits void the earlier approval; it writes a new note (never overwrites), the note is searchable at once, Undo removes it, and an edited note is never deleted')

out = HERE / 'brain-benchmark' / 'presence-unit-results.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'passed': True, 'checks': checks}, indent=2), encoding='utf-8')
print(json.dumps({'passed': True, 'checks': checks}, indent=2))
