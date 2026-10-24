"""Checks for Claude as the online brain (no model, voice or internet needed): a stand-in plays Claude Code
(claude_stand_in.py), so nothing ever leaves this PC and your Claude plan is never used."""
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cloud_brain as C
import honesty
from actions import ActionStore
from brain import Conflict
from planner import Planner
from reasoner import Cancelled

checks = []
def ok(name):
    checks.append(name)

STAND_IN = [sys.executable, str(HERE / 'claude_stand_in.py')]

with tempfile.TemporaryDirectory(prefix='claude-test-') as tmp:
    tmp = Path(tmp)
    log = tmp / 'sent.jsonl'
    os.environ['LIN_CLAUDE_STAND_IN_LOG'] = str(log)
    os.environ['ANTHROPIC_API_KEY'] = 'a-key-that-must-never-reach-claude-code'
    os.environ['ANTHROPIC_BASE_URL'] = 'https://example.invalid'
    os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = 'a-copied-token'
    def mode(m):
        os.environ['LIN_CLAUDE_STAND_IN'] = m
    brain = C.ClaudeBrain(tmp / 'data', tmp / 'runtime', command=STAND_IN)

    # 1. Off until you turn it on; settings are saved on this PC.
    assert brain.settings() == {'mode': 'off', 'model': 'sonnet'}
    assert brain.save_settings('ask', 'opus') == {'mode': 'ask', 'model': 'opus'} and brain.settings()['mode'] == 'ask'
    for bad in [('sometimes', None), (None, 'gpt')]:
        try:
            brain.save_settings(*bad); raise AssertionError('bad setting accepted')
        except ValueError:
            pass
    brain.save_settings('ask', 'sonnet')
    ok('Claude is off until you choose Ask me first or Claude for conversation; the choice and the model are saved on this PC')

    # 2. Sign-in: only a Claude plan sign-in is used; signed out, API keys and copied tokens are refused.
    mode('ok')
    st = brain.check(force=True)
    assert st['installed'] and st['plan'] and st['method'] == 'claude.ai' and 'Signed in with your Claude plan (Pro)' in st['message'], st
    assert brain.summary()['ready'] and brain.unavailable_reason() is None
    mode('signedout'); st = brain.check(force=True)
    assert not st['plan'] and 'run claude auth login' in st['message'] and brain.unavailable_reason()[0] == 'signin'
    mode('apikey'); st = brain.check(force=True)
    assert not st['plan'] and 'API key, not your Claude plan' in st['message'] and brain.unavailable_reason()[0] == 'plan'
    missing = C.ClaudeBrain(tmp / 'data2', tmp / 'runtime2', command=None)
    missing.find = lambda: None
    assert missing.check(force=True)['installed'] is False and missing.unavailable_reason()[0] == 'missing'
    mode('ok'); brain.check(force=True)
    ok('Lin uses Claude only when `claude auth status` says it is signed in with your Claude plan; signed out, an API key or a missing install are refused with what to do')

    # 3. What runs: print mode, every tool, MCP server, skill and saved session off, an empty folder, no keys or tokens.
    got = []
    last = {'question': 'What is a load balancer?', 'answer': 'It spreads requests across servers.'}
    text = C.build_prompt('How do I test one for 500 users?', last)
    result = brain.ask(text, lambda s: got.append(s) or True, lambda: False, context=True)
    sent = json.loads(log.read_text().splitlines()[-1])
    a = sent['args']
    for flag in ['-p', '--no-session-persistence', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands']:
        assert flag in a, flag
    assert a[a.index('--tools') + 1] == '' and a[a.index('--disallowedTools') + 1] == '*'
    assert a[a.index('--output-format') + 1] == 'stream-json' and '--include-partial-messages' in a and '--verbose' in a
    assert a[a.index('--max-turns') + 1] == '1' and a[a.index('--permission-mode') + 1] == 'dontAsk' and a[a.index('--model') + 1] == 'sonnet'
    identity = Path(a[a.index('--system-prompt-file') + 1]).read_text(encoding='utf-8')
    assert 'You have no tools here' in identity and 'read aloud' in identity
    assert sent['text'] == text and sent['text'].startswith('[Our last exchange, for context]\nMe: What is a load balancer?')
    assert sent['anthropic_env'] == [] and sent['cwd_files'] == [], sent
    assert 'CLAUDE_CODE_OAUTH_TOKEN' not in C.ClaudeBrain.env() and 'ANTHROPIC_API_KEY' not in C.ClaudeBrain.env()
    ok('Claude Code runs in print mode with no tools, no MCP servers, no skills or hooks, nothing saved, in an empty folder, and with no API key, token or proxy setting passed on')

    # 4. The answer streams sentence by sentence, exactly the text you approved was sent, and nothing else is logged.
    assert got == ['Here is what I think.', 'You asked about How do I test one for 500 users?.', 'Start small, then build up.'], got
    assert result['answer'] == ' '.join(got) and result['model'] == 'claude-sonnet-5-5'
    rows = [json.loads(l) for l in (tmp / 'data' / 'claude-sent.jsonl').read_text().splitlines()]
    assert rows[-1]['outcome'] == 'answered' and rows[-1]['chars'] == len(text) and 'text' not in rows[-1] and 'question' not in rows[-1]
    assert brain.sent_this_week() == 1
    mode('markdown'); got = []
    brain.ask('[My question]\nx', lambda s: got.append(s) or True, lambda: False)
    assert got == ['Short answer: yes.', 'First, keep it simple.', 'Second, test it.', 'That is all.'], got
    got = []
    mode('ok'); brain.ask('[My question]\nx', lambda s: (got.append(s), False)[1], lambda: False)
    assert len(got) == 1, 'returning False stops the answer'
    ok('Claude’s answer reaches Lin’s voice one sentence at a time (Markdown cleaned for speech); the send log keeps only sizes and outcomes, never the words')

    # 5. Usage limits, sign-in loss, no internet and a stuck Claude Code are each recognised.
    def fails(m, kind, **kw):
        mode(m)
        t = time.monotonic()
        try:
            brain.ask('[My question]\nx', lambda s: True, lambda: False, **kw)
        except C.Unavailable as exc:
            assert exc.kind == kind, (m, exc.kind, exc.message)
            return exc, time.monotonic() - t
        raise AssertionError(f'{m} should fail')
    exc, _ = fails('limit', 'limit')
    assert 'until about' in exc.message and brain.summary()['limited'] and not brain.summary()['ready']
    assert brain.unavailable_reason()[0] == 'limit'
    brain.limited_until = 0
    fails('retry_limit', 'limit'); brain.limited_until = 0
    _, took = fails('offline', 'offline'); assert took < 5, took
    _, took = fails('hang', 'slow', first_timeout=2); assert took < 4, took
    mode('ok'); brain.check(force=True)
    ok('A usage limit (with its reset time), a rate limit, no internet and a stuck Claude Code are recognised in seconds, so Lin can answer on this PC instead')

    # 6. An older Claude Code without the newer options still works; Interrupt stops Claude at once.
    mode('old'); brain.dropped.clear()
    assert brain.ask('[My question]\nx', lambda s: True, lambda: False)['answer'] and '--safe-mode' in brain.dropped
    brain.dropped.clear()
    mode('hang'); stop = threading.Event()
    threading.Timer(0.6, stop.set).start()
    t = time.monotonic()
    try:
        brain.ask('[My question]\nx', lambda s: True, stop.is_set)
        raise AssertionError('should stop')
    except Cancelled:
        pass
    assert time.monotonic() - t < 2.5 and brain.proc is None
    mode('ok')
    ok('An older Claude Code that lacks an option still answers; pressing Interrupt stops Claude Code within a second')

    # 7. Which questions are offered to Claude.
    for q in ['Explain how a load balancer spreads traffic across servers, step by step',
              'Compare the pros and cons of SQL and NoSQL for a small clinic app', 'Write me a cover letter for a junior developer job',
              'Can you debug this Python function that keeps returning None?', 'x ' * 130]:
        assert C.needs_claude(q), q
    for q in ['hi', 'What tasks are left?', 'What time is my rehearsal?', 'Thanks Lin', 'How are you today?']:
        assert not C.needs_claude(q), q
    assert C.explicit_request('Ask Claude what the tallest mountain in Africa is') == (True, 'what the tallest mountain in Africa is')
    assert C.explicit_request('Hey Lin, ask Claude about black holes') == (True, 'black holes')
    assert C.explicit_request('Send this to Claude') == (True, '') and C.explicit_request('ask Claude instead') == (True, '')
    assert C.explicit_request('What is a monad? Ask Claude.') == (True, 'What is a monad?')
    assert C.explicit_request('What did Claude say yesterday?')[0] is False
    assert C.is_small_talk('thanks') and not C.is_small_talk('Thanks, what should I study first?')
    ok('Ask me first offers hard questions (explain, compare, write, code, long text) and keeps quick ones here; “ask Claude …” and “send this to Claude” always work')

    # 8. "Send to Claude?" is an approval card: one send of exactly that text, in that conversation, within 10 minutes.
    actions = ActionStore(tmp, Planner(tmp))
    conv = 'c' * 32
    payload = {'question': 'How do I test one for 500 users?', 'text': text, 'context': last, 'conversation': conv, 'model': 'sonnet'}
    offer = actions.propose('send_to_claude', payload, 'How do I test one for 500 users?')
    assert offer['state'] == 'proposed' and offer['payload']['label'] == 'Sonnet' and offer['payload']['text'] == text
    assert 'our last exchange, nothing else' in offer['description']
    try:
        actions.consume(offer['id'], conv); raise AssertionError('not approved yet')
    except Conflict:
        pass
    done = actions.approve(offer['id'], offer['hash'])
    assert done['state'] == 'executed' and not done['can_undo']
    try:
        actions.consume(offer['id'], 'd' * 32); raise AssertionError('other conversation')
    except Conflict:
        pass
    assert actions.consume(offer['id'], conv)['text'] == text
    try:
        actions.consume(offer['id'], conv); raise AssertionError('used twice')
    except Conflict as exc:
        assert 'already sent' in str(exc)
    declined = actions.propose('send_to_claude', payload, 'again')
    actions.reject(declined['id'])
    try:
        actions.consume(declined['id'], conv); raise AssertionError('declined')
    except Conflict:
        pass
    for bad in [{**payload, 'text': ''}, {**payload, 'model': 'gpt'}, {**payload, 'text': 'x' * 5000}]:
        try:
            actions.propose('send_to_claude', bad, 'x'); raise AssertionError('bad payload accepted')
        except ValueError:
            pass
    ok('“Send to Claude?” sends nothing until approved, then allows exactly one send of exactly that text, in that conversation; Answer on this PC sends nothing')

    # 9. Honest lines.
    lines = honesty.for_job({'question': 'q', 'checked': {'tool': 'claude', 'text': text}})
    assert lines[0].startswith('Claude saw only the text on this card') and 'Lin did not check this answer' in lines[1]
    lines = honesty.for_job({'question': 'q', 'checked': {'tool': 'claude', 'fallback': 'Your Claude usage limit is reached.'}})
    assert lines[0].startswith('Your Claude usage limit is reached. So Lin answered on this PC')
    lines = honesty.for_job({'question': 'q', 'action': {'tool': 'send_to_claude'}})
    assert lines == ['Nothing has been sent to Claude. It waits for you, and only the text on the card would be sent.']
    ok('Every Claude answer says Claude saw only the text on the card and that Lin did not check it; a fallback says why Lin answered here instead')

# 10. A hard question is offered to Claude ahead of a connected tool that only shares a word with it.
import server
tools = [(9, 'ghidra', {'name': 'load_program', 'title': '', 'description': 'Load a binary and list the servers it contacts', 'flag': False})]
assert not server.strong_tool_match('Can you explain how a load balancer works step by step?', tools)
assert server.strong_tool_match('Use Ghidra to explain this program step by step', tools)
assert server.strong_tool_match('Load program sample.exe and explain it', tools)
ok('A hard question goes to “Send to Claude?” first unless it names a connected tool or its server; when no tool fits after all, Claude is still offered')

out = {'passed': True, 'checks': checks}
print(json.dumps(out, indent=2))
(HERE / 'brain-benchmark').mkdir(exist_ok=True)
(HERE / 'brain-benchmark' / 'claude-unit-results.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
