"""Public synthetic evaluation prompts only; no microphone or user documents."""
import json
from pathlib import Path
import socket
import time
from reasoner import LocalReasoner

def main():
    engine = LocalReasoner()
    rows = []
    try:
        history=[]
        for prompt in [
            'Hello Lin. What can you help me with today?',
            'I have 30 minutes to prepare a client proposal and tidy my desk. Help me choose what to do first.',
            'Please check my calendar and tell me my next meeting.',
        ]:
            answer, seconds = engine.answer(prompt, [], lambda:False)
            rows.append({'prompt':prompt,'answer':answer,'seconds':seconds})
            print(json.dumps(rows[-1]), flush=True)
        first, seconds = engine.answer('For this conversation, my example project is called Lantern. Reply in one sentence.', [], lambda:False)
        history = [{'role':'user','content':'My example project is called Lantern.'}, {'role':'assistant','content':first}]
        answer, seconds = engine.answer('What is my example project called?', history, lambda:False)
        assert 'lantern' in answer.lower(), answer
        rows.append({'prompt':'Session recall','answer':answer,'seconds':seconds})
        for address in [('example.com',443), ('127.0.0.1',1), ('::1',engine.port)]:
            try:
                socket.create_connection(address, timeout=.1)
                raise AssertionError('Unexpected outbound access')
            except RuntimeError:
                pass
        target = Path(__file__).parent/'reasoning-benchmark'
        target.mkdir(exist_ok=True)
        (target/'results.json').write_text(json.dumps({'load_seconds':engine.load_seconds, 'runs':rows, 'outbound_guard':'passed'},indent=2),encoding='utf-8')
        print('Recall and outbound guard passed.',flush=True)
    finally:
        engine.close()

if __name__ == '__main__':
    main()
