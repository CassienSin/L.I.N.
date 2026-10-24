"""Voice lab: how Lin's voice does on 20 tricky lines, before and after the fixes.
For each line: what the voice reads (speech_text), how long it takes to make, the dead air at both ends,
loudness, peaks, and whether the next sentence would be ready before this one finishes playing.
Saves every clip and a page to listen to them in voice/runtime/voice-lab/ (open index.html).
Run with Lin closed (design/Run-VoiceLab.cmd does that), because the voice needs the graphics card.
Usage: python voice_lab.py [steps ...]   e.g. python voice_lab.py 12 16 24"""
from pathlib import Path
import html
import json
import sys
import time

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audio_polish as A
import speech_text

LINES = [
    "Good evening, Aljho. Lin Brain has 7 notes and 2 memories.",
    "1. Traffic Receives: The load balancer receives traffic at its IP address.",
    "Here is a breakdown: 1. Health checks. 2. Routing. 3. Failover.",
    "Your rehearsal is at 9:30 AM, the consult at 16:00, and the review at 4pm.",
    "It costs $5.50, or ₱200, which is about 50% less.",
    "Voice takes 2.1–2.7 s per sentence on the 4 GB card.",
    "The 3rd and 21st items were due on 2026-10-24.",
    "Use **Sonnet** for speed & Opus for depth → see https://code.claude.com/docs.",
    "You study BSIT at CCTC; for example TCP/IP, CPUs and GPUs.",
    "Okay. I won't save anything more from this conversation.",
    "Would you like me to move the slides to tomorrow morning?",
    "That's brilliant news, well done!",
    "Hmm, I couldn't find that in your notes, but I can search Lin Brain if you like.",
    "First, open the slides. Then rehearse the opening twice. Finally, print two copies for the panel.",
    "A load balancer spreads incoming requests across several servers, so no single server is overwhelmed.",
    "It checks each server's health every few seconds and stops sending traffic to any that fail.",
    "When a server recovers, it is added back automatically, and users never notice the switch.",
    "Sticky sessions keep one user on the same server, which helps with logins and carts.",
    "For your clinic app, start with round robin, then measure, and only add complexity if you need it.",
    "That's the main idea. Want me to sketch how it would fit your capstone's design?",
]
LONG = LINES[14:20]   # a six-sentence answer, made the way Lin makes it (first alone, then batches of three)


def stats(wave, sr):
    lead, tail = A.silence_ms(wave, sr)
    return {'seconds': round(len(wave) / sr, 2), 'lead_ms': round(lead), 'tail_ms': round(tail),
            'loudness_dbfs': round(A.loudness_dbfs(wave, sr), 1), 'peak': round(float(np.max(np.abs(wave))), 3),
            'clipped': int(np.sum(np.abs(wave) >= 0.999))}


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')   # a Windows console is not UTF-8 by default
        except (AttributeError, ValueError):
            pass
    steps_list = [int(a) for a in sys.argv[1:]] or [12]
    out = HERE / 'runtime' / 'voice-lab'
    out.mkdir(parents=True, exist_ok=True)
    from local_engine import LocalVoice
    print('Loading the voice on the graphics card...', flush=True)
    voice = LocalVoice()
    sr = voice.sample_rate
    rows = []
    for steps in steps_list:
        voice.generate('Warming up.', steps=steps)
        for i, line in enumerate(LINES, 1):
            said = speech_text.for_voice(line)
            wave, m = voice.generate(said, steps=steps)
            raw, done = stats(wave, sr), A.polish(wave, sr)
            tidy = stats(done, sr)
            sf.write(out / f'{i:02d}-s{steps}-raw.wav', wave, sr, subtype='PCM_16')
            sf.write(out / f'{i:02d}-s{steps}.wav', done, sr, subtype='PCM_16')
            rows.append({'line': i, 'steps': steps, 'text': line, 'voice_reads': said, 'make_seconds': m['generation_seconds'],
                         'raw': raw, 'polished': tidy})
            print(f"[{steps} steps] {i:02d} made in {m['generation_seconds']:.2f} s, {raw['seconds']:.1f} s of audio, "
                  f"dead air {raw['lead_ms']}+{raw['tail_ms']} ms -> {tidy['lead_ms']}+{tidy['tail_ms']} ms, "
                  f"loudness {raw['loudness_dbfs']} -> {tidy['loudness_dbfs']} dBFS", flush=True)
    # A whole answer, made the way Lin makes it: would each sentence be ready before the previous one ends?
    steps = steps_list[0]
    started = time.perf_counter()
    first, fm = voice.generate(speech_text.for_voice(LONG[0]), steps=steps)
    first = A.polish(first, sr)
    ready = [time.perf_counter() - started]
    clips = [first]
    rest = LONG[1:]
    for k in range(0, len(rest), 3):
        batch = [speech_text.for_voice(t) for t in rest[k:k + 3]]
        waves = voice.generate_batch(batch, steps=steps)
        now = time.perf_counter() - started
        for w, _ in waves:
            clips.append(A.polish(w, sr))
            ready.append(now)
    play_at, gaps = ready[0], []
    for j, clip in enumerate(clips):
        if j:
            gap = max(0.0, ready[j] - play_at)
            gaps.append(round(gap * 1000))
            play_at += gap
        play_at += len(clip) / sr
    sf.write(out / 'answer.wav', np.concatenate(clips), sr, subtype='PCM_16')
    answer = {'sentences': len(clips), 'first_ready_seconds': round(ready[0], 2), 'waiting_gaps_ms': gaps,
              'longest_wait_ms': max(gaps) if gaps else 0}
    loud = [r['raw']['loudness_dbfs'] for r in rows if r['steps'] == steps]
    tidy = [r['polished']['loudness_dbfs'] for r in rows if r['steps'] == steps]
    summary = {
        'steps': steps_list, 'lines': len(LINES),
        'dead_air_ms_before': round(float(np.mean([r['raw']['lead_ms'] + r['raw']['tail_ms'] for r in rows]))),
        'dead_air_ms_after': round(float(np.mean([r['polished']['lead_ms'] + r['polished']['tail_ms'] for r in rows]))),
        'loudness_spread_db_before': round(max(loud) - min(loud), 1), 'loudness_spread_db_after': round(max(tidy) - min(tidy), 1),
        'clipped_after': sum(r['polished']['clipped'] for r in rows),
        'make_seconds_by_steps': {s: round(float(np.mean([r['make_seconds'] for r in rows if r['steps'] == s])), 2) for s in steps_list},
        'answer': answer,
    }
    (out / 'results.json').write_text(json.dumps({'summary': summary, 'rows': rows}, indent=2, ensure_ascii=False), encoding='utf-8')
    page = ['<!doctype html><meta charset="utf-8"><title>Lin voice lab</title><style>body{font:15px system-ui;margin:24px;background:#0b1118;color:#e6f0f5}'
            'td,th{padding:6px 10px;border-bottom:1px solid #253445;vertical-align:top}small{color:#9fb0bd}audio{height:32px}</style>',
            '<h1>Lin voice lab</h1>', f'<p>Six-sentence answer (as Lin makes it): <audio controls src="answer.wav"></audio> '
            f'longest wait between sentences {answer["longest_wait_ms"]} ms</p>',
            '<table><tr><th>#</th><th>Line, and what the voice reads</th>' + ''.join(f'<th>{s} steps, before</th><th>{s} steps, after</th>' for s in steps_list) + '</tr>']
    for i, line in enumerate(LINES, 1):
        said = speech_text.for_voice(line)
        cells = ''.join(f'<td><audio controls src="{i:02d}-s{s}-raw.wav"></audio></td><td><audio controls src="{i:02d}-s{s}.wav"></audio></td>' for s in steps_list)
        page.append(f'<tr><td>{i}</td><td>{html.escape(line)}<br><small>reads: {html.escape(said)}</small></td>{cells}</tr>')
    page.append('</table>')
    (out / 'index.html').write_text('\n'.join(page), encoding='utf-8')
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f'Listen: {out / "index.html"}')


if __name__ == '__main__':
    main()
