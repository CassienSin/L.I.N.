"""Checks for Lin's MCP client: connection, tool listing, calls, policies, approvals and failure handling.
Uses the built-in test server (mcp_servers/lin_test_server.py); nothing is downloaded."""
from pathlib import Path
import json
import os
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mcp_client
from actions import ActionStore, receipt_answer
from brain import Conflict
from planner import Planner

TEST = str(HERE / 'mcp_servers' / 'lin_test_server.py')
checks = []


def wait(manager, name, states=('ready', 'error'), seconds=20):
    end = time.time() + seconds
    while time.time() < end:
        s = next((x for x in manager.status()['servers'] if x['name'] == name), None)
        if s and s['state'] in states:
            return s
        time.sleep(.05)
    raise AssertionError(f'{name} stayed {s and s["state"]}')


(HERE / 'runtime').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='mcp-test-', dir=HERE / 'runtime') as tmp:
    tmp = Path(tmp)
    m = mcp_client.Manager(tmp / 'data', tmp / 'logs')
    try:
        st = m.save_server(0, 'lin-test', {'command': sys.executable, 'args': [TEST]})
        s = wait(m, 'lin-test')
        assert s['state'] == 'ready', s
        assert [t['name'] for t in s['tools']] == ['add_numbers', 'word_count', 'save_note'] and all(t['policy'] == 'ask' for t in s['tools'])
        assert s['info']['name'] == 'lin-test' and json.loads((tmp / 'data' / 'mcp.json').read_text())['revision'] == 1
        checks.append('Starts a stdio MCP server, completes the handshake and lists its tools; new tools default to Ask first')

        assert m.call('lin-test', 'add_numbers', {'a': 2, 'b': 3}) == '5'
        assert m.call('lin-test', 'word_count', {'text': 'one two three'}) == '3 words'
        try:
            m.call('lin-test', 'missing_tool', {})
            raise AssertionError('error result accepted')
        except mcp_client.MCPError as exc:
            assert 'reported an error' in str(exc)
        checks.append('Calls tools and returns their text; tool errors surface as errors, not answers')

        avail = m.available()
        top = mcp_client.shortlist('add 2 and 3 please', avail)
        assert top and top[0][2]['name'] == 'add_numbers', top
        assert mcp_client.shortlist('count the words in this sentence', avail)[0][2]['name'] == 'word_count'
        assert mcp_client.shortlist('how are you today?', avail) == []
        assert mcp_client.shortlist('what is on my calendar tomorrow', avail) == []
        schema = mcp_client.pick_schema(top)
        assert schema['properties']['tool']['enum'] == ['none', 'lin-test.add_numbers']
        checks.append('Only requests that match a connected tool are offered to it; ordinary chat and built-in questions are not')

        assert mcp_client.check_arguments({'properties': {'a': {'type': 'number'}}, 'required': ['a']}, {'a': 1}) == {'a': 1}
        for bad in [{}, {'a': 'x'}, {'a': True}, {'a': 1, 'pad': 'x' * 5000}]:
            try:
                mcp_client.check_arguments({'properties': {'a': {'type': 'number'}}, 'required': ['a']}, bad)
                raise AssertionError(f'accepted {bad}')
            except ValueError:
                pass
        deep = mcp_client.sanitize_schema({'type': 'object', 'properties': {'q': {'type': ['string', 'null'], 'pattern': '.*', 'format': 'uri'},
                                           'n': {'type': 'array'}}, 'additionalProperties': True, '$ref': '#/x'})
        assert deep == {'type': 'object', 'properties': {'q': {'type': 'string', 'maxLength': 500},
                        'n': {'type': 'array', 'items': {'type': 'string', 'maxLength': 500}, 'maxItems': 20}}, 'required': []}, deep
        checks.append('Model-written arguments are checked against the tool schema; schemas are reduced to a bounded, grammar-safe subset')

        planner = Planner(tmp / 'data')
        store = ActionStore(tmp / 'data', planner)
        store.mcp = m
        action = store.propose('mcp', {'server': 'lin-test', 'tool': 'save_note', 'arguments': {'title': 'Lin MCP check', 'text': 'hello'}}, 'save a test note')
        note = HERE / 'runtime' / 'mcp-test-notes' / 'Lin MCP check.txt'
        if note.exists():
            note.unlink()
        assert action['state'] == 'proposed' and 'Run save_note from lin-test' in action['description'] and not note.exists()
        done = store.approve(action['id'], action['hash'])
        assert done['state'] == 'executed' and done['result']['text'].startswith('Saved') and note.read_text() == 'hello'
        assert receipt_answer(done).startswith('Done. save_note says: Saved')
        try:
            store.approve(action['id'], action['hash'])
            raise AssertionError('approved twice')
        except Conflict:
            pass
        note.unlink()
        checks.append('A tool call becomes an approval card; nothing runs before approval, it runs exactly once after, and the receipt keeps the output')

        m.set_policy(m.config['revision'], 'lin-test', 'save_note', 'off')
        assert 'save_note' not in [t['name'] for _, t in m.available()]
        try:
            store.propose('mcp', {'server': 'lin-test', 'tool': 'save_note', 'arguments': {'title': 'x', 'text': 'y'}}, 'x')
            raise AssertionError('off tool proposed')
        except ValueError:
            pass
        try:
            m.call('lin-test', 'save_note', {'title': 'x', 'text': 'y'})
            raise AssertionError('off tool ran')
        except mcp_client.MCPError:
            pass
        try:
            m.set_policy(0, 'lin-test', 'add_numbers', 'auto')
            raise AssertionError('stale revision accepted')
        except Conflict:
            pass
        checks.append('Off hides a tool from Lin and refuses it even if asked directly; stale Tools edits are refused')

        for name, spec in [('Bad Name!', {'command': 'x'}), ('ok', {'command': ''}), ('ok', {'command': 'x', 'args': ['a' * 501]}),
                           ('ok', {'command': 'x', 'env': {'BAD-KEY': 'v'}}), ('ok', {'command': 'x', 'cwd': str(tmp / 'nope')})]:
            try:
                m.save_server(m.config['revision'], name, spec)
                raise AssertionError(f'accepted {name} {spec}')
            except ValueError:
                pass
        checks.append('Server settings are validated: names, command, argument and environment limits, working folder')

        rev = m.config['revision']
        m.save_server(rev, 'poison', {'command': sys.executable, 'args': [TEST], 'env': {'LIN_TEST_POISON': '1', 'LIN_TEST_BIG': '1'}})
        s = wait(m, 'poison')
        flagged = [t for t in s['tools'] if t['flag']]
        assert [t['name'] for t in flagged] == ['weather_lookup']
        prompt = mcp_client.pick_prompt([(5, 'poison', next(t for _, t in m.available() if t['name'] == 'weather_lookup'))])
        assert 'Ignore previous' not in prompt and 'description hidden' in prompt
        big = m.call('poison', 'word_count', {'text': 'x'})
        assert len(big) < mcp_client.MAX_RESULT + 100 and 'more characters not shown' in big
        checks.append('A tool description that tries to instruct Lin is flagged and never shown to the model; huge results are cut to a bounded size')

        m.save_server(m.config['revision'], 'crashy', {'command': sys.executable, 'args': [TEST], 'env': {'LIN_TEST_CRASH': '1'}})
        wait(m, 'crashy')
        started = time.time()
        try:
            m.call('crashy', 'add_numbers', {'a': 1, 'b': 1})
            raise AssertionError('crash not reported')
        except mcp_client.MCPError:
            pass
        assert time.time() - started < 5
        s = wait(m, 'crashy', states=('error',))
        assert 'stopped unexpectedly' in s['error']
        m.save_server(m.config['revision'], 'missing', {'command': 'lin-no-such-program-xyz'})
        s = wait(m, 'missing', states=('error',))
        assert 'could not find' in s['error']
        checks.append('A server that crashes mid-call or cannot start reports a clear error within seconds instead of hanging Lin')

        m.close()
        m2 = mcp_client.Manager(tmp / 'data', tmp / 'logs')
        assert sorted(m2.config['servers']) == ['crashy', 'lin-test', 'missing', 'poison'] and m2.policy('lin-test', 'save_note') == 'off'
        m2.remove_server(m2.config['revision'], 'missing')
        assert 'missing' not in m2.config['servers']
        m2.close()
        checks.append('Tools settings survive restarting Lin; removing a server forgets it')
    finally:
        m.close()

out = HERE / 'brain-benchmark' / 'mcp-results.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'passed': True, 'checks': checks}, indent=2), encoding='utf-8')
print(json.dumps({'passed': True, 'checks': checks}, indent=2))
