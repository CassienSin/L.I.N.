"""Shared application-level offline guard; this does not replace an OS firewall."""
import os
from pathlib import Path
import socket

BASE = Path(__file__).resolve().parent
os.environ.update({
    'HF_HUB_OFFLINE':'1', 'TRANSFORMERS_OFFLINE':'1',
    'HF_HUB_DISABLE_TELEMETRY':'1', 'GRADIO_ANALYTICS_ENABLED':'False',
    'TOKENIZERS_PARALLELISM':'false',
    'HF_HOME':str(BASE.parent/'.cache'/'huggingface'),
    'TORCH_HOME':str(BASE.parent/'.cache'/'torch'),
})
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex
_create_connection = socket.create_connection
_local_endpoint = None

def allow_reasoning_endpoint(port):
    """One service-owned loopback endpoint, never a URL supplied by a request."""
    global _local_endpoint
    _local_endpoint = ('127.0.0.1', port) if port else None

def block_outbound(*args, **kwargs):
    raise RuntimeError('Outbound network connections are disabled in the Lin voice process')

def connect(sock, address):
    if address != _local_endpoint:
        return block_outbound()
    return _connect(sock, address)

def connect_ex(sock, address):
    if address != _local_endpoint:
        return block_outbound()
    return _connect_ex(sock, address)

def create_connection(address, *args, **kwargs):
    if address != _local_endpoint:
        return block_outbound()
    return _create_connection(address, *args, **kwargs)

socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
socket.create_connection = create_connection
