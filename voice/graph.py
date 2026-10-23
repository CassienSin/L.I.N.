"""One map of everything Lin knows: notes, memories, tasks, events and linked topics.

Every connection carries its reason, so the map never implies a relationship it cannot show:
- link: a note writes [[Something]] (an explicit wikilink)
- mention: one item names another item's title, or both name the same uncommon term
- schedule: a calendar event is connected to an item it names (or that names it)
Nothing here is inferred by a model and nothing is written anywhere.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re

WIKILINK = re.compile(r'\[\[([^\]\|#\n]{1,80})(?:[|#][^\]\n]*)?\]\]')
WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)?", re.UNICODE)
STOP = set('''a an the and or but if then than so to of in on at by for from with without into onto over under about after before
between during this that these those it its is are was were be been being have has had do does did can could would should will shall
may might must not no yes my your our their his her its me we you they them i he she us here there what which who whom when where why
how all any each few more most other some such only own same too very just also again once ever really still even much many lot lots
make made get got going go went come came take took need needs want wants like know think thing things today tomorrow yesterday week
weeks month months year years day days time times morning afternoon evening night monday tuesday wednesday thursday friday saturday sunday
note notes task tasks event events memory memories page draft final first second third next last new old good great small big minutes
hour hours please done open item items list lists file files folder line lines part parts point points work working via per etc
upper lower session practice results result check checked update updated using used about every after before'''.split())
PRIORITY = {1: 'high', 2: 'normal', 3: 'low'}
STRENGTH = {'link': 3, 'schedule': 2, 'mention': 1}
MAX_TEXT = 6000
INSTRUCTION = re.compile(r"\b(ignore|disregard|forget)\s+(all\s+|any\s+|your\s+|the\s+)?(previous|prior|above|earlier|system)?\s*(instructions|rules|prompt)\b|\byou are now\b|\bsystem prompt\b|\bnew instructions\b", re.I)


def key(text):
    return ' '.join(w.casefold() for w in WORD.findall(text or ''))


def node_id(kind, raw):
    return kind + '-' + hashlib.sha256(f'{kind}:{raw}'.encode()).hexdigest()[:24]


def note_title(path, text):
    if not re.search(r'\.(md|markdown|txt)$', path, re.I):
        text = ''  # documents: page, slide and sheet headings are not titles; use the file name
    for line in text.splitlines()[:12]:
        heading = re.match(r'^\s*#{1,3}\s+(.{2,80}?)\s*#*\s*$', line)
        if heading:
            return heading[1].strip()
    stem = re.split(r'[\\/]', path)[-1].rsplit('.', 1)[0]
    stem = re.sub(r'[-_]+', ' ', stem).strip()
    return (stem[:1].upper() + stem[1:]) if stem else path


def preview(text, limit=360):
    """Readable text with line breaks kept, wikilink brackets and a leading heading removed."""
    text = re.sub(r'\[\[([^\]\|#]+)(?:[|#][^\]]*)?\]\]', r'\1', text or '')
    lines = [' '.join(line.split()) for line in text.splitlines()]
    if lines and lines[0].startswith('#'):
        lines = lines[1:]
    text = '\n'.join(l.lstrip('# ') for l in lines if l).strip()
    return text if len(text) <= limit else text[:limit - 1].rsplit(' ', 1)[0] + '…'


def line_of(text, start_line, phrase_key):
    """Line number (absolute) where a phrase first appears, for an exact citation."""
    for offset, line in enumerate(text.splitlines()):
        if phrase_key and f' {phrase_key} ' in f' {key(line)} ':
            return start_line + offset
    return None


def collect(brain, planner, calendar, now):
    nodes = {}
    with brain.db() as db:
        rows = db.execute('SELECT id,kind,title,body,metadata FROM sources ORDER BY title,id').fetchall()
    files = defaultdict(list)
    for row in rows:
        meta = json.loads(row['metadata'])
        if row['kind'] == 'file':
            files[row['title']].append((meta['line_start'], meta['line_end'], row['id'], row['body']))
        else:
            nid = 'memory-' + row['id']
            nodes[nid] = {'id': nid, 'kind': 'memory', 'title': row['title'], 'text': row['body'], 'source_id': row['id'],
                          'detail': f"{meta.get('scope', 'personal').capitalize()} memory · revision {meta.get('revision', 1)}",
                          'chunks': [(1, row['body'])]}
    for path, parts in files.items():
        parts.sort()
        text = '\n'.join(p[3] for p in parts)[:MAX_TEXT]
        nid = node_id('note', path)
        nodes[nid] = {'id': nid, 'kind': 'note', 'title': note_title(path, parts[0][3]), 'path': path, 'text': text,
                      'source_id': parts[0][2], 'detail': path,
                      'passages': [{'id': p[2], 'start': p[0], 'end': p[1]} for p in parts],
                      'chunks': [(p[0], p[3]) for p in parts]}
    for task in planner.snapshot()['tasks']:
        if task['done']:
            continue
        nid = 'task-' + task['id']
        nodes[nid] = {'id': nid, 'kind': 'task', 'title': task['title'], 'text': task['title'], 'task_id': task['id'],
                      'detail': f"{task['scope'].capitalize()} task · {task['minutes']} min · {PRIORITY[task['priority']]} priority",
                      'chunks': [(1, task['title'])]}
    cal = calendar.snapshot()['calendar']
    if cal:
        start, end = now - timedelta(hours=12), now + timedelta(days=7)
        for event in cal['events']:
            a, b = datetime.fromisoformat(event['start']), datetime.fromisoformat(event['end'])
            if b < start or a > end:
                continue
            nid = 'event-' + event['id']
            when = a.strftime('%a %d %b') + ('' if event['all_day'] else ', ' + a.strftime('%I:%M %p').lstrip('0'))
            text = event['title'] + (' at ' + event['location'] if event['location'] else '')
            nodes[nid] = {'id': nid, 'kind': 'event', 'title': event['title'], 'text': text, 'start': event['start'],
                          'end': event['end'], 'all_day': event['all_day'],
                          'detail': f"Event · {when}" + (' · tentative' if event['tentative'] else '') + ' · imported calendar',
                          'chunks': [(1, text)]}
    return nodes


def build(brain, planner, calendar, now=None):
    now = now or datetime.now(timezone.utc)
    nodes = collect(brain, planner, calendar, now)
    edges = {}

    def connect(a, b, kind, why):
        if a == b or a not in nodes or b not in nodes:
            return
        if 'event' in (nodes[a]['kind'], nodes[b]['kind']) and kind == 'mention':
            kind = 'schedule'
        pair = tuple(sorted((a, b)))
        current = edges.get(pair)
        if current is None:
            edges[pair] = {'source': pair[0], 'target': pair[1], 'kind': kind, 'why': [why]}
        else:
            if STRENGTH[kind] > STRENGTH[current['kind']]:
                current['kind'] = kind
            if why not in current['why'] and len(current['why']) < 4:
                current['why'].append(why)

    # Titles that can be named: notes (title and file stem), memories and later topics.
    names = {}
    for n in list(nodes.values()):
        if n['kind'] in {'note', 'memory'}:
            for alias in {n['title'], *([note_title(n['path'], '')] if n['kind'] == 'note' else [])}:
                k = key(alias)
                if len(k) >= 4 and k not in STOP:
                    names.setdefault(k, n['id'])

    # 1. Explicit [[wikilinks]] in notes. Unresolved targets become topic nodes.
    for n in [x for x in nodes.values() if x['kind'] == 'note']:
        for start, chunk in n['chunks']:
            for match in WIKILINK.finditer(chunk):
                target = match[1].strip()
                k = key(target)
                if not k:
                    continue
                line = start + chunk[:match.start()].count('\n')
                tid = names.get(k)
                if not tid:
                    tid = node_id('topic', k)
                    if tid not in nodes:
                        nodes[tid] = {'id': tid, 'kind': 'topic', 'title': target, 'text': target, 'detail': 'Linked topic · written as [[' + target + ']]',
                                      'chunks': [(1, target)]}
                    names.setdefault(k, tid)
                connect(n['id'], tid, 'link', f"{n['title']} links to [[{target}]] on line {line}")

    # 2. One item names another item's title (up to four words).
    index = defaultdict(list)
    for k, nid in names.items():
        words = k.split()
        if len(words) <= 4 and (len(words) > 1 or len(k) >= 5):
            index[words[0]].append((words, k, nid))
    tokens = {}
    for n in nodes.values():
        tokens[n['id']] = key(WIKILINK.sub(' ', n['text'])).split()
    for n in nodes.values():
        seq = tokens[n['id']]
        seen = set()
        for i, word in enumerate(seq):
            for words, k, target in index.get(word, ()):
                if target == n['id'] or target in seen or seq[i:i + len(words)] != words:
                    continue
                seen.add(target)
                where = ''
                if n['kind'] == 'note':
                    for start, chunk in n['chunks']:
                        line = line_of(chunk, start, k)
                        if line:
                            where = f' on line {line}'
                            break
                connect(n['id'], target, 'mention', f"{n['title']} names “{nodes[target]['title']}”{where}")

    # 3. Both name the same uncommon term (a word of five or more letters used by few items).
    frequency = defaultdict(set)
    for nid, seq in tokens.items():
        for word in set(seq):
            if len(word) >= 5 and word not in STOP and not word.isdigit():
                frequency[word].add(nid)
    limit = max(3, int(len(nodes) * 0.12))
    per_node = defaultdict(int)
    for word, members in sorted(frequency.items(), key=lambda kv: (len(kv[1]), kv[0])):
        if not 2 <= len(members) <= min(limit, 8):
            continue
        members = sorted(members)
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                if per_node[a] >= 8 or per_node[b] >= 8:
                    continue
                existing = edges.get(tuple(sorted((a, b))))
                if existing and word in ' '.join(existing['why']).casefold():
                    continue  # already explained by a link or a named title
                before = len(edges)
                connect(a, b, 'mention', f"Both mention “{word}”")
                if len(edges) > before:
                    per_node[a] += 1
                    per_node[b] += 1

    degree = defaultdict(int)
    for e in edges.values():
        degree[e['source']] += 1
        degree[e['target']] += 1
    public = []
    for n in nodes.values():
        item = {k: v for k, v in n.items() if k not in {'text', 'chunks'}}
        item['preview'] = preview(n['text'])
        item['flag'] = bool(n['kind'] in {'note', 'memory'} and INSTRUCTION.search(n['text']))
        item['degree'] = degree[n['id']]
        public.append(item)
    public.sort(key=lambda n: (-n['degree'], n['title'].casefold(), n['id']))
    edge_list = sorted(edges.values(), key=lambda e: (e['source'], e['target']))
    counts = defaultdict(int)
    for n in public:
        counts[n['kind']] += 1
    edge_counts = defaultdict(int)
    for e in edge_list:
        edge_counts[e['kind']] += 1
    assign, clusters = clusters_of(public, edge_list)
    for n in public:
        n['cluster'] = assign.get(n['id'], 'c-other')
    return {'nodes': public, 'edges': edge_list, 'counts': dict(counts), 'edge_counts': dict(edge_counts), 'clusters': clusters,
            'hubs': [{'id': n['id'], 'title': n['title'], 'kind': n['kind'], 'degree': n['degree']} for n in public[:8] if n['degree']],
            'generated_at': now.isoformat(timespec='seconds')}


def clusters_of(nodes, edges, max_clusters=24):
    """Named neighbourhoods. A note keeps its top folder; everything else joins the neighbourhood it is most
    connected to (deterministic label propagation, links weigh most). Groups too small to name become Other.
    Like every connection, a neighbourhood can be explained: its folder, or the item it gathers around."""
    weight = {'link': 3, 'schedule': 2, 'mention': 1}
    neigh = defaultdict(list)
    for e in edges:
        w = weight.get(e['kind'], 1)
        neigh[e['source']].append((e['target'], w))
        neigh[e['target']].append((e['source'], w))
    label, anchored, names = {}, set(), {'memories': 'Memories', 'tasks': 'Tasks', 'calendar': 'Calendar'}
    for n in nodes:
        parts = str(n.get('path') or '').replace('\\', '/').split('/')
        if n['kind'] == 'note' and len(parts) > 1 and parts[0]:
            lab = 'folder:' + parts[0].casefold()
            label[n['id']] = lab
            anchored.add(n['id'])
            names.setdefault(lab, parts[0])
        else:
            label[n['id']] = {'memory': 'memories', 'task': 'tasks', 'event': 'calendar'}.get(n['kind'], 'item:' + n['id'])
    order = sorted(label)
    for _ in range(12):
        changed = False
        for nid in order:
            if nid in anchored or not neigh[nid]:
                continue
            score = defaultdict(float)
            for other, w in neigh[nid]:
                score[label[other]] += w
            best, value = max(score.items(), key=lambda kv: (kv[1], kv[0] == label[nid], kv[0]))
            if best != label[nid] and value > score.get(label[nid], 0):
                label[nid] = best
                changed = True
        if not changed:
            break
    by_id = {n['id']: n for n in nodes}
    groups = defaultdict(list)
    for nid, lab in label.items():
        groups[lab].append(nid)
    minimum = 2 if len(nodes) < 30 else 3
    ranked = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    keep = [(lab, members) for lab, members in ranked if len(members) >= minimum][:max_clusters]
    kept = {lab for lab, _ in keep}
    assign, clusters = {}, []
    for lab, members in keep:
        hub = max(members, key=lambda m: (by_id[m]['degree'], by_id[m]['title']))
        cid = 'c-' + hashlib.sha256(lab.encode()).hexdigest()[:10]
        if lab.startswith('folder:'):
            name, why = names[lab], f'Notes in your {names[lab]} folder, and the items they connect to most'
        elif lab in names:
            name, why = names[lab], f'{names[lab]} that are not mostly connected to one neighbourhood'
        else:
            name, why = by_id[hub]['title'], f"Items most connected to {by_id[hub]['title']}"
        kinds = defaultdict(int)
        for m in members:
            kinds[by_id[m]['kind']] += 1
            assign[m] = cid
        clusters.append({'id': cid, 'name': name[:40], 'size': len(members), 'hub': hub, 'why': why, 'kinds': dict(kinds)})
    rest = [nid for lab, members in groups.items() if lab not in kept for nid in members]
    if rest:
        kinds = defaultdict(int)
        for m in rest:
            kinds[by_id[m]['kind']] += 1
            assign[m] = 'c-other'
        clusters.append({'id': 'c-other', 'name': 'Other', 'size': len(rest), 'hub': None,
                         'why': 'Small groups and items with few connections', 'kinds': dict(kinds)})
    return assign, clusters


class GraphCache:
    """Rebuild only when notes, memories, tasks or the calendar changed (or the hour turned)."""

    def __init__(self):
        self.key = None
        self.value = None

    def get(self, brain, planner, calendar):
        now = datetime.now(timezone.utc)
        cache_key = (brain.status()['revision'], planner.revision(), calendar.snapshot()['revision'], now.strftime('%Y%m%d%H'))
        if cache_key != self.key:
            self.value = build(brain, planner, calendar, now)
            self.value['revision'] = hashlib.sha256(json.dumps(cache_key).encode()).hexdigest()[:16]
            self.key = cache_key
        return self.value
