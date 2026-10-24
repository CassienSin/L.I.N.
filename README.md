# Lin

**A personal AI assistant that lives on your Windows PC.** She listens, talks back in her own voice, remembers your conversations, reads your notes and documents, plans your day, and changes things only after you approve. Everything runs on your own computer and works offline. When you want a stronger brain, she can ask Claude through your own Claude Code, and she shows you exactly what she would send first.

Inspired by J.A.R.V.I.S., E.D.I.T.H. and F.R.I.D.A.Y.: an assistant you can actually trust with your day.

> Status: a working personal build, under active development. Built for one Windows laptop (NVIDIA GPU with 4 GB of memory). Setup is still manual, and an installer is on the roadmap.

---

## What she can do

| | |
|---|---|
| **Talk hands-free** | Press the mic once and talk. She hears you on the GPU (faster-whisper), answers, and speaks sentence by sentence while she is still thinking. You can interrupt her any time. |
| **Her own voice** | A local voice model (OmniVoice), cleaned up for speech: she reads lists, times, money, units and acronyms properly, every sentence plays at the same loudness, and there are no gaps between sentences. |
| **A local brain** | Qwen3 4B on the processor (Fast) or Qwen3.6 35B with the graphics card (Smart), through llama.cpp. Her own process has no internet access. |
| **Claude, when you want it** | Optional. *Ask me first* offers hard questions to Claude with a "Send to Claude?" card showing the exact text. It goes only through **your** Claude Code, signed in with **your** Claude plan, with every tool turned off. There are no API keys and no copied tokens. |
| **Memory** | Conversations are saved on your PC, and she picks up where you left off. "What did we talk about yesterday?" "Don't save this conversation." "Forget today's conversations" asks first, and you can undo it for 10 minutes. |
| **Lin Brain** | Drop notes and documents (Markdown, PDF including scans, Word, PowerPoint, Excel, photos of text…) into the `Lin Brain` folder. Answers show the exact passages they came from. |
| **A living map** | Everything she knows, drawn as a map where every connection says why it exists. Answers fly the map to their sources. |
| **Plan my day & Today** | Tasks with time estimates and focus plans, plus a briefing from an imported calendar (.ics). |
| **Approvals, not surprises** | Adding a task, saving a note, forgetting a conversation or running a connected tool shows a card. Nothing happens until you **hold to approve**, and there is a receipt and Undo afterwards. |
| **Honest answers** | Every answer says what she checked and what she *couldn't*. |
| **Connected tools (MCP)** | Add MCP servers in Tools. Each tool can be Ask first, Auto or Off. |
| **A real Windows app** | Her own window, a tray icon, **Ctrl+Space** for a quick bar from anywhere, a floating emblem that shows her mood, notifications when she needs you, and Start with Windows. |
| **Dark and light** | One calm look, the "Orbit" design with her emblem at the centre, in dark and light themes, with high contrast, calm motion and large captions. |

## Privacy

- Your voice, your notes, your memories, your tasks and your calendar never leave your PC.
- The Lin server listens only on `127.0.0.1` and needs a per-session token.
- The only online part is Claude, and only if you turn it on. Claude sees just your question and the last exchange, never your files, notes, memories, tasks, calendar or private conversations. A log records when something was sent (sizes only, never the words).
- Demo mode uses invented data in its own folder, so your real data is never opened.

## Requirements

- Windows 10 or 11
- An NVIDIA GPU with at least 4 GB of memory, for the voice and hearing (CUDA 12.6 build of PyTorch)
- 16 GB of RAM; 32 GB recommended for the Smart (35B) brain
- Around 15 GB of disk space for the Python packages and the base models, plus 17 GB for the Smart brain
- Python 3.12
- Optional:
  - Node.js, for the browser checks
  - Claude Code with a Claude Pro or Max plan, for the online brain

## Setup (manual for now)

```powershell
# 1. Python environment with the pinned GPU packages
py -3.12 -m venv .venv-voice
.venv-voice\Scripts\python -m pip install -r voice\requirements-gpu-lock.txt

# 2. Models (one-time downloads, each checked against its published SHA-256)
.venv-voice\Scripts\python voice\download_model.py                 # OmniVoice (voice)
.venv-voice\Scripts\python voice\download_transcription_model.py   # faster-whisper base.en (hearing)
.venv-voice\Scripts\python voice\download_reasoning.py             # llama.cpp + Qwen3 4B (Fast brain)
```

Optional extras, each a double-click in `design\`:

| Script | Adds |
|---|---|
| `Download-Brain.cmd`, `Install-GpuBrain.cmd` | The Smart brain (Qwen3.6 35B) and the CUDA runtime |
| `Install-DocReaders.cmd` | Reading PDF, Office files and photos in Lin Brain |
| `Install-LinApp.cmd` | The Windows app (pywebview and pystray), with Desktop and Start-menu shortcuts |
| `Install-ClaudeCode.cmd` | Claude Code from Anthropic's installer, then *you* sign in |

## Running

| | |
|---|---|
| **Lin** shortcut or `Open Lin app.cmd` | The Windows app: tray, Ctrl+Space quick bar, floating emblem |
| `Open Lin.cmd` | Lin in your browser |
| `Open Lin (demo).cmd` | Lin with an invented semester of data, so you can try everything safely |

## Checks

`design\Run-CommandChecks.cmd` runs every unit check, restarts Lin with demo data for the browser checks, then switches back to your data. It covers actions, streaming, tools, memory, Claude (through a stand-in that never connects), the voice, documents, notes, the planner, the calendar, the map and the app screens.

Other tools in `design\`:
- `Run-VoiceLab.cmd`: voice timing, dead air, loudness, plus a page to listen to every test line
- `Run-VoiceSamples.cmd`: audition warmer voices
- `Run-SpeedLab.cmd`, `Run-BrainLab.cmd`: speed measurements

## Project layout

```
voice/            Lin's server (server.py) and everything she does
  ui/             the screens: plain HTML, CSS and JavaScript, no build step
  app_shell.py    the Windows app (tray, quick bar, floating emblem)
  cloud_brain.py  Claude through Claude Code
  conversations.py, brain.py, planner.py, actions.py ...
  verify_*.py     unit checks
design/           setup scripts, labs and browser checks (*.cjs)
Lin Brain/        your notes and documents (not committed)
LIN-BLUEPRINT.md  the product blueprint: decisions, design and the reasoning behind them
```

## Roadmap

- [x] Orbit redesign
- [x] Conversation memory
- [x] Claude as an optional online brain
- [x] Voice clean-up
- [x] Windows app: tray, quick bar, floating emblem
- [ ] Search by meaning across notes, documents and conversations, with local embeddings
- [ ] Awareness: wake word, talking over her, "what's on my screen", opt-in check-ins
- [ ] Phone app over a private network, and longer multi-step tasks
- [ ] A Tauri build with a real installer and auto-update

## Credits and licences

- Built with [llama.cpp](https://github.com/ggml-org/llama.cpp), [Qwen](https://huggingface.co/Qwen), [OmniVoice](https://huggingface.co/k2-fsa/OmniVoice), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [pywebview](https://pywebview.flowrl.com/) and [pystray](https://github.com/moses-palmer/pystray).
- Each model and library keeps its own licence. **The OmniVoice voice model is licensed for non-commercial use**, so this build is a personal project, not a product.
- Lin's own code: no licence has been chosen yet, so all rights are reserved by the author.

Made by Aljho E. Balongcas.
