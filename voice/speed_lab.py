"""Speed lab: measures where Lin's time goes on this computer (voice steps, CPU contention,
reasoning threads, transcription device). Writes voice/speed-lab/results.json and sample WAVs.
Run with Lin closed: design/Run-SpeedLab.cmd"""
from offline import BASE
import json, subprocess, sys, time, traceback
from pathlib import Path

OUT = BASE / 'speed-lab'
OUT.mkdir(exist_ok=True)
LOG = BASE / 'runtime' / 'speed-lab.log'
results = {'date': time.strftime('%Y-%m-%d %H:%M:%S')}
def log(m):
    line = f"{time.strftime('%H:%M:%S')} {m}"
    print(line, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')
def save():
    (OUT / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')

RT = BASE / 'models' / 'reasoning' / 'runtime'
MODEL = BASE / 'models' / 'reasoning' / 'Qwen3-4B-Q4_K_M.gguf'
def busy_cpu(threads=6):
    # Simulates Lin writing the next sentence while the voice speaks the first one.
    return subprocess.Popen([str(RT / 'llama-bench.exe'), '-m', str(MODEL), '-t', str(threads), '-p', '0', '-n', '4096', '-r', '20'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)

LOG.write_text('', encoding='utf-8')
try:
    # 1. Reasoning threads.
    log('Reasoning: measuring threads 4, 6, 8 (prompt reading and writing speed)…')
    try:
        r = subprocess.run([str(RT / 'llama-bench.exe'), '-m', str(MODEL), '-t', '4,6,8', '-p', '256', '-n', '64', '-r', '2', '-o', 'json'],
                           capture_output=True, text=True, timeout=900, creationflags=subprocess.CREATE_NO_WINDOW)
        rows = json.loads(r.stdout)
        results['reasoning'] = [{'threads': x['n_threads'], 'prompt': x['n_prompt'], 'gen': x['n_gen'], 'tokens_per_second': round(x['avg_ts'], 2)} for x in rows]
        log('Reasoning: ' + json.dumps(results['reasoning']))
    except Exception as exc:
        results['reasoning_error'] = repr(exc); log('Reasoning failed: ' + repr(exc))
    save()

    # 2. Voice.
    import numpy as np, torch, soundfile as sf
    from local_engine import LocalVoice
    log('Voice: loading…')
    voice = LocalVoice()
    texts = {'short': 'You have no open tasks right now.',
             'medium': 'Start with the client proposal, then use the last five minutes to tidy your desk.'}
    voice.generate('Warming up the voice.', steps=8)
    rows = []
    def run(label, steps, busy, threads, save_wav=False):
        torch.set_num_threads(threads)
        p = busy_cpu() if busy else None
        try:
            if p: time.sleep(4)
            for name, text in texts.items():
                best = None
                for _ in range(2):
                    wave, m = voice.generate(text, steps=steps)
                    best = m if best is None or m['generation_seconds'] < best['generation_seconds'] else best
                rows.append({'label': label, 'text': name, 'steps': steps, 'cpu_busy': busy, 'torch_threads': threads,
                             'generation_seconds': best['generation_seconds'], 'audio_seconds': best['audio_seconds']})
                log(f"Voice {label} {name}: {best['generation_seconds']} s for {best['audio_seconds']} s audio")
                if save_wav and name == 'medium':
                    sf.write(OUT / f'steps-{steps}.wav', wave, voice.sample_rate, subtype='PCM_16')
        finally:
            if p: p.kill()
    run('32 idle', 32, False, 6, True)
    run('32 busy', 32, True, 6)
    run('32 busy t2', 32, True, 2)
    for s in (16, 12, 8):
        run(f'{s} busy t2', s, True, 2, True)
    run('16 idle t2', 16, False, 2)
    results['voice'] = rows; save()

    # Batched sentences: the rest of an answer in one call instead of one by one.
    torch.set_num_threads(2)
    rest = ['That keeps the important work first.', 'Your desk only needs a quick reset.', 'Tell me when you start and I will keep time.']
    t = time.perf_counter()
    for x in rest: voice.generate(x, steps=16)
    one_by_one = time.perf_counter() - t
    t = time.perf_counter()
    with torch.inference_mode():
        waves = voice.model.generate(text=rest, language=['en'] * 3, voice_clone_prompt=[voice.prompt] * 3, num_step=16, speed=[.96] * 3)
    torch.cuda.synchronize(); batched = time.perf_counter() - t
    results['voice_batch'] = {'sentences': 3, 'steps': 16, 'one_by_one_seconds': round(one_by_one, 3), 'batched_seconds': round(batched, 3),
                              'audio_seconds': round(sum(len(w) for w in waves) / voice.sample_rate, 3)}
    log('Voice batch: ' + json.dumps(results['voice_batch'])); save()
    del voice; torch.cuda.empty_cache()

    # 3. Transcription device and beam size.
    from faster_whisper import WhisperModel
    import torchaudio
    clips = []
    for i in (1, 2, 3):
        w, sr = sf.read(str(BASE / 'gpu-benchmark' / f'segment-{i}.wav'), dtype='float32')
        clips.append(torchaudio.functional.resample(torch.from_numpy(w), sr, 16000).numpy())
    rows = []
    for device, ctype in (('cpu', 'int8'), ('cuda', 'float16')):
        try:
            m = WhisperModel(str(BASE / 'models' / 'faster-whisper-base.en'), device=device, compute_type=ctype, cpu_threads=4, local_files_only=True)
            list(m.transcribe(clips[0], language='en', beam_size=1)[0])
            for beam in (5, 1):
                t = time.perf_counter(); texts_out = []
                for c in clips:
                    segs, _ = m.transcribe(c, language='en', beam_size=beam, condition_on_previous_text=False, vad_filter=True, temperature=0)
                    texts_out.append(' '.join(s.text.strip() for s in segs))
                rows.append({'device': device, 'beam': beam, 'seconds_for_3_clips': round(time.perf_counter() - t, 3), 'texts': texts_out})
                log(f'Transcription {device} beam {beam}: {rows[-1]["seconds_for_3_clips"]} s for 3 clips')
            del m
        except Exception as exc:
            rows.append({'device': device, 'error': repr(exc)}); log(f'Transcription {device} failed: {exc!r}')
    results['transcription'] = rows; save()
    log('RESULT: DONE')
except Exception:
    results['error'] = traceback.format_exc(); save()
    log('RESULT: FAILED\n' + traceback.format_exc())
