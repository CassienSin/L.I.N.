"""The greeting when Lin opens, and turning an answer into a note for Lin Brain. Both use real data only."""
import re
from datetime import datetime

NOTE_FOLDER = 'Saved answers'


def part_of_day(now):
    return 'Good morning' if 4 <= now.hour < 12 else 'Good afternoon' if 12 <= now.hour < 18 else 'Good evening'


def plural(n, word):
    return f'{n} {word}{"" if n == 1 else "s"}'


def greeting(name, brain_status, planner, calendar, now):
    """Two or three short sentences with the real counts: notes, memories, open tasks and what's next today."""
    import actions
    lines = [f'{part_of_day(now)}, {name}.' if name else f'{part_of_day(now)}.']
    files, memories = brain_status.get('files', 0), brain_status.get('memories', 0)
    if files or memories:
        lines.append(f'Lin Brain has {plural(files, "note")} and {plural(memories, "memory").replace("memorys", "memories")}.')
    tasks = [t for t in planner.snapshot()['tasks'] if not t['done']]
    high = sum(t['priority'] == 1 for t in tasks)
    if tasks:
        lines.append(f'You have {plural(len(tasks), "open task")}' + (f', {high} high priority.' if high else '.'))
    else:
        lines.append('Your task list is clear.')
    agenda = actions.tool_agenda(calendar, {'day': 'today'}, now)
    if agenda.get('available'):
        ahead = [e for e in agenda['events'] if not e['all_day'] and e['status'] in {'now', 'upcoming'}]
        if ahead:
            e = ahead[0]
            lines.append(f"{e['title']} is on now until {e['end']}." if e['status'] == 'now' else f"Next today: {e['title']} at {e['start']}.")
        else:
            lines.append('Nothing else is on your calendar today.')
    return ' '.join(lines)


def title_from(question):
    words = re.sub(r'[^\w\s\'-]', ' ', question or '').split()
    title = ' '.join(words[:8]).strip()
    return (title[:1].upper() + title[1:])[:80] if title else 'Saved answer'


def note_from_job(job, now):
    """The default note for Save to brain: what you asked, what Lin said, and what was and wasn't checked."""
    if not job.get('answer') or job.get('kind') != 'answer':
        raise ValueError('Wait until Lin finishes answering, then save it.')
    lines = [f"*Saved from a conversation with Lin on {now.strftime('%A %d %B %Y, %I:%M %p').replace(' 0', ' ')} Manila time.*", '',
             '## You asked', job['question'].strip(), '', '## Lin said', job['answer'].strip(), '']
    c = job.get('checked')
    if c:
        lines += ['## What Lin checked', f"{c.get('label', 'Checked data')}" + (f" · {c['checked_label']}" if c.get('checked_label') else ''), '']
    links = []
    for s in (job.get('sources') or []):
        stem = str(s.get('title', '')).replace('\\', '/').rsplit('/', 1)[-1].rsplit('.', 1)[0]
        if stem and stem not in links:
            links.append(stem)
    for item in (c or {}).get('items') or []:
        stem = str(item.get('title', '')).replace('\\', '/').rsplit('/', 1)[-1].rsplit('.', 1)[0]
        if stem and stem not in links:
            links.append(stem)
    if links:
        lines += ['## Sources', *[f'- [[{x}]]' for x in links[:8]], '']
    gaps = job.get('unchecked') or []
    if gaps:
        lines += ["## What Lin couldn't check", *[f'- {g}' for g in gaps], '']
    return {'title': title_from(job['question']), 'body': '\n'.join(lines).strip() + '\n'}
