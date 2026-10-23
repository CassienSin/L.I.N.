import io
import json
import time
from pathlib import Path
from transcriber import LocalTranscriber, decode_recording
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

base=Path(__file__).resolve().parent
out=base/'transcription-benchmark'
out.mkdir(exist_ok=True)
model=LocalTranscriber()
results={'engine':'faster-whisper base.en','device':'cpu','compute_type':'int8','load_seconds':model.load_seconds,'runs':[]}
for name in ['segment-1','segment-2','segment-3']:
    data=(base/'gpu-benchmark'/f'{name}.wav').read_bytes()
    result=model.transcribe(data)
    results['runs'].append({'source':name,**result})
    print(json.dumps(result),flush=True)
silence=io.BytesIO();sf.write(silence,np.zeros(16000),16000,format='WAV',subtype='PCM_16')
assert model.transcribe(silence.getvalue())['no_speech']
too_long=io.BytesIO();sf.write(too_long,np.zeros(16000*31),16000,format='WAV',subtype='PCM_16')
for invalid in [b'not audio',too_long.getvalue(),b'x'*(2*1024*1024+1)]:
    try:decode_recording(invalid)
    except ValueError:pass
    else:raise AssertionError('Invalid audio accepted')
results['checks']=['Silence returns no transcript','Malformed, oversized and overlong audio rejected']
(out/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
# Browser fake microphone fixture, made only from Lin's existing synthetic clip.
audio,sr=sf.read(base/'gpu-benchmark'/'segment-2.wav',dtype='float32')
fixture=np.concatenate([np.zeros(48000//2),resample_poly(audio,48000,sr),np.zeros(48000)])
sf.write(out/'microphone-fixture.wav',fixture,48000,subtype='PCM_16')
print('Transcription benchmark and synthetic microphone fixture ready.',flush=True)
