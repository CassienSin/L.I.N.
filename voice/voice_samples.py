"""Voice samples: find a warmer Lin, by ear, without training.
Part A: new voices designed by the model (female; age, pitch, accent and seed vary), each reading a warm sample,
        then Lin speaking two test lines copied from that sample (how she would really sound).
Part B: livelier delivery for the current voice (class temperature and guidance), on the same lines.
Part C: one sentence at a time vs two sentences together (rhythm).
Clips are labelled with letters; the key is at the bottom of the page. Nothing changes until you choose:
python voice_samples.py use <letter>   (writes voice/voice.json; reopen Lin to hear it)
Run with Lin closed (design/Run-VoiceSamples.cmd)."""
from pathlib import Path
import html
import json
import shutil
import string
import sys

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import audio_polish as A
import speech_text

STEPS = 24
SAMPLE_TEXT = ("Hi, I'm Lin. It's really good to hear from you. I've had a look at your day, and honestly, it's not as bad "
               "as it seems. Let's take the most important thing first, and I'll keep track of the rest for you.")
TEST = ["Good evening, Aljho. You've got four tasks left, and the slides are the big one.",
        "That's brilliant news, well done! Do you want me to add the next step to your list?"]
DESIGNS = [('female, young adult, moderate pitch', 7), ('female, young adult, moderate pitch', 21),
           ('female, young adult, low pitch', 7), ('female, young adult, low pitch', 21),
           ('female, young adult, high pitch', 7), ('female, middle-aged, low pitch', 7),
           ('female, young adult, moderate pitch, american accent', 7), ('female, young adult, moderate pitch, british accent', 7),
           ('female, young adult, moderate pitch, australian accent', 7), ('female, young adult, low pitch, british accent', 21)]
STYLES = [{'class_temperature': 0.0, 'guidance_scale': 2.0}, {'class_temperature': 0.3, 'guidance_scale': 2.0},
          {'class_temperature': 0.6, 'guidance_scale': 2.0}, {'class_temperature': 0.3, 'guidance_scale': 3.0}]
ANSWER = ["A load balancer spreads incoming requests across several servers.", "It checks each server's health every few seconds.",
          "When one fails, traffic moves to the others.", "Your users never notice the switch."]
OUT = HERE / 'runtime' / 'voice-samples'


def save(name, wave, sr):
    sf.write(OUT / name, A.polish(wave, sr), sr, subtype='PCM_16')
    return name


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    OUT.mkdir(parents=True, exist_ok=True)
    from local_engine import LocalVoice
    print('Loading the voice on the graphics card...', flush=True)
    voice = LocalVoice()
    sr = voice.sample_rate
    letters = iter(string.ascii_uppercase + ''.join(a + b for a in 'AB' for b in string.ascii_uppercase))
    key, rows_a, rows_b = {}, [], []
    tests = [speech_text.for_voice(t) for t in TEST]
    plain = {'class_temperature': 0.0, 'guidance_scale': 2.0}

    # Part A: designed voices, then Lin copying each one.
    for n, (instruct, seed) in enumerate(DESIGNS, 1):
        letter = next(letters)
        wave, _ = voice.generate(SAMPLE_TEXT, steps=32, seed=seed, design=True, instruct=instruct, style=plain)
        ref = OUT / f'sample-{letter}.wav'
        sf.write(ref, wave, sr, subtype='PCM_16')           # the raw sample is what Lin would copy
        prompt = voice.clone_prompt(ref, SAMPLE_TEXT)
        clips = [save(f'{letter}-{i}.wav', voice.generate(t, steps=STEPS, prompt=prompt, style=plain)[0], sr) for i, t in enumerate(tests, 1)]
        key[letter] = {'part': 'A', 'instruct': instruct, 'seed': seed, 'reference': f'runtime/voice-samples/sample-{letter}.wav'}
        rows_a.append((letter, f'sample-{letter}.wav', clips))
        print(f'A {letter}: {instruct} (seed {seed})', flush=True)

    # Part B: the current voice, livelier or steadier.
    for style in STYLES:
        letter = next(letters)
        clips = [save(f'{letter}-{i}.wav', voice.generate(t, steps=STEPS, style=style)[0], sr) for i, t in enumerate(tests, 1)]
        key[letter] = {'part': 'B', **style}
        rows_b.append((letter, clips))
        print(f'B {letter}: {style}', flush=True)

    # Part C: rhythm, one sentence at a time vs two together.
    singles = [A.polish(voice.generate(t, steps=STEPS)[0], sr) for t in ANSWER]
    pairs = [A.polish(voice.generate(ANSWER[i] + ' ' + ANSWER[i + 1], steps=STEPS)[0], sr) for i in (0, 2)]
    c1, c2 = next(letters), next(letters)
    order = [(c1, 'one sentence at a time', singles), (c2, 'two sentences together', pairs)]
    if hash(c1) % 2:   # do not always put the same one first
        order.reverse()
    for letter, what, parts in order:
        sf.write(OUT / f'{letter}.wav', np.concatenate(parts), sr, subtype='PCM_16')
        key[letter] = {'part': 'C', 'rhythm': what}

    (OUT / 'key.json').write_text(json.dumps({'sample_text': SAMPLE_TEXT, 'letters': key}, indent=2), encoding='utf-8')
    style = ('<!doctype html><meta charset="utf-8"><title>Lin voice samples</title><style>body{font:15px system-ui;margin:24px;'
             'background:#0b1118;color:#e6f0f5;max-width:1100px}td,th{padding:6px 10px;border-bottom:1px solid #253445}'
             'h2{margin-top:28px}small,summary{color:#9fb0bd}audio{height:32px}</style>')
    page = [style, '<h1>Lin voice samples</h1>', '<p>Listen with headphones. Pick the letter you like in each part. '
            'Nothing changes until you say which one.</p>',
            f'<h2>A. A new voice for Lin</h2><p><small>Test lines: “{html.escape(TEST[0])}” and “{html.escape(TEST[1])}”</small></p>',
            '<table><tr><th>Voice</th><th>The sample</th><th>Lin, line 1</th><th>Lin, line 2</th></tr>']
    for letter, ref, clips in rows_a:
        page.append(f'<tr><td><b>{letter}</b></td><td><audio controls src="{ref}"></audio></td>' +
                    ''.join(f'<td><audio controls src="{c}"></audio></td>' for c in clips) + '</tr>')
    page += ['</table>', '<h2>B. How lively the current voice sounds</h2>', '<table><tr><th>Style</th><th>Line 1</th><th>Line 2</th></tr>']
    for letter, clips in rows_b:
        page.append(f'<tr><td><b>{letter}</b></td>' + ''.join(f'<td><audio controls src="{c}"></audio></td>' for c in clips) + '</tr>')
    page += ['</table>', '<h2>C. Rhythm</h2><p><small>The same four sentences, made two ways.</small></p>',
             ''.join(f'<p><b>{l}</b> <audio controls src="{l}.wav"></audio></p>' for l, _, _ in order),
             '<details><summary>Show what each letter is (after you have picked)</summary><pre>' +
             html.escape(json.dumps(key, indent=2)) + '</pre></details>']
    (OUT / 'index.html').write_text('\n'.join(page), encoding='utf-8')
    print(f'Listen: {OUT / "index.html"}')


def use(letters):
    """python voice_samples.py use C F   (a voice from part A and/or a style from part B)"""
    key = json.loads((OUT / 'key.json').read_text(encoding='utf-8'))
    settings = {}
    try:
        settings = json.loads((HERE / 'voice.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        pass
    for letter in letters:
        item = key['letters'].get(letter.upper())
        if not item:
            raise SystemExit(f'There is no {letter} on the page.')
        if item['part'] == 'A':
            target = HERE / 'auditions' / f"lin-{letter.lower()}-sample.wav"
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(HERE / item['reference'], target)
            settings.update(reference=f'auditions/{target.name}', reference_text=key['sample_text'], designed_as=item['instruct'], seed=item['seed'])
        elif item['part'] == 'B':
            settings.update(class_temperature=item['class_temperature'], guidance_scale=item['guidance_scale'])
        print(f'{letter.upper()}: {item}')
    (HERE / 'voice.json').write_text(json.dumps(settings, indent=2) + '\n', encoding='utf-8')
    print('Saved voice/voice.json. Close Lin and open it again to hear her new voice. Delete voice.json to go back to Lin A.')


if __name__ == '__main__':
    if sys.argv[1:2] == ['use']:
        use(sys.argv[2:])
    else:
        main()
