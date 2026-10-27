"""Conversation memory: every exchange with Lin, kept on this computer.

Backend only (there is no Conversations panel). Each turn stores what you asked, what Lin said, what she
checked and when. Lin can search it to answer "what did we talk about yesterday?", a reload picks the
conversation back up, and you control it by voice: "don't save this conversation", "forget today's
conversations". Forgotten turns leave every search at once and are erased for good after ten minutes,
which is how long Undo stays available.
"""
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, time as dtime
from pathlib import Path
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Manila')
UNDO_MINUTES = 10
MAX_TEXT = 4000

def local_now():
    return datetime.now(ZONE)

def iso(dt):
    return dt.astimezone(ZONE).isoformat(timespec='seconds')

def title_from(question):
    """A short title from the first thing you asked, without filler at the start."""
    text = ' '.join(str(question).split())
    for _ in range(3):
        text = re.sub(r"^(hey|hi|hello|okay|ok|so|um+|uh+|lin)[,!.\s]+", '', text, flags=re.I)
    text = text[:1].upper() + text[1:]
    return text if len(text) <= 60 else text[:59].rsplit(' ', 1)[0] + '…'


class ConversationStore:
    def __init__(self, data_dir):
        self.path = Path(data_dir) / 'conversations.sqlite3'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    title TEXT NOT NULL, summary TEXT, summary_turns INTEGER NOT NULL DEFAULT 0, private INTEGER NOT NULL DEFAULT 0,
                    turns INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS turns(id INTEGER PRIMARY KEY AUTOINCREMENT, conversation TEXT NOT NULL, at TEXT NOT NULL,
                    question TEXT NOT NULL, answer TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}');
                CREATE INDEX IF NOT EXISTS turns_by_time ON turns(at);
                CREATE INDEX IF NOT EXISTS turns_by_conversation ON turns(conversation, id);
                CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(question, answer, content='turns', content_rowid='id',
                    tokenize='porter unicode61');
                CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
                    INSERT INTO turns_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer); END;
                CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
                    INSERT INTO turns_fts(turns_fts, rowid, question, answer) VALUES('delete', old.id, old.question, old.answer); END;
                CREATE TABLE IF NOT EXISTS trash(batch TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, purge_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
                INSERT OR IGNORE INTO meta VALUES(1, 0);
            ''')
        self.purge()

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.path)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA secure_delete=ON')  # erased text is overwritten, not left in free pages
            try:
                with db:
                    yield db
            finally:
                db.close()

    def _bump(self, db):
        db.execute('UPDATE meta SET revision=revision+1')

    def revision(self):
        with self.db() as db:
            return db.execute('SELECT revision FROM meta').fetchone()[0]

    # ---- saving ------------------------------------------------------------------------------------
    def is_private(self, conversation):
        with self.db() as db:
            row = db.execute('SELECT private FROM conversations WHERE id=?', (conversation,)).fetchone()
            return bool(row and row['private'])

    def set_private(self, conversation, private, now=None):
        """Private stops saving from now on; what was saved before stays until you ask Lin to forget it."""
        stamp = iso(now or local_now())
        with self.db() as db:
            db.execute('INSERT OR IGNORE INTO conversations(id, started_at, updated_at, title) VALUES(?,?,?,?)',
                       (conversation, stamp, stamp, 'Private conversation'))
            db.execute('UPDATE conversations SET private=? WHERE id=?', (1 if private else 0, conversation))
            self._bump(db)
            return db.execute('SELECT turns FROM conversations WHERE id=?', (conversation,)).fetchone()['turns']

    def add_turn(self, conversation, question, answer, meta=None, now=None):
        """Save one exchange. Returns False (and saves nothing) when the conversation is private."""
        stamp = iso(now or local_now())
        question, answer = str(question)[:MAX_TEXT], str(answer)[:MAX_TEXT]
        with self.db() as db:
            row = db.execute('SELECT private FROM conversations WHERE id=?', (conversation,)).fetchone()
            if row and row['private']:
                return False
            if not row:
                db.execute('INSERT INTO conversations(id, started_at, updated_at, title) VALUES(?,?,?,?)',
                           (conversation, stamp, stamp, title_from(question)))
            db.execute('INSERT INTO turns(conversation, at, question, answer, meta) VALUES(?,?,?,?,?)',
                       (conversation, stamp, question, answer, json.dumps(meta or {}, ensure_ascii=False)))
            db.execute('UPDATE conversations SET updated_at=?, turns=turns+1 WHERE id=?', (stamp, conversation))
            self._bump(db)
        return True

    # ---- reading -----------------------------------------------------------------------------------
    def history(self, conversation, turns=4):
        """The last few exchanges as chat messages, so a reopened Lin continues the conversation."""
        with self.db() as db:
            rows = db.execute('SELECT question, answer FROM turns WHERE conversation=? ORDER BY id DESC LIMIT ?',
                              (conversation, turns)).fetchall()
        out = []
        for r in reversed(rows):
            out += [{'role': 'user', 'content': r['question']}, {'role': 'assistant', 'content': r['answer']}]
        return out

    def latest(self, within_hours=12, now=None):
        """The most recent saved conversation, if it was active recently enough to pick back up."""
        since = iso((now or local_now()) - timedelta(hours=within_hours))
        with self.db() as db:
            row = db.execute('SELECT * FROM conversations WHERE private=0 AND turns>0 AND updated_at>=? ORDER BY updated_at DESC LIMIT 1',
                             (since,)).fetchone()
            if not row:
                return None
            last = db.execute('SELECT question, answer, at FROM turns WHERE conversation=? ORDER BY id DESC LIMIT 1', (row['id'],)).fetchone()
        return {'id': row['id'], 'title': row['title'], 'updated_at': row['updated_at'], 'turns': row['turns'],
                'last': dict(last) if last else None}

    def get(self, conversation):
        with self.db() as db:
            row = db.execute('SELECT * FROM conversations WHERE id=?', (conversation,)).fetchone()
            return dict(row) if row else None

    def find(self, words=(), start=None, end=None, exclude=None, limit=12):
        """Saved turns that match the words (any of them) within the period, best first, then newest."""
        # Earlier "what did we talk about…" questions are not themselves answers to a recall.
        args, where = [], ['c.private=0', "coalesce(json_extract(t.meta, '$.tool'), '') NOT IN ('conversations', 'privacy', 'forget_conversations')"]
        if start:
            where.append('t.at>=?'); args.append(iso(start))
        if end:
            where.append('t.at<?'); args.append(iso(end))
        if exclude:
            where.append('t.conversation!=?'); args.append(exclude)
        with self.db() as db:
            if words:
                expression = ' OR '.join('"' + w.replace('"', '') + '"' for w in dict.fromkeys(words))
                sql = ('SELECT t.*, c.title, c.summary FROM turns_fts f JOIN turns t ON t.id=f.rowid JOIN conversations c ON c.id=t.conversation '
                       f'WHERE turns_fts MATCH ? AND {" AND ".join(where)} ORDER BY bm25(turns_fts, 2, 1), t.at DESC LIMIT ?')
                rows = db.execute(sql, [expression, *args, limit]).fetchall()
            else:
                sql = (f'SELECT t.*, c.title, c.summary FROM turns t JOIN conversations c ON c.id=t.conversation WHERE {" AND ".join(where)} '
                       'ORDER BY t.at DESC LIMIT ?')
                rows = db.execute(sql, [*args, limit]).fetchall()
        out = [dict(r) for r in rows]
        for r in out:
            r['meta'] = json.loads(r['meta'] or '{}')
        return sorted(out, key=lambda r: r['at'])

    def index_items(self):
        """Every saved turn, for search by meaning (meaning.py): (id, kind, text). Private conversations are never
        saved, and earlier recall, privacy and forget requests are left out, as in find()."""
        with self.db() as db:
            rows = db.execute("SELECT t.id, t.question, t.answer FROM turns t JOIN conversations c ON c.id=t.conversation "
                              "WHERE c.private=0 AND coalesce(json_extract(t.meta, '$.tool'), '') NOT IN "
                              "('conversations', 'privacy', 'forget_conversations')").fetchall()
        return [(f'turn:{r[0]}', 'turn', f'{r[1]}\n{r[2]}') for r in rows]

    def by_ids(self, ids, start=None, end=None, exclude=None):
        """The turns with these ids (from a meaning search), within the period, in the same shape as find()."""
        ids = [int(i) for i in ids][:50]
        if not ids:
            return []
        args, where = list(ids), [f"t.id IN ({','.join('?' * len(ids))})", 'c.private=0']
        if start:
            where.append('t.at>=?'); args.append(iso(start))
        if end:
            where.append('t.at<?'); args.append(iso(end))
        if exclude:
            where.append('t.conversation!=?'); args.append(exclude)
        with self.db() as db:
            rows = db.execute(f'SELECT t.*, c.title, c.summary FROM turns t JOIN conversations c ON c.id=t.conversation '
                              f'WHERE {" AND ".join(where)}', args).fetchall()
        out = [dict(r) for r in rows]
        for r in out:
            r['meta'] = json.loads(r['meta'] or '{}')
        return sorted(out, key=lambda r: r['at'])

    def count(self, start=None, end=None, conversation=None):
        args, where = [], ['1=1']
        if start:
            where.append('at>=?'); args.append(iso(start))
        if end:
            where.append('at<?'); args.append(iso(end))
        if conversation:
            where.append('conversation=?'); args.append(conversation)
        with self.db() as db:
            turns = db.execute(f'SELECT count(*) FROM turns WHERE {" AND ".join(where)}', args).fetchone()[0]
            convs = db.execute(f'SELECT count(DISTINCT conversation) FROM turns WHERE {" AND ".join(where)}', args).fetchone()[0]
        return {'turns': turns, 'conversations': convs}

    def private_count(self):
        with self.db() as db:
            return db.execute('SELECT count(*) FROM conversations WHERE private=1').fetchone()[0]

    def stats(self):
        with self.db() as db:
            c = db.execute('SELECT count(*), coalesce(sum(turns),0) FROM conversations WHERE turns>0').fetchone()
            first = db.execute('SELECT min(at) FROM turns').fetchone()[0]
            return {'conversations': c[0], 'turns': c[1], 'since': first, 'revision': db.execute('SELECT revision FROM meta').fetchone()[0]}

    # ---- summaries ---------------------------------------------------------------------------------
    def needs_summary(self, idle_minutes=5, now=None):
        """A conversation with something new to summarise that has been quiet for a few minutes."""
        before = iso((now or local_now()) - timedelta(minutes=idle_minutes))
        with self.db() as db:
            row = db.execute('SELECT id FROM conversations WHERE private=0 AND turns>=2 AND turns>summary_turns AND updated_at<? '
                             'ORDER BY updated_at DESC LIMIT 1', (before,)).fetchone()
            if not row:
                return None
            turns = db.execute('SELECT question, answer FROM turns WHERE conversation=? ORDER BY id LIMIT 12', (row['id'],)).fetchall()
            total = db.execute('SELECT turns FROM conversations WHERE id=?', (row['id'],)).fetchone()[0]
        return {'id': row['id'], 'turns': total, 'transcript': '\n'.join(f"Me: {t['question'][:300]}\nLin: {t['answer'][:300]}" for t in turns)}

    def set_summary(self, conversation, summary, turns):
        summary = ' '.join(str(summary).split())[:300]
        with self.db() as db:
            db.execute('UPDATE conversations SET summary=?, summary_turns=? WHERE id=?', (summary, turns, conversation))
            self._bump(db)

    # ---- forgetting --------------------------------------------------------------------------------
    def preview_forget(self, scope, conversation=None, now=None):
        start, end, label = forget_window(scope, now)
        if scope == 'this':
            counts = self.count(conversation=conversation)
        else:
            counts = self.count(start, end)
        return {'scope': scope, 'label': label, 'conversation': conversation if scope == 'this' else None,
                'start': iso(start) if start else None, 'end': iso(end) if end else None, **counts}

    def forget(self, payload, batch, now=None):
        """Move the matching turns (and emptied conversations) to the trash: gone from every answer now,
        erased for good after UNDO_MINUTES. Returns how many turns were forgotten."""
        now = now or local_now()
        purge_at = iso(now + timedelta(minutes=UNDO_MINUTES))
        args, where = [], []
        if payload.get('conversation'):
            where.append('conversation=?'); args.append(payload['conversation'])
        if payload.get('start'):
            where.append('at>=?'); args.append(payload['start'])
        if payload.get('end'):
            where.append('at<?'); args.append(payload['end'])
        clause = ' AND '.join(where) or '1=1'
        with self.db() as db:
            rows = db.execute(f'SELECT * FROM turns WHERE {clause}', args).fetchall()
            touched = {r['conversation'] for r in rows}
            for r in rows:
                db.execute('INSERT INTO trash VALUES(?,?,?,?)', (batch, 'turn', json.dumps(dict(r), ensure_ascii=False), purge_at))
            db.execute(f'DELETE FROM turns WHERE {clause}', args)
            for cid in touched:
                left = db.execute('SELECT count(*) FROM turns WHERE conversation=?', (cid,)).fetchone()[0]
                conv = db.execute('SELECT * FROM conversations WHERE id=?', (cid,)).fetchone()
                db.execute('INSERT INTO trash VALUES(?,?,?,?)', (batch, 'conversation', json.dumps(dict(conv), ensure_ascii=False), purge_at))
                if left:
                    # The summary may describe what was forgotten, so it goes too and is written again later.
                    db.execute('UPDATE conversations SET turns=?, summary=NULL, summary_turns=0 WHERE id=?', (left, cid))
                else:
                    db.execute('DELETE FROM conversations WHERE id=? AND private=0', (cid,))
                    db.execute('UPDATE conversations SET turns=0, summary=NULL, summary_turns=0 WHERE id=?', (cid,))
            self._bump(db)
        return len(rows)

    def restore(self, batch):
        """Undo a forget while its batch is still in the trash."""
        self.purge()
        with self.db() as db:
            items = db.execute('SELECT kind, data FROM trash WHERE batch=?', (batch,)).fetchall()
            if not items:
                return None
            for item in items:
                d = json.loads(item['data'])
                if item['kind'] == 'conversation':
                    db.execute('INSERT OR REPLACE INTO conversations(id, started_at, updated_at, title, summary, summary_turns, private, turns) '
                               'VALUES(?,?,?,?,?,?,?,?)', (d['id'], d['started_at'], d['updated_at'], d['title'], d['summary'],
                                                         d['summary_turns'], d['private'], d['turns']))
            restored = 0
            for item in items:
                if item['kind'] == 'turn':
                    d = json.loads(item['data'])
                    db.execute('INSERT OR IGNORE INTO turns(id, conversation, at, question, answer, meta) VALUES(?,?,?,?,?,?)',
                               (d['id'], d['conversation'], d['at'], d['question'], d['answer'], d['meta']))
                    restored += 1
            for cid in {json.loads(i['data'])['id'] for i in items if i['kind'] == 'conversation'}:
                n = db.execute('SELECT count(*) FROM turns WHERE conversation=?', (cid,)).fetchone()[0]
                db.execute('UPDATE conversations SET turns=? WHERE id=?', (n, cid))
            db.execute('DELETE FROM trash WHERE batch=?', (batch,))
            self._bump(db)
        return restored

    def purge(self, now=None):
        with self.db() as db:
            gone = db.execute('DELETE FROM trash WHERE purge_at<=?', (iso(now or local_now()),)).rowcount
            if gone:
                db.execute("INSERT INTO turns_fts(turns_fts) VALUES('optimize')")
        return gone


# ---- understanding requests -------------------------------------------------------------------------
RECALL = re.compile(
    r"\b(?:what|which|when|where)\b[^?]{0,40}\b(?:did|have|were)\s+(?:we|i|you)\b[^?]{0,30}\b(?:talk(?:ed|ing)?|chat(?:ted)?|discuss(?:ed)?|"
    r"say|said|ask(?:ed)?|tell|told|mention(?:ed)?|decide(?:d)?|agree(?:d)?|plan(?:ned)?)\b"
    r"|\bdid\s+(?:we|i)\s+(?:ever\s+|already\s+)?(?:talk|chat|discuss|mention|ask|tell you)\b"
    r"|\b(?:remind me|recap|summari[sz]e|go over)\b[^?]{0,30}\b(?:conversation|chat|talk|discussion)s?\b"
    r"|\b(?:our|the)\s+(?:last|previous|earlier|yesterday'?s?)\s+(?:conversation|chat|talk|discussion)\b"
    r"|\bwhat\s+were\s+we\s+(?:talking|chatting)\s+about\b"
    r"|\bwhere\s+(?:were|did)\s+we\s+(?:leave\s+off|stop)\b", re.I)
PRIVATE_ON = re.compile(r"^\s*(?:lin[, ]+)?(?:please\s+)?(?:don'?t|do not|stop)\s+(?:save|saving|record|recording|keep|keeping)\b"
                        r"(?:\s+(?:this|our|the|any|anything))?(?:\s+(?:conversation|chat|talk|of this))?\s*[.!]?\s*$|^\s*(?:go\s+)?(?:private|incognito)(?:\s+mode)?\s*(?:on|please)?\s*[.!]?\s*$"
                        r"|^\s*(?:this is|keep this)\s+(?:off the record|private)\b", re.I)
PRIVATE_OFF = re.compile(r"^\s*(?:lin[, ]+)?(?:please\s+)?(?:start|resume|keep)\s+(?:saving|recording)\b|^\s*save\s+this\s+conversation\b"
                         r"|^\s*(?:private|incognito)(?:\s+mode)?\s+off\b", re.I)
FORGET = re.compile(r"^\s*(?:lin[, ]+)?(?:please\s+)?(?:forget|delete|erase|remove|clear)\s+(?:all\s+(?:of\s+)?)?(?:the\s+|my\s+|our\s+)?"
                    r"(?P<what>this|that|today'?s?|yesterday'?s?|this\s+week'?s?|every|all|everything|the\s+last)?\s*"
                    r"(?:conversations?|chats?|talks?|chat history|conversation history|what we (?:talked|said) about)\b", re.I)

def recall_request(text):
    return bool(RECALL.search(text or ''))

def privacy_request(text):
    """'on' (don't save this), 'off' (start saving again) or None."""
    if PRIVATE_OFF.search(text or ''):
        return 'off'
    if PRIVATE_ON.search(text or ''):
        return 'on'
    return None

def forget_request(text):
    """The scope to forget: 'this', 'today', 'yesterday', 'week' or 'all'; None if this is not a forget request."""
    m = FORGET.search(text or '')
    if not m:
        return None
    what = (m.group('what') or '').lower()
    if what.startswith('today'):
        return 'today'
    if what.startswith('yesterday'):
        return 'yesterday'
    if 'week' in what:
        return 'week'
    if what in ('all', 'every', 'everything') or re.search(r'\ball\b|\bevery\b|history', text, re.I):
        return 'all'
    return 'this'

def day_start(d):
    return datetime.combine(d, dtime.min, ZONE)

def forget_window(scope, now=None):
    now = now or local_now()
    today = day_start(now.date())
    if scope == 'today':
        return today, None, 'today'
    if scope == 'yesterday':
        return today - timedelta(days=1), today, 'yesterday'
    if scope == 'week':
        return today - timedelta(days=now.weekday()), None, 'this week'
    if scope == 'all':
        return None, None, 'every saved conversation'
    return None, None, 'this conversation'

DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
NUMBERS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'a couple of': 2, 'a few': 3}

def period(text, now=None):
    """The time a recall question is about: (start, end, label), or (None, None, None) for any time."""
    now = now or local_now()
    t = (text or '').lower()
    today = day_start(now.date())
    if re.search(r'\bthis morning\b', t):
        return today, today + timedelta(hours=12), 'this morning'
    if re.search(r'\b(today|earlier today|tonight|this afternoon|this evening)\b', t):
        return today, None, 'today'
    if re.search(r'\blast night\b', t):
        return today - timedelta(hours=6), today + timedelta(hours=4), 'last night'
    if re.search(r'\byesterday\b', t):
        return today - timedelta(days=1), today, 'yesterday'
    if re.search(r'\bthis week\b', t):
        return today - timedelta(days=now.weekday()), None, 'this week'
    if re.search(r'\blast week\b', t):
        start = today - timedelta(days=now.weekday() + 7)
        return start, start + timedelta(days=7), 'last week'
    if re.search(r'\bthis month\b', t):
        return day_start(now.date().replace(day=1)), None, 'this month'
    if re.search(r'\blast month\b', t):
        first = now.date().replace(day=1)
        prev = (first - timedelta(days=1)).replace(day=1)
        return day_start(prev), day_start(first), 'last month'
    m = re.search(r'\b(\d+|one|two|three|four|five|six|seven|a couple of|a few)\s+days?\s+ago\b', t)
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else NUMBERS[m.group(1)]
        start = today - timedelta(days=n)
        return start, start + timedelta(days=1), f'{n} day{"s" if n != 1 else ""} ago'
    for i, name in enumerate(DAYS):
        if re.search(rf'\b(?:on |last )?{name}\b', t):
            back = (now.weekday() - i) % 7 or 7
            start = today - timedelta(days=back)
            return start, start + timedelta(days=1), f"on {name.title()} ({start.strftime('%b')} {start.day})"
    return None, None, None

RECALL_STOP = set('what which when where did have were we i you talk talked talking chat chatted discuss discussed say said ask asked tell '
                  'told mention mentioned decide decided agree agreed plan planned about remind me recap summarize summarise go over our '
                  'last previous earlier conversation conversations chat chats discussion discussions ever already today yesterday week '
                  'month this that morning night tonight afternoon evening ago days day monday tuesday wednesday thursday friday saturday '
                  'sunday lin the a an of on in at to and or for with time times leave off stop us it its is was be any anything something '
                  'everything there here back'.split())

def topic_words(text):
    words = []
    for w in re.findall(r"[a-z0-9][a-z0-9'-]+", (text or '').lower()):
        w = w.strip("'-")
        if len(w) >= 3 and w not in RECALL_STOP and not w.isdigit() and w not in words:
            words.append(w)
    return words[:6]

def when_text(at, now=None):
    dt = datetime.fromisoformat(at).astimezone(ZONE)
    now = now or local_now()
    days = (now.date() - dt.date()).days
    clock = dt.strftime('%I:%M %p').lstrip('0')
    if days == 0:
        return f'today at {clock}'
    if days == 1:
        return f'yesterday at {clock}'
    if days < 7:
        return f"{dt.strftime('%A')} at {clock}"
    return f"{dt.strftime('%b')} {dt.day} at {clock}"


# ---- suggested memories ---------------------------------------------------------------------------
DATEISH = re.compile(r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|"
                     r"nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next (?:week|month)|"
                     r"\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?:st|nd|rd|th)?)\b", re.I)
STATEMENTS = [
    re.compile(r"\bmy ([a-z][a-z' -]{2,40}?) (?:is|are|will be|has been moved to|got moved to|was moved to) (?:on |at |in |due |this |next )?([^.?!,;]{3,50})", re.I),
    re.compile(r"\bi (?:have|'ve got|got|will have) (?:a|an|my) ([a-z][a-z' -]{2,40}?) (?:on|at|this|next|due) ([^.?!,;]{3,50})", re.I),
]

def suggest_memory(question):
    """A fact you stated about yourself, with a date or time, that Lin can offer to remember. Never saved without you."""
    q = ' '.join(str(question or '').split())
    if re.match(r'^\s*(remember|forget|don\'?t|do not)\b', q, re.I) or len(q) > 400:
        return None
    for pattern in STATEMENTS:
        m = pattern.search(q)
        if m and DATEISH.search(m.group(2)):
            subject = ' '.join(m.group(1).split())
            if subject.lower() in ('name', 'favorite', 'favourite') or len(subject.split()) > 6:
                continue
            when = m.group(2).strip()
            fact = q[m.start():m.end()].strip()
            fact = fact[0].upper() + fact[1:]
            if not fact.endswith('.'):
                fact += '.'
            title = subject[:1].upper() + subject[1:]
            if not re.search(r'\b(date|time|day|deadline)\b', title, re.I):
                title += ' date'
            return {'title': title[:80], 'fact': fact[:500], 'scope': 'personal', 'when': when}
    return None
