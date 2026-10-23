# OpenJarvis fit for Lin

Reviewed 22 October 2026 after the user shared the project. This is a documentation review, not an installed integration or a security audit.

OpenJarvis is a plausible future backend component for Lin. Its separation of engines, agents, tools, and memory fits the intended architecture. Lin should retain her selected voice, interface, explicit memory controls, and rule that model processing stays on this computer.

| Area | Observed support | Decision for Lin |
| --- | --- | --- |
| Local inference | A llama.cpp adapter connects to a local llama-server through a compatible chat API | Evaluate an adapter around the already installed model before adding another runner |
| Retrieval | Default SQLite/FTS5 search, source metadata, chunking, and optional richer retrieval backends | Keep the current small local index; compare semantic retrieval when more notes justify it |
| Workflows | Project documentation lists research, scheduled monitoring, and a spoken daily digest | Useful reference for later workflows after permissions and input freshness are implemented |
| Distribution | README lists native Windows and desktop installation options | Investigate packaging separately; no installer has been run |

The engine documentation describes local and cloud backends. Lin's configuration must permit only local model endpoints. App connectors may access approved services later, but that does not authorize cloud inference. OpenJarvis's repository is Apache-2.0; any adopted code needs its license and attribution preserved. That would not change the separate license restrictions on Lin's existing voice model.

Before adoption, validate an isolated adapter against Lin's existing checks: no cloud fallback, bounded file access, concrete tool approvals, cancellation, no duplicate side effects, memory correction/forgetting, and CPU/GPU contention. Preserve current state and compare behavior before replacing any working subsystem. No OpenJarvis code, agents, skills, services, or account connectors have been installed or enabled in this milestone.

Sources: [repository and README](https://github.com/open-jarvis/OpenJarvis), [engine architecture](https://open-jarvis.github.io/OpenJarvis/architecture/engine/), [tools and memory](https://open-jarvis.github.io/OpenJarvis/architecture/memory/).
