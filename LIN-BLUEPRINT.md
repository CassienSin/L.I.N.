# Lin — product blueprint

Version 0.21 · 23 October 2026 · Status: Claude as an optional online brain (through Claude Code with the user's own plan, asked first), conversation memory, the Orbit look (the emblem is the interface, dark and light), a greeting with a personality, the approval-gated action layer with hold to approve, connected MCP tools (including read-only Google Docs, Drive and Sheets), a faster local voice and hearing pipeline, and Lin Brain reading documents and photos

## Product definition

Lin is a Windows desktop assistant for personal and business work. Its planned capabilities combine local intelligence, persistent memory, selected file access, connected tools, and coordinated voice and visual results. The current browser prototype captures English speech on explicit request, offers transcript review, answers through a local CPU model, and speaks with GPU synthesis and synchronized sentence cards. It retains two recent chat exchanges, loads a readable identity file, stores explicitly saved facts across restarts, and searches the notes and documents in the dedicated Lin Brain folder (text, Markdown, PDF including scanned pages, Word, PowerPoint, Excel, OpenDocument, RTF, web pages, e-books, Outlook messages and photos of text) with inspectable passages and their line, page, slide or sheet. Semantic retrieval and a packaged desktop application remain future work.

## Confirmed decisions

- Name: Lin.
- Scope: personal and business use.
- Deployment: a desktop environment on Windows.
- AI processing: local, including reasoning, transcription, speech generation, embeddings, and document extraction. One chosen exception (23 October 2026): Claude can answer questions the user sends it, only through Claude Code signed in with his own Claude plan, and only when he turns it on.
- Connectivity: works offline; approved internet and app connections extend its capabilities.
- Experience: spoken requests, brief spoken summaries, source-backed cards, meaningful animation.
- Voice identity: feminine, calm, warm, confident, natural pacing, concise summaries, and occasional dry humor.
- Preferred voice direction: Lin A, the conversational audition.
- Primary/default spoken language: English. Filipino and Cebuano remain secondary options; the user accepts their current pronunciation limitations for now. Natural switching remains a future validation target.
- User control: external writes require a concrete preview and approval.
- Notes and calendar providers remain replaceable; no account/provider is selected yet.
- First file source: the new `Lin Brain` folder in this project, chosen by the user. No broader personal folder is scanned. The initial guide is setup content, not a fact about the user.

## Product principles

1. Show evidence. Answers about the user's material link to the exact file and relevant passage.
2. Show reality. Progress, connectivity, freshness, and completion reflect actual events.
3. Keep continuity. Sessions retrieve a compact identity and relevant memories without loading all history.
4. Make changes inspectable. Explain the result, keep a receipt, and offer recovery when possible.
5. Make uncertainty explicit. Missing sources, stale records, and conflicting facts remain visible.
6. Keep the user in control. Cancellation and microphone controls are always accessible.

## Interaction contract

Request → classify intent → retrieve relevant context → propose tool steps → check policy → execute → verify → summarize → record relevant history.

Each task has an ID, state, tool steps, required approvals, source references, timestamps, and a result. States: queued, listening, interpreting, retrieving, working, awaiting approval, verifying, completed, partially completed, failed, cancelled.

A short voice response and the detailed card share one structured result. Sentence/segment IDs link audio playback events to card highlights. The interface never guesses that speech has played from a fixed animation timer. The knowledge-map concept still uses timed captions only. The separate English voice workspace implements real sentence-level audio playback, card highlights, media-clock progress, and signal-reactive visuals.

If the user interrupts, stop playback immediately. Cancel unsent operations where possible; report any action already committed. A cancelled animation must not imply an already-sent message was recalled.

## Lin's voice identity

The user selected a feminine voice with the proposed calm, warm, confident tone and occasional dry humor. Lin should sound attentive and capable, with natural phrasing and short summaries. Humor is optional and must never obscure a failure, an approval request, or an important detail.

The user selected Lin A after hearing the auditions. English is the primary/default spoken language. Filipino and Cebuano remain secondary options: the user reported inaccurate pronunciation in both and accepted the limitation for now because use will mostly be English. These improvements do not block the English-first prototype. Provide a manual language preference and honor explicit language requests; do not switch languages merely because an English sentence contains a local name or borrowed word. Support mixed-language requests where possible. Keep the voice recognizable across languages; do not promise identical timbre until validated. Cebuano must be evaluated separately from Filipino.

All speech recognition and synthesis must run locally and remain usable offline after setup. Evaluate recognition, language understanding, and speech generation separately for each language. A multilingual label is not proof that a model handles all three well. If a suitable local voice cannot meet the target, report the limitation and audition alternatives; never silently route audio or text to cloud speech services.

Local audition passages (English, Filipino, Cebuano):

- English: “Good morning. Your plan is ready. Let's start with the most important task.”
- Filipino: “Magandang umaga. Handa na ang plano mo. Unahin natin ang pinakamahalagang gawain.”
- Cebuano: “Maayong buntag. Andam na ang imong plano. Unahon nato ang labing importanteng buluhaton.”

Review wording, regional pronunciation, and naturalness with the user before choosing the final voice. Also test names, dates, amounts in pesos, English technical terms in local-language sentences, and short code-switched requests. Prefer understandable natural speech over a forced accent.

Voice controls: interrupt, stop, mute, replay, language preference, and text-only mode. Start with push-to-talk. The circular presence reacts to actual recording/playback states; sentence-linked cards follow actual audio events. The present design preview uses captions only.

Implemented conversation slice: `Start-LinVoice.ps1` opens the English workspace with microphone review, typed requests, local answers, A's voice, interruption, mute, replay, and real sentence highlights. CPU reasoning runs alongside the resident GPU voice model. A complete planning request showed its answer in about 12 seconds and began speaking in about 18 seconds in the latest synthetic test. The separate read-aloud mode still begins new speech in about 3 seconds. See `voice/PROTOTYPE.md` for measurements, startup behavior, limits, and verification. This is personal evaluation; production licensing and conversational latency remain open.

Implemented listening slice: press Talk to Lin to start microphone capture, then Finish & transcribe to close the microphone and run English recognition locally. Capture stops automatically at 30 seconds; discard, Escape, and page hiding release microphone tracks and invalidate pending results. The transcript is editable and can be copied into a request; it never submits or executes a command automatically. Recognition uses CPU int8 faster-whisper base.en, leaving the GPU for speech synthesis. Synthetic browser testing reached transcript review in about 1.38 seconds after Finish; the user confirmed real microphone capture works, while broader accent/noise quality remains to be evaluated. All audio processing stays local, with no recording history saved to disk.

Voice-selection gate: the user prefers Lin A as the sound reference. Combined reasoning/voice resource use and initial English latency have been measured. Continue improving conversational delay and evaluating quality. Select a production engine only after intended-use quality, offline behavior, licensing, and hardware fit are checked. The preferred voice direction is selected; the production engine remains undecided. See `voice/selection.json` for the recorded preference.

The first audition candidate is OmniVoice, with two feminine design prompts: conversational/moderate pitch and lower register. Generation uses local model files on CPU with offline library settings and Python socket connections blocked. English is generated first, then used as a synthetic reference for Filipino and Cebuano. These are three separate utterances, not a code-switching demonstration. See `voice/README.md`, the sample files, and `voice/auditions/manifest.json` for evaluation details and timings. The pretrained model is CC-BY-NC and is used only for personal, noncommercial evaluation; business deployment requires suitable rights or a different engine. Voice quality and cross-language identity remain subject to listening review.

## Six primary workflows

| Workflow | Inputs and steps | Output and completion rule |
| --- | --- | --- |
| Search my brain | Search selected sources using keywords and local embeddings; inspect matching passages | Answer with file, passage/page, source timestamp; say when support is insufficient |
| Research the web | Preview outgoing query when it contains private context; retrieve permitted public pages; compare locally | Cited findings with retrieval date; save a research note only when requested or covered by a standing local-write rule |
| Read the inbox | Fetch authorized account messages; match people to local history | Read-only summary, freshness, and suggested follow-ups; drafts remain unsent |
| Brief me | Gather calendar, inbox, tasks, and unresolved commitments | Short spoken brief with linked cards; missing connections and stale caches are identified |
| Remember this | Extract a proposed fact; detect conflict; save source and date | Visible memory receipt with edit, forget, and history controls |
| Plan my day | Combine priorities, duration estimates, calendar constraints, and buffers | Ordered, feasible plan; external calendar writes require separate approval |

## Interface map

### Home

An explorable knowledge graph is the main workspace. A floating inspector sits on the left, category filters and Lin's circular presence sit on the right, and a command dock anchors the bottom. Selecting a node highlights its immediate relationships and reveals evidence. The six workflows remain available in the dock; source-backed results and approval cards appear when needed.

### Today

An ordered plan with durations and breaks. Show data freshness and any missing calendar/inbox information. Planning a day does not silently book calendar events.

### Brain

Searchable files and memories. Distinguish confirmed facts from suggestions and extracted observations. Each item has provenance, a date, and edit/forget controls. Personal and business scopes are visible filters; they do not require separate assistants.

### Activity

Task history, tool steps, approval receipts, partial failures, and recoverable file edits. Retry only failed steps after checking whether an external action already succeeded.

### Connections

Selected folders, account permissions, last successful sync, network access scopes, and disconnected services. An internet connection is not permission to connect an account.

### Approval surface

Show action, destination/recipient, exact content/change, included attachments, and relevant consequence. Approve once or reject. Material changes invalidate approval. Approval tokens are short-lived and bound to the exact action payload.

## Visual direction

The user's screenshot reference supersedes the initial dashboard layouts. The new direction is **Neural workspace**: an immersive dark knowledge map with colored clusters, fine relationship lines, floating panels, a circular Lin display, and a bottom command dock. The supplied screenshot was inspected; the linked YouTube video could not be retrieved, so no unseen video behavior is assumed.

Reference context: [AI Workshop Lite](https://www.skool.com/aiworkshop-lite/about) publicly lists Jarvis build instructions and projects using Claude Code, GPT, and voice AI. [AI Workshop](https://www.skool.com/aiworkshop/about) publicly lists a Jarvis assistant and an AI second brain. The private lessons, code, and implementation have not been accessed. These establish the intended product category; the screenshot supplies the visual reference. Lin retains its own name and the user's local-processing requirement.

The earlier Orbit and Focus previews remain exploratory history. The graph view becomes the current design candidate, while Today, Activity, and Connections remain secondary views in the eventual desktop app.

Graph interaction requirements:

- Click a node to show its type, source, and immediate connections. Dim unrelated nodes.
- Search or use a keyboard-accessible node picker to find any node.
- Filter categories: projects, people, notes, files, tools, and memories. Color always has a matching text label.
- Drag the spatial view to change its angle; use zoom controls and Fit to recover orientation.
- Offer a flat view and an optional motion setting. Respect reduced motion.
- Show source excerpts and explicit relationship types. A visual connection is not evidence by itself.
- The prototype uses projected 3D coordinates on a 2D canvas. It is a spatial interaction concept, not a production graph engine.
- Graph data is fictional in the preview. The real graph must be derived from indexed sources and confirmed memories, never decorative invented relationships.
- On small screens, place the inspector and assistant beneath the map so content remains readable.

The reference establishes a near-black, cyan-led appearance. Category colors distinguish meaning: projects amber, people green, notes cyan, files blue, tools violet, memories rose. Keep larger surfaces neutral and labels readable. The first graph concept intentionally follows the dark reference; an alternative light appearance can be designed later.

Animation communicates state: a listening response, bounded work motion, segment-linked highlighting, and a settled completion state. It must not imply hidden reasoning is a verified action. Reduced motion disables nonessential movement. Keyboard users can reach every action.

## Offline and online behavior

| Capability | Offline | Online with permission |
| --- | --- | --- |
| Reasoning, voice, memory, document parsing | Local | Local |
| File search | Selected local files and index | Same |
| Calendar/inbox | Previously synced material or local imports, labeled with last sync | Fetch fresh records from connected providers |
| Web research | Saved research only | External searches and page retrieval; analysis stays local |
| External actions | Prepare drafts; mark as unsent | Preview and approve before execution |
| Hard questions | The local brain answers | Claude through Claude Code: Ask me first shows the exact text and waits for approval; Claude for conversation sends everyday questions; private conversations never |

Network policy separates model processes from connectors. Model processes have no intended network egress. A connector can contact only approved service endpoints. Silent cloud model fallback is prohibited. The one cloud model is Claude, which the user turns on himself; it runs as the separate Claude Code program he installed and signed in to, so Lin's own process still has no network egress (see Claude as the online brain). Model downloads and software updates are explicit setup/maintenance events.

Search queries and service requests do leave the computer. Private terms require a preview unless covered by a deliberately granted scope. Never send whole documents merely to improve a search query. Logs must not retain credentials or unnecessary message contents.

Reconnection refreshes authorized read-only data. It never automatically submits a pending external write. Schedules run while the machine and service are awake; missed triggers are reported on resume.

## Memory design

Four stores have different purposes:

1. Identity: small readable preferences and business context.
2. Knowledge index: passages derived from selected source files; rebuildable.
3. Durable memory: confirmed facts, decisions, relationships, and preferences.
4. Task history: what ran, what changed, and what needs attention.

Memory records include ID, content, scope, source, recorded time, effective time when known, confirmation status, superseded record, and optional review/expiry date. Keep conflict history. Forgetting a fact removes it from retrieval and associated derived indexes; backups have a documented retention policy.

File moves, edits, deletion, or removed folder permission trigger index updates. Revoked sources must stop appearing in results. Store only relevant excerpts in each model request. Sources remain data, never privileged instructions.

## Proposed architecture

Desktop UI ↔ authenticated local application service ↔ policy-checked tool broker.

The local service coordinates:

- Local model runner and model adapter.
- Local speech-to-text and text-to-speech adapters.
- File access, parsing, and indexing workers.
- Memory and task database.
- MCP clients and provider-specific adapters.
- Workflow runner and scheduler.
- Structured events consumed by both voice and UI.

Proposed implementation direction: TypeScript desktop UI, an isolated desktop host, local database, and separate model/voice processes. Select the desktop framework and exact dependencies after the visual direction and hardware benchmark; this document does not lock versions.

The UI has no direct shell or credential access. Tool arguments are validated. File access resolves actual paths, including links and junctions, against selected roots. Credentials belong in the Windows credential store. Bind local services to loopback and authenticate requests; a local port alone is not an authorization boundary.

MCP standardizes tool connections. It does not replace policy enforcement, provider authentication, or per-tool validation. Prefer specific tools over unrestricted shell execution. No general computer-control tool is included in the first version.

## Hardware and model selection

Observed hardware: about 32 GB RAM, Intel i5-13420H, NVIDIA RTX 2050 reporting about 4 GB graphics memory. Verify usable graphics memory during benchmarking.

The first conversation model is the official Qwen3 4B Q4_K_M GGUF running through pinned llama.cpp b11669 on six CPU threads. English recognition also uses CPU; OmniVoice keeps the GPU. All three have been loaded together and the complete synthetic microphone → review → answer → voice flow has passed. This is an initial conversational model, not a validated tool planner. Model instructions cannot enforce tool policy; no execution tools are exposed yet. Continue evaluating answer quality and latency before selecting the production model. Never silently substitute cloud inference when the machine is overloaded.

## Milestones and acceptance

1. **Design:** refine the Neural workspace; audition the feminine voice in English, Filipino, and Cebuano; review workflows and permission language.
2. **Local foundation:** launch desktop app; run local inference; persist settings; demonstrate no cloud fallback.
3. **Brain:** implemented for the dedicated Lin Brain folder's UTF-8 .txt/.md files. Exact passage lookup, source inspection, edit/move/delete freshness, disconnect, personal/business memory scopes, correction history, and forgetting are tested. A real restart recalled the corrected saved fact. Keyword retrieval currently uses SQLite FTS5; embeddings and PDF/Word support are deferred.
4. **Voice:** English capture → local transcription → review → local answer → spoken response is implemented and tested with synthetic microphone input, including interruption and real playback highlights. The user confirmed their actual microphone works after browser permission recovery. Accent, noise, names, and sustained conversation quality still need broader evaluation. Filipino, Cebuano, and mixed-language recognition remain separate secondary work; the current recognition model is English-only.
5. **Daily work:** local task entry, corrections, done/reopen, time estimates, priorities, scope filters, and feasible focus plans with breaks are implemented. Spoken summaries use the current saved plan; tasks and settings survive restart. Reviewed .ics calendar imports and a spoken Today briefing combining events with saved tasks are implemented and survive restart. Live calendar sync, deadline awareness, fitting the plan around events, and inbox briefings remain future work.
6. **Action layer:** implemented for local stores. Conversation can check tasks, the focus plan, the imported calendar, free time and Lin Brain notes, and can propose adding a task or marking one done. Proposals require approval of an exact payload, execute once, leave receipts, and can be undone. See "Action layer" below.
7. **Connections:** add one calendar and one inbox provider; verify scopes, expired sessions, exact approvals, and safe retries.

The first end-to-end acceptance scenario is: spoken request → real local file → correct cited answer → saved correction → restart → corrected recall.

Additional required checks: rejected approvals execute nothing; changed payloads require new approval; offline mode cannot send; malicious document instructions cannot expand permissions; cancellation reports completed side effects accurately; restart does not duplicate actions; reduced motion and keyboard navigation remain usable.

## Explicitly deferred

Wake word, always-on microphone, unrestricted desktop control, multi-device synchronization, multiple simultaneous agents, custom voice cloning, shared business accounts, and autonomous sending/publishing. These can be considered after core reliability is demonstrated.

## Decisions still open

- Refinements to the Neural workspace: graph density, motion, and amount of visible detail.
- Production voice engine and English responsiveness; A is the preferred sound reference. Filipino/Cebuano pronunciation improvements and mixed-language quality remain secondary evaluation work.
- Representative personal/business notes to add to the selected Lin Brain folder.
- Business context, actual recurring tasks, and client terminology.
- First calendar/inbox accounts, if any.
- Backup destination, retention, and any allowed standing network scopes.

## Concept preview boundaries

All clients, tasks, files, messages, and memories in the preview are examples. It performs no network requests, uses no microphone, reads no user documents, and sends no messages. Approvals, search, connectivity, and tool progress are simulated to evaluate the design. Offline and approval states are functional within that simulation.

## OpenJarvis reference

The user shared OpenJarvis on 22 October 2026. Its local engine adapters, memory interfaces, and workflow separation are relevant to later backend work. The current milestone does not install or integrate it. See `design/OPENJARVIS-ASSESSMENT.md` for verified sources, fit, and the checks required before adoption. Lin retains local-only AI processing, her selected voice, and explicit action controls.

## Live brain map

The conversation app now includes a Brain map workspace backed by the actual local index and memory database. One node represents each indexed nonempty text/Markdown file or current saved memory. Notes, Personal, and Business are organizational hubs; lines show group membership, not semantic similarity or inferred business relationships. No sample client data is added to fill the map.

Selecting an item loads its current exact source, with a passage selector and line references for longer files. Title search, group filters, pan, zoom, fit, keyboard controls, and an equivalent item list support exploration. Revisions refresh the map and selected source; deletion, forgetting, or disconnection removes the corresponding nodes. Background scans normally run every three seconds while inference is idle. The current scan and memory limits still apply. Empty files and unsupported documents do not produce nodes.

## Local daily planning

The Plan my day workspace stores explicitly entered personal and business tasks on this computer. Each task has a priority and time estimate. The planner orders open tasks by priority and then creation time, includes breaks between tasks, and keeps the total within the available minutes. Whole tasks that do not fit remain visible with their required time; lower-priority work can fill a gap. This is a suggested focus session, not a calendar schedule or a guarantee about actual task duration.

Tasks can be edited, marked done, reopened, or removed. Tasks and planning preferences survive restarting Lin. The exact conversation request “Plan my day” opens this workspace. Hear my plan uses Lin A to read a short summary of the current saved plan, with existing playback controls and sentence highlights. No model decides which tasks to save. Calendar appointments, deadlines, inbox data, recurring tasks, automatic reminders, and natural-language task extraction are not connected yet.

## Today briefing

The Today workspace combines an explicitly imported calendar snapshot with saved tasks. The user chooses an iCalendar (.ics) export; Lin parses it in an isolated, offline worker process and shows a preview of the next 30 days before anything is saved. Discarding the preview keeps the existing calendar unchanged. Times are shown in Manila time. Recurring events, moved and cancelled occurrences, all-day events, and floating times are handled; meeting invitations, unrecognized time zones, period-valued dates, dense recurrences, and oversized exports are rejected with a plain explanation.

The briefing is deterministic, not model-generated: event count, the current or next event, open and high-priority tasks, and how much of the focus plan is used. It always labels the source as an imported snapshot, warns when the import is over a day old or does not cover today, distinguishes "no events in this snapshot" from a missing calendar, and states that the plan has not been fitted around events and that the inbox is not connected. Hear briefing reads it with Lin A and synchronized sentence cards. The exact request "Brief me" opens the workspace. This is not live sync and Lin cannot see availability outside the imported file.

## Action layer

The interaction contract (classify, retrieve, propose, check policy, execute, verify, summarize, record) now runs for Lin's own local data. It is what separates Lin from frameworks such as OpenJarvis that give agents broad autonomy: Lin may read on request, but every change waits for the user's explicit approval and leaves a receipt.

Routing. Common phrasings are matched by fixed rules with no model call ("What do I have on tomorrow?", "Am I free this afternoon?", "Add a task to…", "Mark … as done"). Other requests that mention tasks, calendar, time, notes or plans go to the local model, whose reply is grammar-constrained to a small JSON schema naming one allowed tool. Anything else stays ordinary conversation. The router uses its own model slot so the conversation prompt stays cached.

Read tools: saved tasks, the focus plan, the imported calendar for today or tomorrow, free time between events (morning, afternoon, evening or workday, gaps of at least 15 minutes, all-day events not counted as busy, tentative events counted as busy), and Lin Brain notes. A response card shows exactly what was checked, its freshness, and how the answer was produced. Direct lookups are answered exactly from the data. Open questions ("Should I go to the gym this afternoon?") are answered by the local model from that data, then verified: an answer that repeats the data block, cites a time or time range not in the data, or claims a change is replaced with the exact summary.

Write tools: add a task, and mark a saved task done. Lin prepares a card showing the exact change; editable details produce a new payload hash, so an earlier approval cannot apply to changed content. Approval executes once and verifies the result. Proposals expire after 10 minutes. Decline, expiry, failure, an interrupted execution (reported as unconfirmed after restart, never retried automatically) and undo are all recorded in the Activity view. Undo is refused if the task was edited afterwards. Writes can only come from the user's own request; tool results, notes and calendar text cannot trigger them, and there is no tool chaining. "Remind me to…" becomes a task and Lin says that reminders are not available yet.

Measured on this computer with the test calendar: 11 of 11 sample requests routed correctly; direct lookups answered in under half a second.

Responsiveness. Answers now stream: each finished sentence goes to the voice while the model writes the next, and tool answers are verified sentence by sentence before they are voiced, so an unverified sentence stops generation and is never spoken. Both fixed prompts (identity and router) are read into their slots during startup, so the first question after launch does not pay for them. Tool data is sent as compact text instead of JSON. When a needed source is missing (no calendar imported), Lin says so directly instead of asking the model. Measured on this computer: conversation answers begin speaking 4.7–7.2 s after asking (previously 17.9 s), the first question after a restart 10.9 s (previously 22.1 s), router decisions about 2 s (previously 9 s), and reasoned calendar answers start their first sentence in 6.5–7.7 s (previously 22–25 s for the whole answer). Generation runs at about 6–7 tokens per second on the CPU and prompt reading at 25–50 tokens per second; the voice takes 3.5–5 s per sentence on the GPU, so short pauses between sentences remain. Further gains would need a GPU-capable reasoning runtime sharing the 4 GB card with the voice, or a smaller model, and both trade quality or stability.

## Command screen (Tidepool)

Lin opens on one screen instead of tabs. The design direction, Tidepool, was chosen on 22 October from three options (Tidepool, Observatory, Daylight) on the design canvas "Lin Command Center — design directions". The JARVIS build shared that day was a reference for what the screen does, not how it looks.

The map fills the window: every note, saved memory, open task, calendar event for the coming week and [[linked]] topic. Colour shows the kind, size shows how connected an item is. Every line carries its reason, shown in the inspector: a [[link]] with its line number, one item naming another, both naming the same uncommon term, or a calendar event connected to what it names. Nothing is inferred by a model. Hovering lights an item's connections and dims the rest; selecting opens the inspector with the passage and the reasons; Shift-selecting a second item traces the shortest path. Drag pans or moves an item, scrolling zooms, 3D turns by dragging, and force sliders change the spread. Labels are placed most-connected first and never overlap. A faint pulse travels a random connection every few seconds, and motion stops when reduced motion is set. A list view gives keyboard and screen-reader access. Notes containing text that reads like an instruction to Lin are flagged as plain text.

Around the map: the day ribbon (today's events, free gaps and the current time), the inspector and most-connected list, the lens (filters with live counts by kind and connection, 2D/3D, fit, forces), and the dock with Lin's pearl, the request box and buttons for talking, mute, Today, Plan my day, Notes and memory, Activity and About you. Those workspaces open as sheets over the map. The pearl shows Lin's real state: resting, listening (bars from the actual microphone level), thinking, speaking (rings from her actual voice) and needs you (a change waits for approval). Her words appear in a serif above the dock. Fonts are built into Windows, so the screen works offline.

Hands-free: press the microphone once and talk. A pause (0.9 s by default, adjustable) ends the turn, Lin transcribes on this computer and sends it, ignores the microphone while she thinks and speaks, then listens again. Space or the microphone button interrupts her; Escape or the button stops hands-free; two quiet minutes turn it off. An option keeps the old review-before-sending behaviour. No cloud voice, wake word or API key is involved.

About you: a profile (name, about, how Lin should talk) stored on this computer and given to the model as facts with every answer. It was seeded from what Aljho shared: fourth-year BSIT student at CCTC, capstone defense on 27 October 2026, no business yet, talk like a friend and an assistant.

Demo mode: Open Lin (demo).cmd starts Lin with an invented student's semester in voice/demo, built from a fixed seed with calendar dates kept relative to today. A "Demo data" badge is always shown, and real notes, memories, tasks, calendar and profile are never opened. Switching between demo and real data closes the other session first, since both share the graphics card.

Conversation memory now keeps up to eight messages. While Lin speaks, she pre-reads the conversation so the next question only processes its own words. Follow-ups such as "mark the second one done" resolve against the list she just showed.

Measured on this computer: 2,000 map items with 3,998 connections draw at 17.5 to 18.5 ms per frame (median); a full hands-free turn took 11 to 17 s including her spoken answer; in a five-turn conversation the first sentence was ready in 3.6 to 4.7 s and the first audio began at 8.5 to 9.8 s, with only 17 to 33 new prompt tokens per question. Voice synthesis at about 5 s per sentence is now the largest remaining wait.

## Connected tools (MCP)

Lin is an MCP client (voice/mcp_client.py, stdio transport). You add servers in the Tools sheet: a name, the command that starts the server, its arguments and optional environment lines. The settings live in data/mcp.json. Each tool has a policy you choose: Ask first (the default for every new tool), Auto, or Off.

- Routing: built-in rules come first. A request that names a connected tool or its server is short-listed by keyword matching, then the model picks one tool or none from a grammar-constrained list and fills in its arguments against a bounded subset of the tool's own JSON Schema. Lin checks the arguments again before anything happens.
- Ask first: the call becomes an approval card showing the exact arguments, and nothing runs until you approve. It runs once, and the receipt keeps the output. Auto runs it and shows a "From a connected tool" card with the output. Off hides the tool from Lin entirely and refuses it even if asked directly.
- Safety: tool descriptions and results are data, never instructions. A description that reads like instructions to Lin is flagged in Tools and hidden from the model. Results are cut to 6,000 characters, and calls time out after 90 seconds. Servers run as separate programs with your Windows permissions, and Lin's offline guard does not cover them; the Tools sheet says so. A crashed or missing server reports a clear error instead of hanging Lin. Approved calls run outside the global lock, so Lin stays responsive.
- Tests: voice/verify_mcp.py (10 checks) and design/verify-tools.cjs (browser: add the server, approval, Auto, Off, layout) run in Run-CommandChecks against the built-in test server voice/mcp_servers/lin_test_server.py.

## Speed and brain choice (22 October 2026)

- Voice uses 12 steps per sentence (you picked it from samples), and queued sentences are voiced in batches. Transcription runs on the GPU with a CPU fallback. Lin's process and the model process opt out of Windows power throttling. Rule-based answers now start speaking in 2.3–3.1 s (they were 4.5–5.2 s).
- Brain: voice/brain.json picks the model file. Qwen3.6-35B-A3B (UD-Q3_K_XL, 16.8 GB, SHA-256 verified) is installed as an option. In real use it started speaking chat answers in 13.5–15 s, against 8.3–10.5 s for Qwen3-4B under the same conditions, so the 4B stays the default.
- This laptop's speed varies about 2.5× with heat and load: llama-bench gave 9 tokens/s cool and 3.6 tokens/s after sustained work. Measure in the same state before comparing.
- Next for the brain: the llama.cpp GPU build, putting attention on the RTX 2050 and the experts in RAM, then re-measure the 35B.

## rea and fly-to-source (22 October 2026)

- rea (npm rea-agents 6.7.0, reverse engineering over MCP) is installed in tools/rea, not system-wide. It is registered in Tools as "rea", started with Node 24 and every tool set to Ask first. It uses Ghidra 12.1.4 (tools/ghidra_12.1.4_PUBLIC, SHA-256 verified against GitHub) and Temurin JDK 21.0.12.1 (tools/jdk-21.0.12.1+1, SHA-256 verified against Adoptium) through GHIDRA_INSTALL_DIR and JAVA_HOME. A read-only test inspection of whoami.exe succeeded. Lin shows the first 64 of its tools. Setup scripts: design/Install-Rea.cmd and design/Install-Ghidra.cmd (the Ghidra download resumes after a stall).
- Fly-to-source: when an answer comes from your notes ("Exact notes" or the notes tool), the map flies to the top source, opens it in the inspector and rings it in mint. Four or more sources frame and light the whole cluster instead. Small talk leaves the map where it is. Test: design/verify-fly.cjs, part of Run-CommandChecks.

## Feeling alive, and honest (23 October 2026)

- Live work panel (ui/work.js): every request records its stages on the server (job.steps), for example Understanding your request → Checking your saved tasks → Reading the exact answer from your data → Giving it a voice → Done. Each stage shows its time. The panel sits under the day ribbon, shows "Waiting for you" when an approval is pending, and fades out after it finishes.
- Greeting (presence.greeting, GET /api/greeting): built from real data, for example "Good evening, Aljho. Lin Brain has 28 notes and 6 memories. You have 3 open tasks, 1 high priority. Next today: …". It is shown when Lin opens and spoken once per session after your first click or key press, because browsers block sound before you interact. You can turn it off in About you → Conversation.
- The pearl follows Lin's real audio level: a halo and a core that swell with each word.
- What I couldn't check (voice/honesty.py): every answer lists what was not looked at, built only from what was actually checked. Examples: general knowledge, the saved facts that were used, words from your question that no matching note mentions, a missing or stale calendar, lists cut short, wording replaced by the exact summary, and unconfirmed tool output.
- Save to brain: the button next to Replay turns the finished answer into an approval card with an editable title. Approving writes a new note to Lin Brain/Saved answers (it never overwrites). The note holds what you asked, what Lin said, what was checked, [[links]] to the sources, and what couldn't be checked. It appears on the map and the map flies to it. Undo removes the note, but only if it has not been edited since. A note Lin saves itself does not count as stale knowledge, so the answer stays on screen.
- Tests: voice/verify_presence.py and design/verify-presence.cjs (also design/Run-PresenceCheck.cmd), both part of Run-CommandChecks.

## Neighbourhoods and the brain switch (23 October 2026)

- Neighbourhoods (graph.clusters_of): a note keeps its top folder (Capstone, Journal, Classes…). Everything else joins the neighbourhood it is most connected to, using deterministic label propagation in which links weigh most. Groups too small to name become Other. Every group carries its reason ("Notes in your Capstone folder, and the items they connect to most").
- On the map: new items start near their group, and a gentle pull keeps each group together. Zoomed out (below 0.75×) the map shows each group as a soft region with its name and size instead of every label. Clicking a name opens that group. Search finds groups as well as items and flies to the result. The left panel lists the neighbourhoods. A 2,000-item map still draws in about 21 ms per frame.
- Brain switch (About you → Brain): Fast is Qwen3 4B on the processor. Smart is Qwen3.6 35B with its experts in RAM and the rest on the graphics card (official llama.cpp b11669 CUDA 12.4 build in models/reasoning/runtime-cuda, SHA-256 verified, with q8 context cache). Switching takes about 50 s, needs no restart, and is recorded in voice/brain.json. If the GPU runtime cannot start, Lin falls back to the CPU and says so.
- Measured end to end on this laptop with the voice running (design/Run-GpuSweep.cmd):
  - 4B on the CPU: written answers start speaking in 5.8–7.1 s; simple answers in 1.8–2.3 s.
  - 4B fully on the GPU: written answers start writing in about 1.1 s, but because the voice shares the 4 GB card, first audio is no better (5.7 s) and simple answers get slower (3.9–6.2 s).
  - 35B on the GPU: writes 10–12 tokens per second (2.4 on the CPU alone); written answers start speaking in 6.4–7.9 s; simple answers in 5.5–12.6 s.
  - Decision: Fast stays the default; Smart is there for when quality matters. The limit is the 4 GB card shared with the voice (about 3.8 GB already in use). The next step would be shrinking the voice's graphics memory, for example a bf16 audio tokenizer or moving transcription back to the CPU.

## Documents in Lin Brain, and Google (23 October 2026)

- What Lin reads: text and Markdown (plus CSV, JSON, code and other plain text, including Windows ANSI files), PDF, scanned PDF pages, Word (.docx), PowerPoint (.pptx), Excel (.xlsx, .xls), OpenDocument (.odt, .ods, .odp), RTF, web pages, e-books (.epub), Outlook messages (.msg), Jupyter notebooks and photos or screenshots of text (.png, .jpg and others). Old .doc and .ppt files are listed with how to fix them (Save As .docx or .pptx).
- How: voice/docreader.py runs in its own Python (tools/docs-venv: Microsoft MarkItDown 0.1.9 and pypdfium2 5.14, installed by design/Install-DocReaders.cmd) and in its own process, with network access disabled, so a damaged or hostile file can only fail that process. Scanned pages and photos use Windows' built-in, offline text recognition (Windows.Media.Ocr, voice/ocr.ps1). Zip bombs over 300 MB, files over 64 MB, more than 300 PDF pages or more than 30 scanned pages per PDF are refused or cut, and Lin says so.
- When: new and changed documents are read in the background, six at a time, at below-normal priority, and never while Lin is answering. The text is cached in brain.sqlite3 (table extracts) against each file's size and modification time, so unchanged files are never read twice. An edited file is read again, and a deleted one leaves search and the cache. The folder scan is a cheap check every 3 s, with a full re-read on any change, on every explicit search, and at least once a minute. The limits are now 1,000 files and 48 MB of text.
- Citations: a passage never spans two pages, slides or sheets. Sources show "page 2", "slide 3" or "sheet Travel" and say what Lin read (for example "read from the PDF, with Windows text recognition for scanned pages"). The map uses the file name as a document's title.
- Honest failures: the Notes panel lists documents Lin could not read, each with a reason you can act on. Examples: "This PDF is password-protected. Save an unlocked copy so Lin can read it." and "This PDF is damaged or not really a PDF."
- Asking about a document: a question that names a file ("Summarize the harbor report", "What does pitch.pptx say about the launch?") makes Lin read that file. She uses the best-matching passages first, then the start, up to about 5,000 characters, in page order. She answers only from those passages and names the page. The card lists every passage she read, and the honesty line says whether that was the whole file and that nothing else was checked.
- Google Docs, Drive and Sheets: Tools → "Fill in Google Docs, Drive & Sheets" sets up workspace-mcp 2.1.2 (MIT, tools/gws-venv) with --single-user --tools docs drive sheets --read-only. Sign-in tokens are kept in voice/data/google, and the server will not start until you paste your own OAuth client ID, secret and Gmail address. "Sign in to Google" opens Google's own sign-in page in your browser, and only an accounts.google.com address is ever opened. The sign-in tool itself is Off for Lin, and every Google tool starts as Ask first. Google's answers are limited to 6,000 characters per call.
- Measured on this laptop: nine sample documents (Word, three PDFs, PowerPoint, Excel, ODT, RTF, HTML, a photo) were read in 16 s, including two OCR passes.
- Tests: voice/verify_docs.py with the invented samples in design/doc-samples (built by design/make_doc_samples.py), and design/verify-docs.cjs in the browser. Both are part of Run-CommandChecks. design/Run-DocCheck.cmd is the quick version, and design/Probe-Ocr.cmd diagnoses text recognition.

## The Orbit look, and a greeting with a soul (23 October 2026)

Chosen on the design canvas "Lin redesign" (page v2 · Orbit): Lin herself is the interface. It replaces Tidepool's look; Tidepool's map lives on as the Map section.

- Home: Lin opens on her emblem, with the day ring around it (today's calendar, the time now, the next event in amber), open tasks on the left, Lin Brain counts on the right and her greeting underneath. The map stays behind Home as a faint constellation; Map opens it fully with the inspector and lens. A labelled rail (Home, Map, Today, Plan, Notes, Activity, Tools, Settings) on the PC becomes a tab bar on the phone. The other sections open as sheets.
- The emblem (voice/ui/emblem.js) is drawn live: rings, a sweep, two orbits and an eye, eased between moods in one animation loop. Status colours always mean the same thing: cyan ready, violet thinking, amber waiting for your approval, gold seeing your screen (for Phase 5), grey offline. It follows her voice and the microphone level. On start-up the rings assemble in about 1.6 s while readouts under it report real checks (Voice, Brain, Memory, Calendar), amber with what still works while something loads; reopening within five minutes skips this.
- Answers wired to their sources: on wide windows the emblem steps aside with "How I got this" (each step and its time), the answer sits in the middle and the source and approval cards on the right, joined to the answer by a flowing line.
- Hold to approve: Approve fills a ring while held (0.7 s); a quick click does nothing. From the keyboard or a screen reader, press it twice within 3 s. The receipt with Undo stays on screen while Lin speaks the confirmation.
- The day ring is a slider: drag along it, or use the arrow keys, Home and End, to hear what's on at any time; Enter or tapping an event opens Today.
- Lin's sounds (voice/ui/sounds.js) are made on this PC with Web Audio: a chime when she listens, a soft hum while she thinks, a swish when you send, a click when you approve, two soft notes when a change waits, falling notes when something is blocked, and a wake-up chime. They never play over her voice and follow Mute and Settings > Look.
- Settings > Look: dark, light (blueprint) or match Windows; high contrast; calm motion (also automatic when Windows reduces animations); large captions; sounds. Tokens live in voice/ui/orbit.css and recolour every older panel, including the map canvas.
- Fonts stay built into Windows (Bahnschrift for readouts, Segoe UI Variable for reading), so the look is identical offline.
- Accessibility: every text and background pair passes 4.5:1 in both themes, targets are at least 24 px, every control has a name, and keyboard order runs rail, Home, then the line you type on.
- The greeting (voice/presence.py) is built from what matters right now: an opener for the time of day, weekend or how long you've been away, at most two real facts (a meeting about to start, documents read while you were away, the high-priority task), then a question tied to the last fact. Wording rotates between visits and a reload within 10 minutes keeps the same greeting (voice/data/presence.json).
- Fixed on the way: the saved-memories list in Notes had stopped loading after the Fast/Smart switch reused GET /api/brain; that endpoint now answers both.
- Next: Phase 3 builds the Windows app (Tauri) with the floating emblem, the tray and Ctrl+Space, which the Orbit mockups already show.

## Conversation memory (23 October 2026)

Phase 1. Lin keeps every conversation on this PC, with no Conversations panel: it all happens in the background (voice/conversations.py, voice/data/conversations.sqlite3; the demo has its own).

- Saved: each exchange (what you asked, what Lin said, what she checked and how it was verified) with its time, under a short title taken from your first question. Saving never blocks or breaks an answer.
- Picked back up: reloading or reopening Lin continues the latest conversation from the last 12 hours, with its last four exchanges back in her short-term memory; Settings shows "Picking up our conversation from 9:14 PM". "Clear conversation" starts a new one and keeps the old one saved.
- Recall: "What did we talk about yesterday?", "Did we ever discuss Chapter 4?", "Where did we leave off?" are answered only from saved turns (today, this morning, yesterday, last night, this or last week or month, N days ago, a weekday, or any time; plus the topic words). The card lists the turns she read with their times, the honesty line says only conversations were searched, and "nothing saved from last month" is said exactly rather than guessed. Earlier recall questions are not treated as answers.
- Privacy by voice: "Don't save this conversation" stops saving it at once (earlier turns stay until you ask to forget them); "start saving again" resumes. "Forget this conversation", "forget today's / yesterday's / this week's conversations" or "forget all conversations" shows an approval card with the exact count; after you hold to approve, the turns are gone from every answer at once, Undo works for 10 minutes, and then they are erased from the file (secure delete).
- Summaries: when a conversation has been quiet for three minutes and Lin has been idle for 90 seconds, the local brain writes a one-sentence summary on its own reasoning thread. A request arriving stops it at once (measured 0.1 s).
- Suggested memories: when you mention a dated fact about yourself ("my defense is on November 12"), a "Remember this?" card offers to save it as a memory. Nothing is saved unless you press Save, and facts already in your memories are not suggested again.
- Tests: voice/verify_conversations.py (store, rules, forget and undo through the action layer, secure erase, honesty, suggestions, summaries) and design/verify-memory.cjs in the browser with the real brain (save, reload, recall, private, forget). Both are in Run-CommandChecks.

## Claude as the online brain (23 October 2026)

Phase 2. Lin can hand a question to Claude, but only through Claude Code on this PC, signed in with the user's own Claude plan (voice/cloud_brain.py). Lin never holds a key, token or password, and its own process stays offline: the connection is Claude Code's.

- Settings, Brain, "Claude, when you want it": On this PC only (the default), Ask me first, or Claude for conversation, plus the model (Sonnet by default, Opus, Haiku). The status line shows the Claude Code version and "Signed in with your Claude plan", and how many questions went to Claude this week.
- Ask me first: quick questions stay local. Hard, open ones (explain, compare, write, code, long pasted text) get a "Send to Claude?" card showing the exact text that would be sent. Nothing is sent until he holds Send; "Answer on this PC" answers locally instead. An approval allows exactly one send of exactly that text, in that conversation, within 10 minutes. "Ask Claude …", "… ask Claude" and "send this to Claude" work in any mode except Off.
- Claude for conversation: everyday questions go straight to Claude. Tasks, notes, calendar, memories, documents, recall and tools are still answered from local data.
- What Claude sees: the question and, so a follow-up makes sense, the last exchange. Never notes, memories, tasks, calendar, profile or files, and nothing from a private conversation ("don't save this conversation" also keeps it off Claude).
- How Claude Code is run: `claude -p` reading the text from standard input, `--output-format stream-json --verbose --include-partial-messages`, `--tools ""` and `--disallowedTools "*"`, `--strict-mcp-config`, `--safe-mode` (no CLAUDE.md, skills, plugins, hooks or auto memory), `--disable-slash-commands`, `--no-session-persistence`, `--max-turns 1`, `--permission-mode dontAsk`, `--model`, and `--system-prompt-file` with Lin's spoken-answer identity. It runs in an empty folder (voice/runtime/claude-work), inside a Windows job so it never outlives Lin, with ANTHROPIC_* settings, CLAUDE_CODE_OAUTH_TOKEN and other-provider switches removed. Lin uses it only when `claude auth status` reports authMethod "claude.ai", never an API key or copied token. An older Claude Code that lacks an option is retried without it.
- Speaking and honesty: Claude's sentences are spoken as they stream. A "Sent to Claude" card shows the exact text, and the honesty lines say Claude saw only that text and that Lin did not check the answer. While Claude answers, the emblem turns coral (LINK · CLAUDE) and the place chip reads Online · Claude.
- Falling back: a usage limit (with its reset time), sign-in loss, no internet, an overloaded or stuck Claude Code are recognised within seconds. Lin says why ("Your Claude usage limit is reached, until about 4:10 PM, so I'll answer this one on this PC") and the local brain answers. If Claude stopped partway, what was already spoken stays and the card says so. Interrupt stops Claude Code at once.
- Records: voice/data/claude.json (the choice), voice/data/claude-sent.jsonl (when, which model, size and outcome only, never the words), and each send in Activity as "Sent to Claude".
- Setup: design/Install-ClaudeCode.cmd runs Anthropic's installer (irm https://claude.ai/install.ps1 | iex), then `claude auth login` so he signs in himself. Claude Code shares the plan's usage with claude.ai (five-hour and weekly limits).
- Tests: voice/verify_claude.py and design/verify-claude.cjs use voice/claude_stand_in.py, a stand-in that never connects anywhere, so the checks never use his plan. Both are in Run-CommandChecks.
- Next: Lin's own tools offered to Claude over MCP (read-only first, writes still through approval cards), and a weekly privacy report built from the send log.
