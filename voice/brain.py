"""Local notes, documents and explicit durable memory. No model-selected paths or writes.

Plain-text notes are read here. Documents (PDF, Word, PowerPoint, Excel, OpenDocument, RTF, e-books, web pages,
Outlook messages, photos and scans) are read by docreader.py in its own Python and its own process, one small
batch at a time in the background; the text it returns is cached in the `extracts` table against the file's
size and modification time and indexed exactly like a note."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import textwrap
import threading
import time

MAX_FILE_BYTES = 256*1024           # one plain-text note
MAX_DOC_BYTES = 64*1024*1024        # one document handed to the reader
MAX_DOC_TEXT = 400_000              # characters kept from one document
MAX_FILES = 1000
MAX_TEXT_TOTAL = 48*1024*1024
MAX_VISITED = 20000
READER_BATCH = 6
LIMIT = 'Scan limit reached; only part of the folder is available.'
TEXT_TYPES = set('.txt .md .markdown .log .csv .tsv .json .xml .yaml .yml .toml .ini .cfg .tex .srt .vtt '
                 '.py .js .ts .java .c .cpp .h .cs .css .sql .ps1 .sh .bat'.split())
DOC_TYPES = set('.pdf .docx .pptx .xlsx .xls .msg .epub .html .htm .ipynb .odt .ods .odp .rtf '
                '.png .jpg .jpeg .bmp .gif .tif .tiff .webp'.split())
OLD_OFFICE = {'.doc': ('Word', '.docx'), '.ppt': ('PowerPoint', '.pptx')}
SHEET_TYPES = {'.xlsx', '.xls', '.ods'}
METHODS = {'pdf': 'the PDF text', 'pdf+ocr': 'the PDF, with Windows text recognition for scanned pages',
           'ocr': 'the picture, with Windows text recognition', 'markitdown': 'the document text',
           'opendocument': 'the document text', 'rtf': 'the document text'}
PAGE = re.compile(r'^## Page (\d+)$')
SLIDE = re.compile(r'^<!-- Slide number: (\d+) -->$')
SHEET = re.compile(r'^## (.{1,80})$')
STOP = set('a an the i me my we our you your it is are was were be been to of in on at for from and or with this that what which how do does did can could would please search brain remember tell about have has saved memory notes note file files'.split())

def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def terms(text):
    return [w for w in re.findall(r'[^\W_]+', text.lower(), re.UNICODE) if len(w)>1 and w not in STOP][:20]

def plain(value, limit, name):
    if not isinstance(value, str) or not value.strip() or len(value)>limit or '\x00' in value:
        raise ValueError(f'{name} must contain 1 to {limit} characters.')
    return value.strip()

def no_link(path):
    info = path.lstat()
    return not (stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0) & 0x400)

def read_note(path, root):
    """Validate the opened handle, not only the path checked before opening it."""
    if not no_link(path) or not path.resolve().is_relative_to(root):
        raise ValueError('Linked files are excluded.')
    with path.open('rb') as stream:
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            import msvcrt
            api = ctypes.WinDLL('kernel32',use_last_error=True)
            fn = api.GetFinalPathNameByHandleW
            fn.argtypes = [wintypes.HANDLE,wintypes.LPWSTR,wintypes.DWORD,wintypes.DWORD]
            fn.restype = wintypes.DWORD
            buffer = ctypes.create_unicode_buffer(32768)
            length = fn(msvcrt.get_osfhandle(stream.fileno()),buffer,len(buffer),0)
            if not length or length>=len(buffer):
                raise ValueError('Cannot verify the opened file.')
            final = buffer.value
            if final.startswith('\\\\?\\'):
                final = final[4:]
            if not Path(final).is_relative_to(root):
                raise ValueError('Opened file is outside Lin Brain.')
        data = stream.read(MAX_FILE_BYTES+1)
        info = os.fstat(stream.fileno())
    if len(data)>MAX_FILE_BYTES or b'\x00' in data:
        raise ValueError('File is too large or not plain text.')
    try:
        return data.decode('utf-8-sig'), info.st_mtime_ns
    except UnicodeDecodeError:  # Windows programs (Excel, Notepad) often save CSV and text as ANSI
        return data.decode('cp1252', errors='replace'), info.st_mtime_ns

def wrap_long(text, width=900):
    """Reader output can hold whole paragraphs on one line; split them so search can quote them."""
    out = []
    for line in text.splitlines():
        out.extend(textwrap.wrap(line, width, break_on_hyphens=False) or [''] if len(line) > 1000 else [line])
    return '\n'.join(out)

def place_marks(text, ext):
    """The page, slide or sheet in effect at each line (1-based), from the reader's own markers."""
    marks = [None]; current = None
    for line in text.splitlines():
        s = line.strip()
        m = PAGE.match(s) or SLIDE.match(s)
        if m:
            current = ('page' if s.startswith('#') else 'slide', m[1])
        elif ext in SHEET_TYPES and (m := SHEET.match(s)):
            current = ('sheet', m[1])
        marks.append(current)
    return marks

def breaks_of(marks):
    return {n for n in range(1, len(marks)) if marks[n] and marks[n] != marks[n-1]}

def place(marks, start, end):
    first, last = marks[min(start, len(marks)-1)], marks[min(end, len(marks)-1)]
    first = first or last
    if not first:
        return None
    if not last or first == last or first[0] != last[0]:
        return f'{first[0]} {first[1]}'
    return f'sheets {first[1]} to {last[1]}' if first[0] == 'sheet' else f'{first[0]}s {first[1]}–{last[1]}'

def passages(text, breaks=()):
    """Blocks of up to 12 lines / 900 characters. A line number in `breaks` (a page, slide or sheet heading)
    always starts a new block, so a document passage never spans two pages."""
    lines = text.splitlines()
    # Keep exact line text. Oversized single lines are excluded, never misquoted.
    block=[]; start=1; size=0
    for number,line in enumerate(lines,1):
        if len(line)>1200:
            if block:
                yield start,number-1,'\n'.join(block)
            block=[];size=0;start=number+1
            continue
        if block and (size+len(line)>900 or len(block)>=12 or number in breaks):
            yield start,number-1,'\n'.join(block)
            block=[];size=0;start=number
        if not block:
            start=number
        block.append(line);size+=len(line)+1
    if block:
        yield start,len(lines),'\n'.join(block)

class Conflict(ValueError):
    pass

class Brain:
    def __init__(self, data_dir, folder):
        self.folder = Path(folder).absolute()
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True,exist_ok=True)
        self.lock = threading.RLock()
        self.path = self.data_dir/'brain.sqlite3'
        self.report = {'files':0,'passages':0,'skipped':0,'warning':None,'checked_at':None,'documents':None}
        self.reader = None              # {'python','script','ocr'} once start_reader is called
        self.busy = lambda: False       # the server pauses reading while Lin is answering
        self.pending = []               # (relative, absolute, size, mtime_ns) waiting for the reader
        self.reading = None
        self.wake = threading.Event()
        self.closing = threading.Event()
        self.fingerprint = None
        self.full_at = 0.0
        self.extract_revision = 0
        with self.db() as db:
            db.executescript('''
                PRAGMA secure_delete=ON;
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                INSERT OR IGNORE INTO settings VALUES('connected','1');
                INSERT OR IGNORE INTO settings VALUES('revision','0');
                CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,title TEXT NOT NULL,
                    title_key TEXT NOT NULL, fact TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(scope,title_key));
                CREATE TABLE IF NOT EXISTS history(memory_id TEXT NOT NULL,revision INTEGER NOT NULL,
                    title TEXT NOT NULL,fact TEXT NOT NULL,scope TEXT NOT NULL,updated_at TEXT NOT NULL,
                    FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE);
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,kind TEXT NOT NULL,
                    title TEXT NOT NULL,body TEXT NOT NULL,metadata TEXT NOT NULL);
                CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,title,body,tokenize='porter unicode61');
                CREATE TABLE IF NOT EXISTS extracts(path TEXT PRIMARY KEY,size INTEGER NOT NULL,mtime_ns INTEGER NOT NULL,
                    ok INTEGER NOT NULL,text TEXT NOT NULL,method TEXT,note TEXT NOT NULL,pages INTEGER,read_at TEXT NOT NULL);
            ''')
        self.scan()

    @contextmanager
    def db(self):
        with self.lock:
            db=sqlite3.connect(self.path)
            db.row_factory=sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('PRAGMA secure_delete=ON')
            try:
                with db:
                    yield db
            finally:
                db.close()

    def changed(self, db):
        db.execute("UPDATE settings SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")

    def status(self):
        with self.db() as db:
            settings=dict(db.execute('SELECT key,value FROM settings').fetchall())
            count=db.execute('SELECT count(*) FROM memories').fetchone()[0]
        return {**self.report,'folder':str(self.folder),'connected':settings['connected']=='1',
                'revision':int(settings['revision']),'memories':count}

    def walk(self):
        """Stat-only pass: every note and document Lin may read, or None when the folder is unusable."""
        entries=[]; warning=None; visited=0; old=[]
        if not self.folder.is_dir() or not no_link(self.folder) or self.folder.resolve()!=self.folder:
            raise ValueError('Lin Brain is unavailable or is a linked folder.')
        for directory,dirs,names in os.walk(self.folder,followlinks=False):
            visited+=len(dirs)+1
            if visited>MAX_VISITED:
                warning=LIMIT
                break
            directory=Path(directory)
            depth=len(directory.relative_to(self.folder).parts)
            dirs[:]=sorted(d for d in dirs if not d.startswith('.') and depth<5 and no_link(directory/d))
            for name in sorted(names):
                visited+=1
                if visited>MAX_VISITED or len(entries)>=MAX_FILES:
                    warning=LIMIT
                    break
                if name.startswith(('.','~$')):  # hidden files and Office lock files
                    continue
                path=directory/name; ext=path.suffix.lower()
                if ext in OLD_OFFICE:
                    old.append((str(path.relative_to(self.folder)),ext))
                    continue
                if ext not in TEXT_TYPES and ext not in DOC_TYPES:
                    continue
                try:
                    info=path.lstat()
                except OSError:
                    continue
                linked=stat.S_ISLNK(info.st_mode) or bool(getattr(info,'st_file_attributes',0) & 0x400)
                entries.append((ext,path,str(path.relative_to(self.folder)),info.st_size,info.st_mtime_ns,linked))
            if warning:
                break
        return entries,warning,old

    def scan(self, force=False):
        """Refresh the index. Unchanged folders are re-checked cheaply; a full re-read happens on any change,
        on every explicit search, and at least once a minute (so an edit that keeps size and time is caught)."""
        with self.db() as db:
            connected=db.execute("SELECT value FROM settings WHERE key='connected'").fetchone()[0]=='1'
            entries=[];warning=None;old=[];usable=True
            if connected:
                try:
                    entries,warning,old=self.walk()
                except (OSError,ValueError):
                    usable=False
            fingerprint=hashlib.sha256(json.dumps([connected,usable,warning,self.extract_revision,
                [e[2:] for e in entries],old]).encode()).hexdigest()
            if not force and fingerprint==self.fingerprint and time.monotonic()-self.full_at<60:
                self.report['checked_at']=now()
                return self.status()
            found={};files=skipped=0;total=0;pending=[];retry=False
            docs={'read':0,'waiting':0,'empty':0,'failed':0,'old':len(old),'problems':[]}
            def problem(path,note):
                if len(docs['problems'])<6:
                    docs['problems'].append({'path':path,'note':note})
            for relative,ext in old:
                kind,newer=OLD_OFFICE[ext]
                problem(relative,f'Older {kind} format. Open it in {kind} and use Save As {newer} so Lin can read it.')
            if not usable:
                warning='Lin Brain is unavailable. Old file passages have been removed from search.'
            extracts={r['path']:r for r in db.execute('SELECT path,size,mtime_ns,ok,method,note,pages FROM extracts')}
            for ext,path,relative,size,mtime,linked in entries:
                if linked:
                    skipped+=1
                    continue
                if total>=MAX_TEXT_TOTAL:
                    warning=LIMIT
                    break
                if ext in TEXT_TYPES:
                    try:
                        text,modified=read_note(path,self.folder)
                    except OSError:
                        skipped+=1;retry=True
                        continue
                    except (ValueError,UnicodeError):
                        skipped+=1
                        continue
                    meta={'path':str(path),'modified_ns':modified};marks=None;breaks=()
                    if any(len(line)>1200 for line in text.splitlines()):
                        skipped+=1
                        warning=warning or 'Some oversized lines were excluded from search.'
                else:
                    if size>MAX_DOC_BYTES:
                        docs['failed']+=1;problem(relative,'Larger than 64 MB, so Lin does not read it.')
                        continue
                    row=extracts.get(relative)
                    if not row or row['size']!=size or row['mtime_ns']!=mtime:
                        pending.append((relative,str(path),size,mtime));docs['waiting']+=1
                        continue
                    if not row['ok']:
                        if row['note'].startswith('No '):
                            docs['empty']+=1
                        else:
                            docs['failed']+=1;problem(relative,row['note'])
                        continue
                    text=db.execute('SELECT text FROM extracts WHERE path=?',(relative,)).fetchone()[0]
                    docs['read']+=1
                    meta={'path':str(path),'modified_ns':mtime,'document':METHODS.get(row['method'],'the document text'),'pages':row['pages']}
                    marks=place_marks(text,ext);breaks=breaks_of(marks)
                total+=len(text.encode('utf-8'));files+=1
                digest=hashlib.sha256(text.encode()).hexdigest()
                for start,end,body in passages(text,breaks):
                    if not body.strip():
                        continue
                    sid=hashlib.sha256(f'{relative}:{digest}:{start}:{end}'.encode()).hexdigest()[:32]
                    where=f'lines {start}–{end}' if marks is None else (place(marks,start,end) or f'lines {start}–{end} of the text Lin read from it')
                    found[sid]=(sid,'file',relative,body,json.dumps({**meta,'line_start':start,'line_end':end,'sha256':digest,'where':where}))
            if connected and usable and warning!=LIMIT:
                present={e[2] for e in entries}
                gone=[p for p in extracts if p not in present]
                db.executemany('DELETE FROM extracts WHERE path=?',[(p,) for p in gone])
            elif not connected or not usable:
                found={}
            old_rows={row['id']:tuple(row) for row in db.execute("SELECT id,kind,title,body,metadata FROM sources WHERE kind='file'")}
            if old_rows!=found:
                db.execute("DELETE FROM search WHERE id IN (SELECT id FROM sources WHERE kind='file')")
                db.execute("DELETE FROM sources WHERE kind='file'")
                db.executemany('INSERT INTO sources VALUES(?,?,?,?,?)',found.values())
                db.executemany('INSERT INTO search(id,title,body) VALUES(?,?,?)',[(r[0],r[2],r[3]) for r in found.values()])
                self.changed(db)
            self.pending=pending
            docs['reader']='reading' if self.reading else 'ready' if self.reader_ready() else 'not installed'
            docs['reading']=self.reading
            self.report={'files':files,'passages':len(found),'skipped':skipped,'warning':warning,'checked_at':now(),'documents':docs}
            self.fingerprint=None if retry else fingerprint
            self.full_at=time.monotonic()
        if pending and self.reader:
            self.wake.set()
        return self.status()

    # -- document reader ---------------------------------------------------
    def start_reader(self, python, script, ocr):
        """Read waiting documents in the background with docreader.py (see the module notes)."""
        self.reader={'python':str(python),'script':str(script),'ocr':str(ocr)}
        threading.Thread(target=self._reader_loop,daemon=True,name='lin-docreader').start()
        self.wake.set()

    def reader_ready(self):
        return bool(self.reader) and Path(self.reader['python']).is_file() and Path(self.reader['script']).is_file()

    def close(self):
        self.closing.set();self.wake.set()

    def _reader_loop(self):
        while not self.closing.is_set():
            self.wake.wait(30);self.wake.clear()
            while not self.closing.is_set() and self.reader_ready():
                if self.busy():
                    self.closing.wait(2)
                    continue
                with self.lock:
                    batch=list(self.pending[:READER_BATCH])
                if not batch:
                    break
                try:
                    self.read_batch(batch)
                except Exception:
                    # Never retry the same file forever: record the first one as unreadable.
                    self._store([(batch[0],{'ok':False,'note':'Lin could not read this file.'})])
                try:
                    self.scan(force=True)
                except Exception:
                    break

    def read_batch(self, batch):
        work=self.data_dir/'reader';work.mkdir(exist_ok=True)
        job,out=work/'job.json',work/'results.json'
        if out.exists():
            out.unlink()
        job.write_text(json.dumps({'root':str(self.folder),'files':[b[1] for b in batch],'out':str(out),'ocr':self.reader['ocr']}),encoding='utf-8')
        flags=0x08000000|0x00004000 if os.name=='nt' else 0  # no console window, below-normal priority
        stopped=None;self.reading=batch[0][0]
        try:
            with open(work/'reader.log','ab') as log:
                process=subprocess.Popen([self.reader['python'],'-I',self.reader['script'],str(job)],cwd=str(work),
                                         stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=flags)
                lifetime=None
                if os.name=='nt':
                    try:
                        from process_lifetime import ProcessLifetime
                        lifetime=ProcessLifetime(process)
                    except Exception:
                        pass
                try:
                    process.wait(timeout=120+90*len(batch))
                except subprocess.TimeoutExpired:
                    process.kill();process.wait()
                    stopped='Reading this file took too long, so Lin stopped.'
                finally:
                    if lifetime:
                        lifetime.close()
            try:
                results=json.loads(out.read_text(encoding='utf-8')) if out.exists() else []
            except ValueError:
                results=[]
            by_path={r.get('path'):r for r in results if isinstance(r,dict)}
            done=[];missing=False
            for item in batch:
                if item[1] in by_path:
                    done.append((item,by_path[item[1]]))
                elif not missing:
                    # The reader stopped on this file (timeout or crash); later files simply wait for the next batch.
                    missing=True
                    done.append((item,{'ok':False,'note':stopped or 'The reader stopped while opening this file.'}))
            self._store(done)
        finally:
            self.reading=None

    def _store(self, done):
        stamp=now()
        with self.db() as db:
            for (relative,full,size,mtime),r in done:
                text=wrap_long(str(r.get('text') or ''))[:MAX_DOC_TEXT]
                ok=bool(r.get('ok')) and bool(text.strip())
                note=str(r.get('note') or ('' if ok else 'No readable text was found.'))[:300]
                pages=r.get('pages') if type(r.get('pages')) is int else None
                # Stored against the size and time seen when queued; a later edit makes it stale and queues it again.
                db.execute('INSERT OR REPLACE INTO extracts VALUES(?,?,?,?,?,?,?,?,?)',
                           (relative,size,mtime,int(ok),text if ok else '',r.get('method'),note,pages,stamp))
        self.extract_revision+=1

    def connect(self, connected):
        if not isinstance(connected,bool):
            raise ValueError('Choose connected or disconnected.')
        with self.db() as db:
            db.execute("UPDATE settings SET value=? WHERE key='connected'",('1' if connected else '0',))
            self.changed(db)
        return self.scan()

    def list_memories(self):
        with self.db() as db:
            return [dict(r) for r in db.execute('SELECT * FROM memories ORDER BY updated_at DESC,id')]

    def graph(self):
        """One node per indexed file or current memory; edges mean membership only."""
        with self.db() as db:
            files = {}
            nodes = []
            for row in db.execute('SELECT id,kind,title,metadata FROM sources ORDER BY title,id'):
                meta = json.loads(row['metadata'])
                if row['kind'] == 'file':
                    node = files.setdefault(row['title'], {
                        'id':'file-'+hashlib.sha256(row['title'].encode()).hexdigest()[:32],
                        'title':row['title'], 'group':'notes', 'kind':'file', 'passages':[]})
                    node['passages'].append({'id':row['id'], 'start':meta['line_start'], 'end':meta['line_end'], 'where':meta.get('where')})
                else:
                    nodes.append({'id':row['id'], 'title':row['title'], 'group':meta['scope'],
                                  'kind':'memory', 'revision':meta['revision'], 'source_id':row['id']})
            for node in files.values():
                node['passages'].sort(key=lambda p:p['start'])
                nodes.append(node)
            nodes.sort(key=lambda n:(n['group'],n['title'].casefold(),n['id']))
            return {'status':self.status(), 'nodes':nodes,
                    'edges':[{'from':'group-'+n['group'], 'to':n['id'], 'relation':'contains'} for n in nodes]}

    def save(self, body):
        title=plain(body.get('title'),80,'Title'); fact=plain(body.get('fact'),500,'Fact')
        scope=body.get('scope'); mid=body.get('id'); expected=body.get('revision')
        if mid is not None and (not isinstance(mid,str) or not re.fullmatch(r'[a-f0-9]{32}',mid)):
            raise ValueError('Invalid memory identifier.')
        if scope not in {'personal','business'}:
            raise ValueError('Choose personal or business.')
        key=' '.join(title.casefold().split()); stamp=now()
        with self.db() as db:
            duplicate=db.execute('SELECT id FROM memories WHERE scope=? AND title_key=?',(scope,key)).fetchone()
            if duplicate and duplicate['id']!=mid:
                raise Conflict('A memory with this title already exists in this scope. Edit that memory to correct it.')
            if mid:
                row=db.execute('SELECT * FROM memories WHERE id=?',(mid,)).fetchone()
                if not row or type(expected) is not int or expected!=row['revision']:
                    raise Conflict('This memory changed or was forgotten. Refresh before editing.')
                db.execute('INSERT INTO history VALUES(?,?,?,?,?,?)',(mid,row['revision'],row['title'],row['fact'],row['scope'],row['updated_at']))
                revision=row['revision']+1
                db.execute('UPDATE memories SET title=?,title_key=?,fact=?,scope=?,revision=?,updated_at=? WHERE id=?',(title,key,fact,scope,revision,stamp,mid))
            else:
                if db.execute('SELECT count(*) FROM memories').fetchone()[0]>=200:
                    raise ValueError('This prototype supports up to 200 memories. Edit or forget an existing memory first.')
                import secrets
                mid=secrets.token_hex(16);revision=1
                db.execute('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?)',(mid,title,key,fact,scope,revision,stamp,stamp))
            metadata=json.dumps({'scope':scope,'revision':revision,'updated_at':stamp,'origin':'Saved explicitly by you'})
            db.execute('INSERT OR REPLACE INTO sources VALUES(?,?,?,?,?)',(mid,'memory',title,fact,metadata))
            db.execute('DELETE FROM search WHERE id=?',(mid,))
            db.execute('INSERT INTO search(id,title,body) VALUES(?,?,?)',(mid,title,fact))
            self.changed(db)
            return dict(db.execute('SELECT * FROM memories WHERE id=?',(mid,)).fetchone())

    def forget(self, mid, revision):
        if not isinstance(mid,str) or type(revision) is not int:
            raise ValueError('A memory and its revision are required.')
        with self.db() as db:
            row=db.execute('SELECT revision FROM memories WHERE id=?',(mid,)).fetchone()
            if not row or row['revision']!=revision:
                raise Conflict('This memory changed or was forgotten. Refresh the list.')
            db.execute('DELETE FROM memories WHERE id=?',(mid,))
            db.execute('DELETE FROM sources WHERE id=?',(mid,))
            db.execute('DELETE FROM search WHERE id=?',(mid,))
            self.changed(db)

    def history(self, mid):
        with self.db() as db:
            return [dict(r) for r in db.execute('SELECT revision,title,fact,scope,updated_at FROM history WHERE memory_id=? ORDER BY revision DESC',(mid,))]

    def source(self, sid):
        with self.db() as db:
            row=db.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone()
        if not row:
            return None
        row=dict(row); row.update(json.loads(row.pop('metadata')))
        return row

    def named_document(self, question):
        """The note or document a question names ("summarize the harbor report", "what does pitch.pptx say"), or None."""
        q = ' ' + ' '.join(re.findall(r'[^\W_]+', question.casefold())) + ' '
        cue = bool(ASKS_ABOUT.search(question))
        best = None
        with self.db() as db:
            titles = [r[0] for r in db.execute("SELECT DISTINCT title FROM sources WHERE kind='file'")]
        for title in titles:
            name = re.split(r'[\\/]', title)[-1]
            words = name_words(title)
            if not words or max(map(len, words)) < 4:
                continue
            hits = sum(f' {w} ' in q for w in words)
            full = name.casefold() in question.casefold()
            if full or (cue and (hits == len(words) or (len(words) >= 3 and hits >= len(words) - 1))):
                score = (full, hits, -len(words))
                if not best or score > best[0]:
                    best = (score, title)
        return best[1] if best else None

    def document_passages(self, title, question, budget=5000):
        """Passages of one file for a question about it: the best-matching ones first, then from the start,
        within budget characters, returned in document order. Also says whether the whole file fit."""
        with self.db() as db:
            rows = [dict(r) for r in db.execute("SELECT id,body,metadata FROM sources WHERE kind='file' AND title=?", (title,))]
            for r in rows:
                r['start'] = json.loads(r['metadata'])['line_start']
            rows.sort(key=lambda r: r['start'])
            words = [w for w in terms(question) if w not in set(name_words(title))]
            ranked = []
            if words:
                expression = ' OR '.join('"' + w + '"' for w in dict.fromkeys(words))
                ranked = [r[0] for r in db.execute('SELECT s.id FROM search JOIN sources s ON s.id=search.id WHERE search MATCH ? '
                                                   "AND s.kind='file' AND s.title=? ORDER BY bm25(search,0,3,1) LIMIT 12", (expression, title))]
        by_id = {r['id']: r for r in rows}
        chosen, used = [], 0
        for sid in [*ranked, *[r['id'] for r in rows]]:
            if sid in chosen:
                continue
            size = len(by_id[sid]['body'])
            if used + size > budget and chosen:
                continue
            chosen.append(sid); used += size
        chosen.sort(key=lambda sid: by_id[sid]['start'])
        return [self.source(sid) for sid in chosen], len(chosen) == len(rows), len(rows)

    def search(self, query, kind=None, refresh=True):
        if refresh:
            self.scan(force=True)
        words=terms(plain(query,1000,'Search'))
        if not words:
            return []
        expression=' OR '.join('"'+word+'"' for word in dict.fromkeys(words))
        with self.db() as db:
            sql='SELECT s.id FROM search JOIN sources s ON s.id=search.id WHERE search MATCH ?'
            args=[expression]
            if kind:
                sql+=' AND s.kind=?';args.append(kind)
            sql+=' ORDER BY bm25(search,0,3,1),s.id LIMIT 3'
            ids=[r['id'] for r in db.execute(sql,args)]
            return [self.source(sid) for sid in ids]

ASKS_ABOUT = re.compile(r"\b(summar\w*|read|say|says|said|according|explain\w*|key points|main points|tl;?dr|overview|"
                        r"what(?:'s| is) in|in (?:the|my)|from (?:the|my)|about (?:the|my)|document|file|report|pdf|docx?|"
                        r"slides?|deck|sheet|spreadsheet|contract|page|chapter|section|mention\w*)\b", re.I)

def name_words(title):
    stem = re.split(r'[\\/]', title)[-1].rsplit('.', 1)[0]
    return [w for w in re.findall(r'[^\W_]+', stem.casefold()) if len(w) > 1 and w not in STOP]

def lookup_answer(sources):
    if not sources:
        return 'I could not find a matching saved memory or note in Lin Brain. Try a specific name or phrase, or add a text note to the folder.'
    first=sources[0]
    text=' '.join(first['body'].split())
    text=' '.join(re.split(r'(?<=[.!?])\s+',text)[:3])
    if len(text)>370:
        text=text[:367].rsplit(' ',1)[0]+'…'
    label='Your saved memory says' if first['kind']=='memory' else 'The matching passage says'
    return f'{label}: {text}'
