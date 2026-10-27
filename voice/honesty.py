"""What Lin could not check, for every answer. Deterministic: built from what was actually looked at,
never from the model's own claims, so it cannot overstate coverage."""
import re

STOP = set(('about after again also and any are ask asked can could did does doing done for from get give going have how '
            'into just know like lin make many more much need next not now please really should show some tell than that '
            'the their them then there these they thing things this today tomorrow told want was what when where which '
            'who why will with would you your yours note notes task tasks calendar memory memories brain search exact '
            'free time plan focus open left week day days').split())


def content_words(text):
    seen = []
    for w in re.findall(r"[a-z0-9][a-z0-9'-]{3,}", (text or '').lower()):
        w = w.strip("'-")
        if len(w) >= 4 and w not in STOP and w not in seen:
            seen.append(w)
    return seen[:12]


def missing(question, texts):
    """Words from the question that appear nowhere in what was checked (simple stem match)."""
    blob = ' '.join(texts).lower()
    out = []
    for w in content_words(question):
        stem = w[:max(4, len(w) - 2)]
        if stem not in blob:
            out.append(w)
    return out[:3]


def quote(words):
    q = [f'“{w}”' for w in words]
    return q[0] if len(q) == 1 else ', '.join(q[:-1]) + ' or ' + q[-1]


def for_job(job):
    """A short list of plain sentences. Empty means everything asked about was covered by what was checked."""
    out, question, c = [], job.get('question', ''), job.get('checked')
    if job.get('mode') == 'brain':
        sources = job.get('sources') or []
        if not sources:
            out.append('Nothing in Lin Brain matched, so there was nothing to read from.')
        else:
            gaps = missing(question, [s.get('title', '') + ' ' + s.get('body', '') for s in sources])
            if gaps:
                out.append(f'None of the matching passages mention {quote(gaps)}.')
            out.append(f'Only the {len(sources)} closest passage{"s" if len(sources) != 1 else ""} were read, not every note.')
            meant = sum(1 for s in sources if s.get('match') == 'meaning')
            if meant:
                out.append(f'{meant} of them {"was" if meant == 1 else "were"} found by meaning, not by the exact words, so check that {"it fits" if meant == 1 else "they fit"}.')
    elif c and c.get('tool') == 'document':
        if not c.get('whole'):
            out.append(f"Lin read {c.get('read')} of the {c.get('total')} passages in {c.get('title')}: the closest matches and the start, not all of it.")
        gaps = missing(question, [s.get('body', '') for s in job.get('sources') or []] + [c.get('title', '')])
        if gaps:
            out.append(f'The passages Lin read do not mention {quote(gaps)}.')
        out.append('Only this file was read. Your other notes, tasks and calendar were not checked.')
        if (job.get('verification') or '').startswith('replaced'):
            out.append('Lin could not write an answer, so you heard the closest passage instead.')
    elif c and c.get('tool') == 'conversations':
        period, topic = c.get('period'), c.get('topic')
        out.append('Only our saved conversations' + (f' from {period}' if period else '') + ' were searched'
                   + (f', for “{topic}”' if topic else '') + '. Your notes, tasks and calendar were not checked.')
        if c.get('items'):
            gaps = missing(question, [i.get('question', '') + ' ' + i.get('answer', '') for i in c['items']])
            gaps = [g for g in gaps if g not in ('talk', 'talked', 'discussed', 'conversation', 'said', 'yesterday')]
            if gaps:
                out.append(f'None of those turns mention {quote(gaps)}.')
        if c.get('by_meaning'):
            out.append(f"{c['by_meaning']} of these turns {'was' if c['by_meaning'] == 1 else 'were'} found by meaning, not by the exact words.")
        if c.get('private'):
            out.append('Conversations you kept private were never saved, so they could not be searched.')
        if (job.get('verification') or '').startswith('replaced'):
            out.append('Lin could not write an answer, so you heard the closest saved turn instead.')
    elif c and c.get('tool') == 'claude':
        if c.get('fallback') and not c.get('partial'):
            out.append(c['fallback'] + " So Lin answered on this PC from her general knowledge. Your notes, tasks and calendar were not checked.")
        else:
            if c.get('partial'):
                out.append(f"Claude stopped partway ({c.get('fallback') or 'it did not finish'}). You heard what it had said so far.")
            out.append('Claude saw only the text on this card. It did not see your notes, memories, tasks, calendar or files, '
                       'and it did not browse the web.')
            out.append("Claude can be wrong or out of date, and Lin did not check this answer.")
    elif c and c.get('tool') == 'mcp':
        out.append(f"Only {c.get('name')}'s output was used. Lin can't confirm that it is correct.")
    elif c:
        tool = c.get('tool')
        if c.get('available') is False:
            out.append(c.get('note') or 'That source is not available yet.')
        else:
            if c.get('stale'):
                out.append('Your calendar import is over a day old, so newer changes are not included.')
            if tool in ('agenda', 'free_time'):
                out.append('Only your imported calendar was checked. Events added elsewhere since the import are not included.')
            if tool == 'tasks' and c.get('more'):
                out.append(f"The card shows {len(c.get('tasks') or [])} of {c.get('open')} open tasks; the rest are in Plan my day.")
            if tool == 'plan':
                out.append('The plan uses your task estimates, not your calendar.')
            if tool == 'notes':
                items = c.get('items') or []
                if not items:
                    out.append(f"Nothing in your notes or memories matched “{c.get('query', '')}”.")
                else:
                    gaps = missing(question, [i.get('title', '') + ' ' + i.get('text', '') for i in items])
                    if gaps:
                        out.append(f'None of the matching notes mention {quote(gaps)}.')
        verification = job.get('verification') or ''
        if verification.startswith('replaced'):
            out.append("Lin's own wording did not match the data, so you heard the exact summary instead.")
    elif job.get('action') and job['action'].get('tool') == 'send_to_claude':
        out.append('Nothing has been sent to Claude. It waits for you, and only the text on the card would be sent.')
    elif job.get('action'):
        out.append('Nothing has changed yet. It waits for your approval.')
    elif (job.get('decision') or {}).get('tool') in ('privacy', 'forget_conversations', 'claude_unavailable'):
        pass
    elif job.get('proposal'):
        out.append('Nothing is saved until you press Save memory.')
    else:
        facts = job.get('memory_context') or []
        if facts:
            out.append(f'Used {len(facts)} saved fact{"s" if len(facts) != 1 else ""} from your memories. '
                       'Your notes, tasks and calendar were not checked.')
        else:
            out.append("This is from Lin's general knowledge. Your notes, tasks and calendar were not checked.")
    return out[:4]
