"""Checks for conversation memory (no model or voice needed): saving, picking up, recall, privacy, forgetting with undo."""
from datetime import timedelta
from pathlib import Path
import json
import sys
import tempfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import conversations as C
import honesty
from actions import ActionStore
from planner import Planner

checks = []
def ok(name):
    checks.append(name)

with tempfile.TemporaryDirectory(prefix='conversations-test-') as tmp:
    tmp = Path(tmp)
    store = C.ConversationStore(tmp)
    # A fixed mid-afternoon reference time, so the checks pass at any hour (just after midnight too).
    now = C.local_now().replace(hour=15, minute=0, second=0, microsecond=0)
    A, B, P = 'a' * 32, 'b' * 32, 'c' * 32

    # 1. Saving and picking a conversation back up.
    store.add_turn(A, 'Hey Lin, what tasks are left?', 'You have four open tasks.', {'tool': 'tasks'}, now=now - timedelta(days=1, hours=2))
    store.add_turn(A, 'Help me prepare for the zeppelin defense.', 'Start with the slides, then rehearse twice.', now=now - timedelta(days=1, hours=1))
    store.add_turn(B, 'What did the panel say about load testing?', 'Dr. Lea asked for tests beyond 50 patients.', now=now - timedelta(minutes=30))
    assert store.get(A)['title'] == 'What tasks are left?', store.get(A)['title']
    assert [m['role'] for m in store.history(A)] == ['user', 'assistant', 'user', 'assistant']
    assert store.latest(12, now=now)['id'] == B
    ok('Every exchange is saved on this PC with a short title; a reopened Lin gets the last turns back and the latest conversation to pick up')

    # 2. Recall by period and by topic, and the words that make a recall question.
    start, end, label = C.period('What did we talk about yesterday?', now)
    assert label == 'yesterday' and [r['conversation'] for r in store.find([], start, end)] == [A, A]
    assert [r['question'] for r in store.find(['zeppelin'])] == ['Help me prepare for the zeppelin defense.']
    assert C.period('what did we discuss last week', now)[2] == 'last week'
    assert C.period('what did we talk about 3 days ago', now)[2] == '3 days ago'
    for q in ['What did we talk about yesterday?', 'Did we ever discuss Chapter 4?', 'Remind me what our last conversation was about',
              'what were we talking about', 'where did we leave off', 'What did you tell me about the defense?']:
        assert C.recall_request(q), q
    for q in ['What tasks are left?', 'What did the panel say about load testing?', 'Summarize the harbor report', "What's on today?"]:
        assert not C.recall_request(q), q
    assert C.topic_words('Did we ever talk about the zeppelin defense yesterday?') == ['zeppelin', 'defense']
    ok('“What did we talk about yesterday?” and topic questions find the right turns; ordinary questions are not mistaken for recall')

    # 3. Privacy by voice.
    assert C.privacy_request("Don't save this conversation") == 'on' and C.privacy_request('stop saving') == 'on'
    assert C.privacy_request('Start saving again') == 'off' and C.privacy_request("Don't save the file to my desktop") is None
    store.set_private(P, True)
    assert store.add_turn(P, 'my secret', 'ok') is False and store.get(P)['turns'] == 0
    assert not store.find(['secret'])
    store.set_private(P, False)
    assert store.add_turn(P, 'not secret any more', 'ok', now=now) is True
    ok('“Don’t save this conversation” stops saving it (nothing is written); “start saving again” resumes')

    # 4. Forgetting goes through an approval card, leaves every search at once, and can be undone for 10 minutes.
    assert C.forget_request('Forget this conversation') == 'this' and C.forget_request("forget today's conversations") == 'today'
    assert C.forget_request('delete all my conversations') == 'all' and C.forget_request('forget about it') is None
    actions = ActionStore(tmp, Planner(tmp))
    actions.conversations = store
    proposal = actions.propose('forget_conversations', {'scope': 'yesterday', 'conversation': B}, "forget yesterday's conversations")
    assert proposal['state'] == 'proposed' and proposal['payload']['turns'] == 2, proposal
    assert 'can be undone for 10 minutes' in proposal['description']
    assert store.find(['zeppelin']), 'nothing is forgotten before approval'
    done = actions.approve(proposal['id'], proposal['hash'])
    assert done['state'] == 'executed' and done['result']['forgotten'] == 2 and done['can_undo'], done
    assert not store.find(['zeppelin']) and not store.find([], start, end) and store.get(A) is None
    undone = actions.undo(proposal['id'])
    assert undone['state'] == 'undone' and store.find(['zeppelin']) and store.get(A)['turns'] == 2
    again = actions.propose('forget_conversations', {'scope': 'this', 'conversation': A}, 'forget this conversation')
    actions.approve(again['id'], again['hash'])
    assert store.purge(C.local_now() + timedelta(minutes=11)) > 0
    try:
        actions.undo(again['id']); raise AssertionError('undo after the trash was emptied must fail')
    except Exception as exc:
        assert 'erased for good' in str(exc), exc
    raw = (tmp / 'conversations.sqlite3').read_bytes()
    assert b'zeppelin' not in raw, 'forgotten words are erased from the file (secure delete)'
    try:
        actions.propose('forget_conversations', {'scope': 'yesterday'}, 'forget yesterday')
        raise AssertionError('nothing to forget must be refused')
    except ValueError as exc:
        assert 'nothing saved from yesterday' in str(exc), exc
    ok('Forgetting asks first, removes the turns from every search at once, Undo restores them for 10 minutes, then they are erased from the file')

    # 5. The honesty line says exactly what was searched.
    job = {'question': 'What did we talk about yesterday?', 'checked': {'tool': 'conversations', 'period': 'yesterday', 'topic': '', 'private': 1,
           'items': [{'question': 'x', 'answer': 'y'}]}}
    lines = honesty.for_job(job)
    assert lines[0].startswith('Only our saved conversations from yesterday were searched') and any('private' in l for l in lines), lines
    ok('Every recall answer says which saved conversations were searched, that notes, tasks and calendar were not, and that private chats were never saved')

    # 6. Suggested memories: only facts you stated, with a date or time, and never saved on their own.
    s = C.suggest_memory('My defense is on November 12, can you help me plan?')
    assert s and s['title'] == 'Defense date' and s['fact'] == 'My defense is on November 12.', s
    assert C.suggest_memory('when is my defense?') is None and C.suggest_memory('my favorite color is blue') is None
    assert C.suggest_memory('Remember this: my defense is on November 12') is None
    ok('A dated fact you mention (“my defense is on November 12”) becomes a suggested memory card; questions and undated remarks do not')

    # 7. Summaries wait for a quiet conversation and are cleared when part of it is forgotten.
    store.add_turn(B, 'And what about the slides?', 'Keep them to twelve.', now=now - timedelta(minutes=20))
    item = store.needs_summary(idle_minutes=3, now=now)
    assert item and item['id'] == B and 'Dr. Lea' in item['transcript']
    store.set_summary(B, 'You talked about load testing and the slides.', item['turns'])
    assert store.needs_summary(idle_minutes=3, now=now) is None
    ok('A quiet conversation gets a one-line summary once; it is not summarised again until something new is said')

print(json.dumps({'passed': True, 'checks': checks}, indent=2))
(HERE / 'brain-benchmark').mkdir(exist_ok=True)
(HERE / 'brain-benchmark' / 'conversations-results.json').write_text(json.dumps({'passed': True, 'checks': checks}, indent=2), encoding='utf-8')
