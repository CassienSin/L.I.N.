"""Lin Brain reads documents: Word, PDF (text and scanned), PowerPoint, Excel, OpenDocument, RTF, web pages and
photos, in the background, with exact passages, page/slide/sheet places and honest reasons for files it cannot read.
Uses the invented samples in design/doc-samples. Usage: python verify_docs.py"""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
from brain import Brain

BASE = Path(__file__).resolve().parent
SAMPLES = BASE.parent / 'design' / 'doc-samples'
python = os.environ.get('LIN_DOC_PYTHON') or (str(BASE.parent / 'tools' / 'docs-venv' / 'Scripts' / 'python.exe') if os.name == 'nt' else sys.executable)
windows = os.name == 'nt'
checks = []
(BASE / 'runtime').mkdir(exist_ok=True)


def wait(brain, seconds=300):
    end = time.time() + seconds
    while time.time() < end:
        s = brain.scan(force=True)
        d = s['documents']
        if not d['waiting'] and not brain.reading:
            return s
        time.sleep(1)
    raise AssertionError(f'documents still waiting: {brain.status()["documents"]}')


def hit(brain, query, path):
    hits = [h for h in brain.search(query, kind='file') if h['title'] == path]
    assert hits, f'no passage from {path} for "{query}": {[h["title"] for h in brain.search(query, kind="file")]}'
    return hits[0]


with tempfile.TemporaryDirectory(prefix='docs-test-', dir=BASE / 'runtime') as directory:
    root = Path(directory); folder = root / 'Lin Brain'; data = root / 'data'
    shutil.copytree(SAMPLES, folder)
    (folder / 'plain.md').write_text('# Plain note\nPlain marker: notes still work.\n', encoding='utf-8')
    (folder / 'ansi.csv').write_bytes('Name,City\nJos\xe9,Cebu\n'.encode('cp1252'))
    (folder / '~$aurora-contract.docx').write_bytes(b'lock')
    started = time.time()
    brain = Brain(data, folder)
    first = brain.status()['documents']
    assert first['waiting'] >= 10 and first['reader'] == 'not installed', first
    assert hit(brain, 'Plain marker', 'plain.md')
    assert 'José' in hit(brain, 'Cebu', 'ansi.csv')['body']
    checks.append('Plain notes stay searchable while documents wait; ANSI (Windows) text files are read')
    brain.start_reader(python, BASE / 'docreader.py', BASE / 'ocr.ps1')
    status = wait(brain)
    seconds = time.time() - started
    docs = status['documents']

    try:
        import mammoth  # noqa: F401  (always present in tools/docs-venv; may be missing in a bare test Python)
        word = True
    except ImportError:
        word = windows
    if not word:
        print('note: skipping the Word checks, mammoth is not installed in', python, file=sys.stderr)
    if word:
        h = hit(brain, 'late delivery penalty', 'aurora-contract.docx')
        assert '2 percent per week' in h['body'] and h['where'].startswith('lines '), h
        assert hit(brain, 'Wrapmarker zebra', 'aurora-contract.docx')
        assert '18,500' in hit(brain, 'Solar panel price', 'aurora-contract.docx')['body']
        checks.append('Word: paragraphs, a very long paragraph (wrapped so it can be quoted) and tables')

    h = hit(brain, 'crane uptime', 'harbor-report.pdf')
    assert '97 percent' in h['body'] and h['where'] == 'page 2', h
    assert h['document'] == 'the PDF text' and h['pages'] == 3
    checks.append('PDF: exact passage with its page number (page 2 of 3)')

    h = hit(brain, 'launch date', 'pitch.pptx')
    assert 'March 14' in h['body'] and h['where'].startswith('slide'), h
    h = hit(brain, 'Flights Cebu', 'budget.xlsx')
    assert '12000' in h['body'] and 'Travel' in h['where'], h
    checks.append('PowerPoint slides and Excel sheets are cited by slide and sheet name')

    assert 'kiwi orchard' in hit(brain, 'kiwi orchard', 'orchard.odt')['body']
    assert 'lantern festival' in hit(brain, 'lantern festival', 'memo.rtf')['body']
    reef = hit(brain, 'coral reef survey', 'reef.html')['body']
    assert 'var x' not in reef
    checks.append('OpenDocument, RTF and web pages (scripts dropped)')

    problems = {p['path']: p['note'] for p in docs['problems']}
    assert 'password' in problems.get('locked.pdf', ''), problems
    if not windows:
        assert 'no text' in problems.get('scanned-receipt.pdf', ''), problems
    assert 'damaged' in problems.get('broken.pdf', ''), problems
    assert 'Save As .docx' in problems.get('old-minutes.doc', ''), problems
    assert not any(p.startswith('~$') for p in problems)
    checks.append('Honest reasons for a password-protected PDF, a damaged PDF and an old .doc; Office lock files ignored')

    if windows:
        h = hit(brain, 'Receipt total', 'scanned-receipt.pdf')
        assert '4850' in h['body'].replace(',', '') and h['document'].startswith('the PDF, with Windows text recognition'), h
        h = hit(brain, 'Sprint goal voice orb', 'whiteboard.png')
        assert 'orb' in h['body'].lower(), h
        checks.append('Scanned PDF page and a photo of a whiteboard read with Windows text recognition (offline)')

    # Unchanged files are not read again; an edited file is.
    revision = brain.extract_revision
    brain.scan(force=True); time.sleep(2); brain.scan(force=True)
    assert brain.extract_revision == revision, 'unchanged documents were read again'
    memo = folder / 'memo.rtf'
    memo.write_text(r'{\rtf1\ansi\pard Rich text marker: the lantern festival moved to eight.\par}', encoding='ascii')
    wait(brain)
    assert 'eight' in hit(brain, 'lantern festival', 'memo.rtf')['body']
    (folder / 'reef.html').unlink(); brain.scan(force=True)
    assert not [h for h in brain.search('coral reef survey', kind='file') if h['title'] == 'reef.html']
    with brain.db() as db:
        assert not db.execute("SELECT 1 FROM extracts WHERE path='reef.html'").fetchone()
    checks.append('Unchanged documents are never re-read; an edited one is re-read and a deleted one leaves search and the cache')

    assert brain.named_document('Summarize the harbor report') == 'harbor-report.pdf'
    assert brain.named_document('What does pitch.pptx say about the launch?') == 'pitch.pptx'
    assert brain.named_document('In the budget, how much are flights?') == 'budget.xlsx'
    assert brain.named_document('Any ideas for dinner tonight?') is None
    assert brain.named_document('How is the harbor looking?') is None  # names a word, but does not ask about the file
    parts, whole, total = brain.document_passages('harbor-report.pdf', 'When is the next review?')
    assert whole and total == 3 and [p['where'] for p in parts] == ['page 1', 'page 2', 'page 3'], parts
    import honesty
    job = {'question': 'When is the next review in the harbor report?', 'sources': parts,
           'checked': {'tool': 'document', 'title': 'harbor-report.pdf', 'whole': True, 'read': 3, 'total': 3}}
    lines = honesty.for_job(job)
    assert lines == ['Only this file was read. Your other notes, tasks and calendar were not checked.'], lines
    checks.append('Questions that name a document ("summarize the harbor report") read that file, page by page, with an honest coverage line')
    graph = brain.graph()
    node = next(n for n in graph['nodes'] if n['title'] == 'harbor-report.pdf')
    assert any(p.get('where') == 'page 2' for p in node['passages'])
    brain.close()
    checks.append(f"{docs['read']} documents read in {seconds:.0f} s; the map lists them with page places")

result = {'passed': True, 'checks': checks, 'reader': python, 'windows_ocr': windows}
(BASE / 'brain-benchmark').mkdir(exist_ok=True)
(BASE / 'brain-benchmark' / 'docs-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
