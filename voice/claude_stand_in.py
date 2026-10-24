"""A stand-in for the `claude` program, for Lin's checks only. It never connects anywhere.
It answers like `claude -p --output-format stream-json --include-partial-messages` and `claude auth status`.
LIN_CLAUDE_STAND_IN (or the file named by LIN_CLAUDE_STAND_IN_FILE) picks the behaviour; LIN_CLAUDE_STAND_IN_LOG records the arguments, the text it was sent and
whether any ANTHROPIC_ setting reached it."""
import json
import os
import sys
import time

mode = os.environ.get('LIN_CLAUDE_STAND_IN')
if not mode and os.environ.get('LIN_CLAUDE_STAND_IN_FILE'):
    try:
        with open(os.environ['LIN_CLAUDE_STAND_IN_FILE'], encoding='utf-8') as f:
            mode = f.read().strip()
    except OSError:
        pass
mode = mode or 'ok'
args = sys.argv[1:]
log = os.environ.get('LIN_CLAUDE_STAND_IN_LOG')


def out(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


if args[:1] == ['--version']:
    print('2.1.300 (Claude Code)')
    sys.exit(0)
if args[:2] == ['auth', 'status']:
    if mode == 'signedout':
        print(json.dumps({'loggedIn': False, 'authMethod': 'none'}))
        sys.exit(1)
    method = 'api_key' if mode == 'apikey' else 'claude.ai'
    print(json.dumps({'loggedIn': True, 'authMethod': method, 'subscriptionType': 'pro', 'configDirectory': '~/.claude'}))
    sys.exit(0)

text = sys.stdin.read()
if log:
    with open(log, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'args': args, 'text': text, 'cwd': os.getcwd(), 'cwd_files': os.listdir('.'),
                            'anthropic_env': sorted(k for k in os.environ if k.upper().startswith('ANTHROPIC_'))}) + '\n')
if mode == 'old' and '--safe-mode' in args:
    sys.stderr.write("error: unknown option '--safe-mode'\n")
    sys.exit(1)
out({'type': 'system', 'subtype': 'init', 'model': 'claude-sonnet-5-5', 'tools': [], 'mcp_servers': []})
if mode == 'hang':
    time.sleep(60)
if mode == 'offline':
    for attempt in (1, 2, 3):
        out({'type': 'system', 'subtype': 'api_retry', 'attempt': attempt, 'max_retries': 10, 'retry_delay_ms': 500,
             'error_status': None, 'error': 'unknown'})
        time.sleep(0.2)
    time.sleep(30)
if mode == 'retry_limit':
    out({'type': 'system', 'subtype': 'api_retry', 'attempt': 1, 'max_retries': 3, 'retry_delay_ms': 1000,
         'error_status': 429, 'error': 'rate_limit'})
    time.sleep(30)
if mode == 'limit':
    out({'type': 'result', 'subtype': 'success', 'is_error': True, 'result': 'Claude AI usage limit reached|%d' % (time.time() + 90)})
    sys.exit(1)
question = text.split('[My question]\n', 1)[-1].strip()
if mode == 'markdown':
    words = ['**Short answer:** yes. ', '\n\n- First, keep it simple. ', '\n- Second, test it. ', 'That is all.']
else:
    words = ['Here is ', 'what I think. ', f'You asked about {question[:60]}. ', 'Start small, ', 'then build up.']
if mode == 'slow':
    time.sleep(1.5)
answer = ''
for w in words:
    answer += w
    out({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': w}}})
    time.sleep(0.02)
out({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': answer}]}})
if mode == 'cut':
    sys.exit(1)
out({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': answer, 'total_cost_usd': 0.0, 'usage': {}})
