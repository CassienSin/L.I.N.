"""Bounded, in-memory English transcription on the local GPU (CPU if the GPU is unavailable); no cloud fallback."""
from offline import BASE
import io
import time
import importlib.util
import os
import av
import numpy as np
from faster_whisper import WhisperModel

MAX_SECONDS = 30
MAX_BYTES = 2 * 1024 * 1024
SAMPLE_RATE = 16000

def decode_recording(data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError('The recording is empty or too large.')
    frames, count = [], 0
    try:
        with av.open(io.BytesIO(data), options={'format_whitelist':'matroska,webm,wav,ogg'}) as container:
            if not container.streams.audio:
                raise ValueError('No audio track was found.')
            resampler = av.AudioResampler(format='s16', layout='mono', rate=SAMPLE_RATE)
            for frame in container.decode(audio=0):
                for output in resampler.resample(frame):
                    values = output.to_ndarray().reshape(-1)
                    count += len(values)
                    if count > (MAX_SECONDS + .5) * SAMPLE_RATE:
                        raise ValueError('Keep recordings to 30 seconds or less.')
                    frames.append(values)
            for output in resampler.resample(None):
                values = output.to_ndarray().reshape(-1)
                count += len(values)
                frames.append(values)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('This recording could not be decoded. Please record again.') from exc
    if count < .2 * SAMPLE_RATE:
        raise ValueError('That recording was too short. Please try again.')
    if count > (MAX_SECONDS + .5) * SAMPLE_RATE:
        raise ValueError('Keep recordings to 30 seconds or less.')
    return np.concatenate(frames).astype(np.float32) / 32768.0

class LocalTranscriber:
    def __init__(self):
        started = time.perf_counter()
        path = str(BASE/'models'/'faster-whisper-base.en')
        # Speed lab: about 6x faster on the graphics card (0.27 s vs 1.6 s per short turn).
        # The CUDA libraries come from the local torch install; nothing is downloaded.
        try:
            torch_lib = os.path.join(importlib.util.find_spec('torch').submodule_search_locations[0], 'lib')
            if os.path.isdir(torch_lib):
                os.add_dll_directory(torch_lib)
            self.model = WhisperModel(path, device='cuda', compute_type='float16', num_workers=1, local_files_only=True)
            list(self.model.transcribe(np.full(16000, .01, dtype=np.float32), language='en', beam_size=1)[0])
            self.device = 'cuda'
        except Exception:
            self.model = WhisperModel(path, device='cpu', compute_type='int8', cpu_threads=4,
                                      num_workers=1, local_files_only=True)
            self.device = 'cpu'
        self.load_seconds = round(time.perf_counter()-started,3)

    def transcribe(self, data):
        started = time.perf_counter()
        audio = decode_recording(data)
        if np.max(np.abs(audio)) < .002:
            segments = []
        else:
            segments, _ = self.model.transcribe(
                audio, language='en', beam_size=5, condition_on_previous_text=False,
                vad_filter=True, vad_parameters={'min_silence_duration_ms':400},
                temperature=0, no_speech_threshold=.6,
            )
            segments = list(segments)
        text = ' '.join(segment.text.strip() for segment in segments).strip()
        return {'text':text,'language':'en','audio_seconds':round(len(audio)/SAMPLE_RATE,3),
                'transcription_seconds':round(time.perf_counter()-started,3),
                'segments':[{'start':round(s.start,3),'end':round(s.end,3),'text':s.text.strip()} for s in segments],
                'no_speech':not bool(text)}
