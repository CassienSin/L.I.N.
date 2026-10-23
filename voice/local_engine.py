"""Local-only Lin A speech adapter, shared by benchmarks and the voice prototype."""
import time
from offline import BASE

import numpy as np
import torch
from omnivoice import OmniVoice

REFERENCE_TEXT = "Good morning. Your plan is ready. Let's start with the most important task."

class LocalVoice:
    def __init__(self):
        torch.set_num_threads(2)
        if not torch.cuda.is_available():
            raise RuntimeError('GPU speech is unavailable. No cloud or slow CPU fallback was started.')
        self.device = torch.cuda.get_device_name(0)
        self.dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        started = time.perf_counter()
        self.model = OmniVoice.from_pretrained(
            str(BASE / 'models' / 'omnivoice'), device_map='cuda',
            dtype=self.dtype, load_asr=False, attn_implementation='sdpa',
        ).eval()
        self.prompt = self.model.create_voice_clone_prompt(
            ref_audio=str(BASE / 'auditions' / 'lin-a-english.wav'),
            ref_text=REFERENCE_TEXT,
        )
        torch.cuda.synchronize()
        self.load_seconds = round(time.perf_counter() - started, 3)
        self.sample_rate = self.model.sampling_rate

    def generate(self, text, steps=32, seed=42, design=False):
        torch.manual_seed(seed)
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        started = time.perf_counter()
        args = {'text': text, 'language': 'en', 'num_step': steps, 'speed': .96}
        if design:
            args['instruct'] = 'female, young adult, moderate pitch'
        else:
            args['voice_clone_prompt'] = self.prompt
        with torch.inference_mode():
            wave = np.asarray(self.model.generate(**args)[0], dtype=np.float32).reshape(-1)
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        torch.cuda.empty_cache()  # hand cached graphics memory back so the brain can share the card
        if not np.isfinite(wave).all() or len(wave) < self.sample_rate * .2:
            raise ValueError('Speech generation returned invalid audio')
        peak = float(np.max(np.abs(wave)))
        if peak < .001:
            raise ValueError('Speech generation returned near-silent audio')
        if peak > .95:
            wave *= .95 / peak
        seconds = len(wave) / self.sample_rate
        return wave, {
            'generation_seconds': round(elapsed, 3),
            'audio_seconds': round(seconds, 3),
            'realtime_factor': round(elapsed / seconds, 3),
            'peak_allocated_mb': round(torch.cuda.max_memory_allocated() / 1024**2, 1),
            'steps': steps, 'seed': seed, 'language': 'en',
            'mode': 'voice_design' if design else 'synthetic_A_reference',
        }

    def generate_batch(self, texts, steps=16, seed=42):
        """Several sentences in one GPU pass: about 40% faster than one by one on this card."""
        torch.manual_seed(seed)
        torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            waves = self.model.generate(text=list(texts), language=['en'] * len(texts), voice_clone_prompt=[self.prompt] * len(texts),
                                        num_step=steps, speed=[.96] * len(texts))
        torch.cuda.synchronize()
        share = (time.perf_counter() - started) / len(texts)
        torch.cuda.empty_cache()
        out = []
        for wave in waves:
            wave = np.asarray(wave, dtype=np.float32).reshape(-1)
            if not np.isfinite(wave).all() or len(wave) < self.sample_rate * .2:
                raise ValueError('Speech generation returned invalid audio')
            peak = float(np.max(np.abs(wave)))
            if peak < .001:
                raise ValueError('Speech generation returned near-silent audio')
            if peak > .95:
                wave *= .95 / peak
            seconds = len(wave) / self.sample_rate
            out.append((wave, {'generation_seconds': round(share, 3), 'audio_seconds': round(seconds, 3),
                               'realtime_factor': round(share / seconds, 3), 'steps': steps, 'seed': seed,
                               'language': 'en', 'mode': 'synthetic_A_reference', 'batched': len(texts)}))
        return out
