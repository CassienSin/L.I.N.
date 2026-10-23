"""Validate the recovery action without opening any browser or microphone."""
import http.client
import json
from pathlib import Path
import sys
import threading
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'voice'))
import server

httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
httpd.expected_host=f'127.0.0.1:{httpd.server_port}'
threading.Thread(target=httpd.serve_forever,daemon=True).start()
def post(body,token=server.TOKEN):
    connection=http.client.HTTPConnection('127.0.0.1',httpd.server_port,timeout=5)
    connection.request('POST','/api/open-browser',json.dumps(body),{'X-Lin-Token':token,'Content-Type':'application/json'})
    response=connection.getresponse();status=response.status;response.read();connection.close();return status
try:
    with patch.object(server.os,'startfile') as opened:
        assert post({},'invalid')==401
        assert post({'url':'https://example.com'})==400
        opened.assert_not_called()
        assert post({})==200
        opened.assert_called_once_with(f'http://{httpd.expected_host}/#token={server.TOKEN}')
    with patch.object(server.os,'startfile',side_effect=OSError('unavailable')):
        assert post({})==500
    print('Recovery action: authentication, fixed local URL, injected URL rejection and launch failure checks passed.')
finally:
    httpd.shutdown();httpd.server_close()
