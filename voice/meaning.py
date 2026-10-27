"""Search by meaning, on this PC. A small local model (multilingual-e5-small, in voice/models/embeddings) turns each
note passage, saved memory and saved conversation turn into a list of 384 numbers that describe what it means, so
"the panel's worries" can find "Dr. Lea asked for load testing" even though no word is shared.

- Nothing leaves this PC: the model runs on the processor, offline, and the numbers are kept in voice/data/meaning.sqlite3.
- Indexing happens in the background, only while Lin is idle, a few passages at a time.
- What is forgotten or removed is dropped from the index on the next pass (and at once after "forget").
- Search mixes this with the existing word search (reciprocal rank fusion), so exact names still win.
Checked by verify_meaning.py (with a stand-in model) and, once the model is installed, by its real-model checks."""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import sqlite3
import threading
import time

import numpy as np

BASE = Path(__file__).resolve().parent
MODEL_DIR = BASE / 'models' / 'embeddings' / 'multilingual-e5-small'
# e5 similarities are squeezed together (on his PC: related pairs 0.72-0.85, unrelated 0.66-0.75), so a fixed cut-off
# cannot tell them apart. Instead each question is compared with a set of everyday sentences that are about nothing in
# particular (and with the rest of the index): a passage counts only if it stands out from that background by Z spreads.
FLOOR = 0.70          # never below this, whatever the background
Z = 2.0               # how far above the background (in standard deviations); set from verify_meaning.py on the real model
ANCHORS = ["The weather was warm and sunny all afternoon.", "She bought bread, milk and eggs at the market.",
           "The football match ended in a draw.", "He painted the fence a light shade of green.",
           "The train to the city leaves every twenty minutes.", "My favourite song came on the radio.",
           "We cooked rice and fried fish for dinner.", "The cat slept on the windowsill all day.",
           "They watched a movie about space travel.", "The shop closes early on public holidays.",
           "A new coffee place opened near the corner.", "The kids played basketball after school.",
           "It rained heavily during the night.", "The phone battery lasts about two days.",
           "Grandmother told stories about her village.", "The bus was crowded this morning.",
           "He planted tomatoes and peppers in the garden.", "The concert tickets sold out in an hour.",
           "She learned to swim when she was seven.", "The road to the beach was closed for repairs.",
           "We need to buy a new chair for the living room.", "The museum has a room full of old maps.",
           "Fresh mangoes are sweet this season.", "The printer ran out of ink again.",
           "A jeepney stopped right in front of the church.", "The dog barked at the delivery rider.",
           "Our neighbours are repainting their house.", "The noodles were too spicy for him.",
           "Traffic was slow because of the parade.", "He fixed the bicycle chain himself.",
           "The flowers bloomed early this year.", "She keeps her keys in a small blue bowl.",
           "The game update took an hour to download.", "We walked along the river at sunset.",
           "The bakery sells pandesal every morning.", "The fan in the kitchen makes a strange noise.",
           "There is a long queue at the bank today.", "He wore a red jacket to the party.",
           "The basketball court lights turn on at six.", "The laundry is drying on the line."]
RRF_K = 20


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:24]


class Embedder:
    """multilingual-e5-small on the CPU: mean pooling over the last layer, then unit length.
    It expects "query: " before a question and "passage: " before stored text."""
    name = 'multilingual-e5-small'

    def __init__(self, path=MODEL_DIR):
        import torch
        from transformers import AutoModel, AutoTokenizer
        if not (Path(path) / 'config.json').is_file():
            raise FileNotFoundError('The meaning model is not installed. Run design/Install-Meaning.cmd.')
        started = time.perf_counter()
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True)
        self.model = AutoModel.from_pretrained(str(path), local_files_only=True).eval()
        self.dim = int(self.model.config.hidden_size)
        self.load_seconds = round(time.perf_counter() - started, 2)

    def encode(self, texts, kind='passage', max_length=256):
        prefix = 'query: ' if kind == 'query' else 'passage: '
        batch = self.tokenizer([prefix + ' '.join(str(t).split()) for t in texts], padding=True, truncation=True,
                               max_length=max_length, return_tensors='pt')
        with self.torch.inference_mode():
            hidden = self.model(**batch).last_hidden_state
            mask = batch['attention_mask'].unsqueeze(-1).to(hidden.dtype)
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1)
            pooled = self.torch.nn.functional.normalize(pooled, dim=-1)
        return pooled.float().numpy()


class MeaningIndex:
    def __init__(self, data_dir, embedder=None, loader=Embedder, floor=FLOOR, z=Z):
        self.path = Path(data_dir) / 'meaning.sqlite3'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.floor, self.z = floor, z
        self.anchors = None
        self.encode_lock = threading.Lock()   # one encode at a time (the background pass and a question can overlap)
        self.embedder = embedder
        self.loader = loader
        self.error = None
        self.matrix, self.ids, self.kinds = None, [], []
        self.indexed_at = None
        self.pending = 0
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY, kind TEXT NOT NULL, digest TEXT NOT NULL, '
                       'model TEXT NOT NULL, vec BLOB NOT NULL)')

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.path)
            db.execute('PRAGMA secure_delete=ON')
            try:
                with db:
                    yield db
            finally:
                db.close()

    # ---- the model ----------------------------------------------------------
    def ready(self):
        return self.embedder is not None

    def load(self):
        """Load the model once (about a second); returns False if it is not installed."""
        if self.embedder is not None:
            return True
        try:
            self.embedder = self.loader()
            self.error = None
            return True
        except FileNotFoundError as exc:
            self.error = str(exc)
        except Exception as exc:   # a broken install must never stop Lin
            self.error = f'The meaning model could not load ({type(exc).__name__}).'
        return False

    def status(self):
        with self.lock:
            return {'ready': self.ready(), 'items': len(self.ids), 'pending': self.pending, 'error': self.error,
                    'model': getattr(self.embedder, 'name', None), 'indexed_at': self.indexed_at}

    # ---- keeping the index in step -------------------------------------------
    def sync(self, items, stop=lambda: False, batch=16):
        """items: (id, kind, text) for everything that should be searchable. Removes what is gone, adds what is new
        or changed. Stops early (and resumes next time) when stop() says Lin is busy. Returns how many were added."""
        if not self.load():
            return 0
        model = self.embedder.name
        wanted = {i: (k, t, digest(t)) for i, k, t in items if t and t.strip()}
        with self.db() as db:
            have = {r[0]: (r[1], r[2]) for r in db.execute('SELECT id, digest, model FROM vectors')}
            gone = [i for i in have if i not in wanted]
            db.executemany('DELETE FROM vectors WHERE id=?', [(i,) for i in gone])
        todo = [(i, *wanted[i]) for i in wanted if have.get(i) != (wanted[i][2], model)]
        self.pending = len(todo)
        added = 0
        for n in range(0, len(todo), batch):
            if stop():
                break
            chunk = todo[n:n + batch]
            with self.encode_lock:
                vectors = self.embedder.encode([t for _, _, t, _ in chunk], 'passage')
            with self.db() as db:
                db.executemany('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?,?)',
                               [(i, k, d, model, v.astype(np.float16).tobytes()) for (i, k, _, d), v in zip(chunk, vectors)])
            added += len(chunk)
            self.pending = len(todo) - added
        if gone or added or self.matrix is None:
            self.reload()
        self.indexed_at = time.time()
        return added

    def prune(self, kind, keep):
        """Drop every vector of this kind that is not in keep, at once (used right after "forget this conversation")."""
        keep = set(keep)
        with self.db() as db:
            gone = [(r[0],) for r in db.execute('SELECT id FROM vectors WHERE kind=?', (kind,)) if r[0] not in keep]
            db.executemany('DELETE FROM vectors WHERE id=?', gone)
        if gone:
            self.reload()
        return len(gone)

    def reload(self):
        with self.db() as db:
            rows = db.execute('SELECT id, kind, vec FROM vectors ORDER BY id').fetchall()
        with self.lock:
            self.ids = [r[0] for r in rows]
            self.kinds = np.array([r[1] for r in rows]) if rows else np.array([])
            self.matrix = (np.stack([np.frombuffer(r[2], dtype=np.float16) for r in rows]).astype(np.float32)
                           if rows else np.zeros((0, 1), dtype=np.float32))

    # ---- searching -----------------------------------------------------------
    def background(self):
        """The everyday sentences, embedded once."""
        if self.anchors is None:
            with self.encode_lock:
                self.anchors = self.embedder.encode(ANCHORS, 'passage')
        return self.anchors

    def standout(self, q, scores):
        """How far each score stands above this question's background (everyday sentences plus the index), in spreads."""
        bg = np.concatenate([self.background() @ q, scores])
        mu, sd = float(bg.mean()), max(float(bg.std()), 0.01)
        return (scores - mu) / sd

    def search(self, query, kind=None, k=8, floor=None, z=None):
        """[(id, similarity)] best first: only passages that stand out from the background by z spreads and are
        above the floor. Empty when the model or the index is not ready."""
        floor = self.floor if floor is None else floor
        z = self.z if z is None else z
        if not self.ready() or self.matrix is None or not len(self.ids) or not str(query).strip():
            return []
        with self.encode_lock:
            q = self.embedder.encode([query], 'query', max_length=64)[0]
        with self.lock:
            scores = self.matrix @ q
            lift = self.standout(q, scores)
            if kind:
                kinds = kind if isinstance(kind, (set, tuple, list)) else (kind,)
                scores = np.where(np.isin(self.kinds, list(kinds)), scores, -1.0)
            order = np.argsort(-scores)[:k]
            return [(self.ids[i], float(scores[i])) for i in order if scores[i] >= floor and lift[i] >= z]


def fuse(word_ids, meaning_hits, limit=3):
    """Reciprocal rank fusion of the word search and the meaning search. Returns [(id, how)] where how is
    'words', 'meaning' or 'both' (shown on the card)."""
    scores, how = {}, {}
    for rank, i in enumerate(word_ids):
        scores[i] = scores.get(i, 0) + 1 / (RRF_K + rank + 1)
        how[i] = 'words'
    for rank, (i, _) in enumerate(meaning_hits):
        scores[i] = scores.get(i, 0) + 1 / (RRF_K + rank + 1)
        how[i] = 'both' if how.get(i) == 'words' else 'meaning'
    best = sorted(scores, key=lambda i: -scores[i])[:limit]
    return [(i, how[i]) for i in best]
