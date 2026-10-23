# Lin — local voice audition

Status: user selected **Lin A** as the preferred voice direction on 21 October 2026. English is the primary/default spoken language. The production engine remains undecided.

Update: a [working English voice prototype](PROTOTYPE.md) now uses GPU acceleration and real audio-driven sentence highlights. New English speech began in approximately 3.47 seconds in the browser test; saved playback began in 0.32 seconds. The CPU audition results below remain historical measurements.

Conversation update: the workspace now includes explicit start/finish recording, local English transcription, editable review, local answers, and A's spoken responses. The user confirmed their actual microphone works. A synthetic planning request reached an answer in about 12 seconds and first speech in about 18 seconds; broader accent and noise evaluation is still needed. The Brain & memory workspace now also provides cited text-note lookup and explicitly saved facts with correction and forgetting. See the prototype notes for controls, session context, and validation.

## User decision

The user prefers A and reports that Filipino and Cebuano pronunciation is off, but accepts that limitation for now because usage will mostly be English. Keep those languages as secondary options; improving them does not block the English-first prototype. This feedback does not validate native pronunciation, mixed-language speech, or speech recognition.

Use A's English sample as the sound reference for future voice work. Prioritize English delivery, responsiveness, interruption, and synchronization with the interface. Preserve the feminine, calm, warm, conversational direction when evaluating a production engine. The saved design decision is in `selection.json`; it does not configure a running assistant.

## Listen

- [Lin A — conversational direction](auditions/lin-a-multilingual.wav) — 19.36 seconds.
- [Lin B — lower-register direction](auditions/lin-b-multilingual.wav) — 19.22 seconds.

Both tracks play English, Filipino, then Cebuano, with 1.2-second pauses. The six individual language WAVs are in `auditions/`. All eight files are mono, 24 kHz PCM WAVs. `auditions/validation.json` records file checks and confirms that the comparison tracks match their individual clips; it is not a pronunciation or listening-quality assessment.

## What is being compared

- **Lin A — conversational:** feminine, young-adult, moderate-pitch design prompt.
- **Lin B — lower register:** feminine, middle-aged, low-pitch design prompt.

These are intended attributes, not independently verified descriptions of the resulting sound. A is the user's preferred direction. Each comparison uses the same short passage in this order: English, Filipino, Cebuano, separated by a short pause. Individual language clips are also retained.

The initial English clip defines a synthetic reference for the other two languages. No person's recording is used. This tests whether a recognizable voice transfers across languages; cross-language synthesis may carry the English reference's accent. Native pronunciation and consistent identity remain listening-review questions.

Implementation correction: the original audition script passed `language_id`, but the installed API expects `language`. The original clips were therefore not explicitly language-conditioned. The script is corrected for future generation; existing files are preserved, and reusing them does not apply the correction retroactively. The new English adapter explicitly uses `language='en'`. See the prototype notes for details.

## Local processing

Public weights are downloaded once to `models/omnivoice`, with revision and available SHA-256 checks recorded in `model-source.json`. The generation process uses local paths, offline model-library settings, disabled telemetry, and blocked Python socket connections. It uses the CPU for this initial audition, leaving the graphics card free. No microphone, external speech service, or account credential is used.

The isolated environment is `.venv-voice` in the project root. Software dependencies and models consume several GB. They are excluded from version control. This environment depends on the bundled Python installation and is an audition setup, not a packaged desktop application.

## Model and licensing

Candidate: [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice), by k2-fsa. The publisher lists [English, Filipino, and Cebuano](https://github.com/k2-fsa/OmniVoice/blob/master/docs/languages.md) and [voice design attributes](https://github.com/k2-fsa/OmniVoice/blob/master/docs/voice-design.md).

The code is Apache 2.0; the pretrained weights are CC-BY-NC according to the publisher. This folder is for **personal, noncommercial audition/evaluation only**. The model is not approved for Lin's planned business deployment. Commercial permission or a suitable alternative must be resolved before that deployment. Retain this attribution with the audition files.

The publisher notes that voice-design training uses English and Chinese; generalization to other languages can be unstable. Language-list inclusion alone does not establish naturalness.

## Review checklist

1. Does the voice feel feminine, warm, clear, and comfortable to hear repeatedly?
2. Which profile is closer to Lin's identity?
3. Are Filipino and Cebuano pronunciation and phrasing natural?
4. Does the same identity carry across the three clips?
5. Are words omitted, repeated, or mispronounced?

Next, prioritize English names, dates, peso amounts, brief humor, and longer answers using A as the reference. Mixed-language sentences and pronunciation improvements remain later evaluation work. These first clips do not validate code-switching or speech recognition.

## Reproduction

From the project root, use the isolated environment's Python to run `voice/generate_auditions.py`. It requires the downloaded model and installed dependencies. The script blocks network connections before model loading. Existing completed WAV clips are reused; delete only specific unwanted clips deliberately before regenerating different parameters.

Generation metadata is written to `auditions/manifest.json`. Exact installed package versions are recorded in `requirements-audition-lock.txt`; this snapshot includes CPU PyTorch wheels and is an environment record, not a portable one-command installer. Timings measure CPU sample generation, not conversational first-audio latency or concurrent reasoning performance. No quality rating is inferred from audio volume or file validity.

## Performance decision

The initial CPU run took about 89–91 seconds to generate each 4.88-second English clip. This configuration is too slow for responsive conversation. These auditions can inform the preferred sound, but the final voice subsystem still needs a faster, appropriately licensed engine or validated acceleration. This describes the original CPU audition milestone. The later conversation prototype runs CPU reasoning alongside GPU voice; see PROTOTYPE.md for current measurements and limitations.

| Profile | English generation | Filipino generation | Cebuano generation |
| --- | ---: | ---: | ---: |
| A | 91.21 s | 179.67 s | 145.88 s |
| B | 89.10 s | 181.20 s | 190.36 s |

The model loaded in 1.89 seconds after imports. These generation measurements cover complete utterances, not streamed first audio. All six clips were generated successfully using local model files.
