"""Lin Brain document reader. Runs in its own Python (tools/docs-venv) and its own process, so a damaged or
hostile file can only fail this process, never Lin. No network: sockets are disabled before anything loads.

Usage: python -I docreader.py <job.json>
job.json: {"root": "<Lin Brain folder>", "files": ["<absolute path>", ...], "out": "<results.json>", "ocr": "<ocr.ps1>"}
Writes a list of {path, ok, text, method, pages, note} to "out"."""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def _no_network(*args, **kwargs):
    raise OSError('Network access is disabled in the Lin document reader')


socket.socket.connect = _no_network
socket.socket.connect_ex = _no_network
socket.create_connection = _no_network

MAX_CHARS = 400_000
MAX_PDF_PAGES = 300
MAX_OCR_PAGES = 30
MARKITDOWN = {'.docx', '.pptx', '.xlsx', '.xls', '.msg', '.epub', '.html', '.htm', '.csv', '.json', '.xml', '.ipynb'}
IMAGES = {'.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff', '.webp'}
OPEN_DOC = {'.odt', '.ods', '.odp'}


class Unreadable(ValueError):
    """A reason the person can act on, shown as is."""


def clean(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n').replace('\x00', '')
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n{4,}', '\n\n\n', text)
    return text.strip()[:MAX_CHARS]


def ocr(images, script):
    """Windows' built-in text recognition (Windows.Media.Ocr) for a list of image files."""
    if not images:
        return {}
    with tempfile.TemporaryDirectory(prefix='lin-ocr-') as tmp:
        listing, out = Path(tmp) / 'list.txt', Path(tmp) / 'out.json'
        listing.write_text('\n'.join(str(p) for p in images), encoding='utf-8')
        try:
            subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, str(listing), str(out)],
                           capture_output=True, timeout=60 + 20 * len(images), creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except (OSError, subprocess.TimeoutExpired):
            return {}  # no text recognition: scanned pages simply stay empty
        if not out.exists():
            return {}
        data = json.loads(out.read_text(encoding='utf-8-sig') or '[]')
        if isinstance(data, dict):
            data = [data]
        key = lambda d: d['path'].get('value') if isinstance(d.get('path'), dict) else str(d.get('path'))
        return {key(d): d.get('text') or '' for d in data if isinstance(d, dict) and d.get('text') is not None}


def read_pdf(path, script):
    import pypdfium2 as pdfium
    try:
        pdf = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as exc:
        if 'password' in str(exc).lower():
            raise Unreadable('This PDF is password-protected. Save an unlocked copy so Lin can read it.')
        raise Unreadable('This PDF is damaged or not really a PDF.')
    total = len(pdf)
    pages, scanned = [], []
    with tempfile.TemporaryDirectory(prefix='lin-pdf-') as tmp:
        for i in range(min(total, MAX_PDF_PAGES)):
            page = pdf[i]
            text = page.get_textpage().get_text_bounded() or ''
            if len(text.strip()) < 25 and len(scanned) < MAX_OCR_PAGES:
                image = page.render(scale=2).to_pil()
                file = Path(tmp) / f'page-{i + 1}.png'
                image.save(file)
                scanned.append((i, file))
            pages.append(text)
        recognised = 0
        if scanned:
            found = ocr([f for _, f in scanned], script)
            for i, f in scanned:
                if found.get(str(f), '').strip():
                    pages[i] = found[str(f)]
                    recognised += 1
    body = '\n\n'.join(f'## Page {i + 1}\n{t.strip()}' for i, t in enumerate(pages) if t.strip())
    note = (f'Only the first {MAX_PDF_PAGES} of {total} pages were read. ' if total > MAX_PDF_PAGES else '') + \
           (f'{recognised} scanned page{"s" if recognised != 1 else ""} read with Windows text recognition.' if recognised else
            f'{len(scanned)} scanned page{"s" if len(scanned) != 1 else ""} had no text that Windows text recognition could find.' if scanned else '')
    return body, ('pdf+ocr' if recognised else 'pdf'), total, note.strip()


def read_opendocument(path):
    with zipfile.ZipFile(path) as z:
        info = z.getinfo('content.xml')
        if info.file_size > 30 * 1024 * 1024:
            raise Unreadable('The document is too large to read.')
        xml = z.read(info).decode('utf-8', 'replace')
    xml = re.sub(r'<text:(h|p)[^>]*>', '\n', xml)
    xml = re.sub(r'<text:tab/>', '\t', xml)
    xml = re.sub(r'<table:table-cell[^>]*>', ' | ', xml)
    text = re.sub(r'<[^>]+>', '', xml)
    import html
    return html.unescape(text)


def read_rtf(path):
    raw = Path(path).read_text(encoding='latin-1', errors='replace')
    raw = re.sub(r'\\par[d]?', '\n', raw)
    raw = re.sub(r"\\'[0-9a-f]{2}", '', raw)
    raw = re.sub(r'\\[a-z]+-?\d* ?', '', raw)
    return re.sub(r'[{}]', '', raw)


def read(path, root, script):
    p = Path(path)
    real = Path(os.path.realpath(p))
    if not str(real).lower().startswith(str(Path(os.path.realpath(root))).lower() + os.sep):
        raise Unreadable('The file is outside Lin Brain.')
    ext = p.suffix.lower()
    if ext == '.pdf':
        return read_pdf(p, script)
    if ext in IMAGES:
        text = ocr([p], script).get(str(p), '')
        return text, 'ocr', 1, 'Read with Windows text recognition.' if text.strip() else 'No text was found in this image.'
    if ext in OPEN_DOC:
        return read_opendocument(p), 'opendocument', None, ''
    if ext == '.rtf':
        return read_rtf(p), 'rtf', None, ''
    if ext in MARKITDOWN:
        if ext in {'.docx', '.pptx', '.xlsx', '.epub'}:
            with zipfile.ZipFile(p) as z:  # refuse zip bombs before handing the file over
                if sum(i.file_size for i in z.infolist()) > 300 * 1024 * 1024:
                    raise Unreadable('The document expands to more than 300 MB, so Lin does not open it.')
        from markitdown import MarkItDown
        try:
            result = MarkItDown(enable_plugins=False).convert(str(p))
        except Exception as exc:
            if 'MissingDependency' in str(exc):
                raise Unreadable('The reader for this type of file is not installed. Run design/Install-DocReaders.cmd.')
            raise
        return result.text_content or '', 'markitdown', None, ''
    raise Unreadable('Lin cannot read this type of file yet.')


def main():
    job = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = []
    for path in job['files']:
        try:
            text, method, pages, note = read(path, job['root'], job['ocr'])
            text = clean(text)
            out.append({'path': path, 'ok': bool(text), 'text': text, 'method': method, 'pages': pages,
                        'note': note or ('' if text else 'No readable text was found.')})
        except Unreadable as exc:
            out.append({'path': path, 'ok': False, 'text': '', 'method': None, 'pages': None, 'note': str(exc)})
        except Exception as exc:  # one bad file never stops the batch
            out.append({'path': path, 'ok': False, 'text': '', 'method': None, 'pages': None, 'note': f'Could not read this file ({type(exc).__name__}).'})
        Path(job['out']).write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
