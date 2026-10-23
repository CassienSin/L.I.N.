"""Check the new native transport boundary using no user prompts."""
import json
import socket
from offline import BASE
from reasoner import LocalReasoner

engine = LocalReasoner()
try:
    connection = engine.connection()
    connection.request('POST','/v1/chat/completions',body=b'{}',headers={'Content-Type':'application/json'})
    response = connection.getresponse()
    assert response.status == 401, response.status
    response.read()
    connection.close()
    for address in [('example.com',443),('127.0.0.1',1),('::1',engine.port)]:
        try:
            socket.create_connection(address,timeout=.1)
            raise AssertionError('Unexpected outbound access')
        except RuntimeError:
            pass
finally:
    engine.close()
assert engine.process.poll() is not None
try:
    socket.create_connection(('127.0.0.1',engine.port),timeout=.1)
    raise AssertionError('Allowance was not revoked')
except RuntimeError:
    pass
result = {'passed':True,'checks':['Native inference rejects missing API key','Only the exact assigned loopback endpoint is allowed','Native child exits and loopback allowance is revoked on close']}
(BASE/'reasoning-benchmark'/'transport-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
