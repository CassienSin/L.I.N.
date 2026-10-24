"""The greeting when Lin opens, and turning an answer into a note for Lin Brain. Both use real data only."""
import re
from datetime import datetime

NOTE_FOLDER = 'Saved answers'


def part_of_day(now):
    return 'Good morning' if 4 <= now.hour < 12 else 'Good afternoon' if 12 <= now.hour < 18 else 'Good evening'


def plural(n, word):
    return f'{n} {word}{"" if n == 1 else "s"}'


# The greeting: who Lin is with, what matters right now, and a natural question. Every fact comes from real
# data (calendar, tasks, Lin Brain); the wording varies so it never sounds like the same recording twice.
OPENERS = {
    'early': ["Early start, {name}.", "You're up early, {name}.", "Morning, {name}. The day's barely started."],
    'morning': ["Morning, {name}.", "Good morning, {name}.", "Hey {name}, good morning."],
    'afternoon': ["Afternoon, {name}.", "Hey {name}, good afternoon.", "Good afternoon, {name}."],
    'evening': ["Evening, {name}.", "Good evening, {name}.", "Hey {name}. Evening already."],
    'late': ["Late one tonight, {name}.", "Still going, {name}?", "Evening, {name}. It's getting late."],
    'night': ["Still up, {name}?", "Burning the midnight oil, {name}?", "Hey {name}. It's past midnight."],
}
WEEKEND = ["Happy {day}, {name}.", "Morning, {name}. Enjoy your {day}."]
BACK_SOON = ["Back again, {name}.", "Hey again, {name}.", "Welcome back, {name}."]
BACK_LATER = ["Good to have you back, {name}. It's been {days} days.", "Welcome back, {name}. It's been {days} days since we last talked."]
EVENT_NOW = ["You're in {title} right now, until {end}.", "{title} is happening now, until {end}."]
EVENT_SOON = ["{title} starts in {mins} minutes.", "Heads up: {title} is in {mins} minutes."]
EVENT_HOUR = ["{title} is at {start}, in about an hour.", "You have {title} at {start}, about an hour from now."]
EVENT_LATER = ["Later today you have {title} at {start}.", "Next on your calendar: {title} at {start}."]
EVENT_MORNING = ["In the morning you have {title} at {start}.", "First thing on your calendar: {title} at {start}."]
DAY_CLEAR = ["Your calendar's clear for the rest of the day.", "Nothing else on the calendar today."]
TASK_HIGH = ["{title} is still waiting, and it's high priority.", "The big one on your list is still {title}."]
TASK_ONE = ["One thing left on your list: {title}."]
TASK_MANY = ["You've got {n} things on your list.", "{n} tasks are still open."]
TASK_NONE = ["Your list is clear.", "Your task list is clear."]
NEW_DOCS = ["I read {n} new {docs} while you were away.", "{n} new {docs} came in, and I've read them."]
NEW_NOTES = ["{n} new {notes} landed in Lin Brain since last time."]
ASK_EVENT = ["Want a quick rundown before it starts?", "Want me to help you get ready for it?"]
ASK_NOW = ["Need anything while you're in it?"]
ASK_TASK = ["Want to start there?", "Shall we make time for it?"]
ASK_LATE = ["Want me to set tomorrow up so you can rest?", "Wrap up for the night, or keep going?"]
ASK_NIGHT = ["Want me to get the morning ready so you can rest?", "Want to call it a night?"]
ASK_ANY = ["What are we working on?", "What's on your mind?", "Where do you want to start?"]


def time_bucket(now):
    h = now.hour
    return ('night' if h < 4 else 'early' if h < 7 else 'morning' if h < 12 else 'afternoon' if h < 17
            else 'evening' if h < 21 else 'late')


def _fill(template, name, **values):
    if not name:
        template = template.replace(', {name}', '').replace(' {name}', '').replace('{name} ', '')
    text = template.format(name=name, **values)
    return text[:1].upper() + text[1:]


def _counts(brain_status):
    docs = (brain_status or {}).get('documents') or {}
    return {'files': int((brain_status or {}).get('files') or 0), 'documents': int(docs.get('read') or 0)}


def greeting(name, brain_status, planner, calendar, now, memory=None):
    """Two or three warm sentences: an opener that fits the moment, the one or two things that matter most
    right now, and a question. `memory` (from load_memory) adds "since last time" and keeps wording fresh."""
    import random
    import actions
    memory = memory or {}
    rng = random.Random(f"{now.date().isoformat()}-{now.hour}-{memory.get('count', 0)}")
    recent = set(memory.get('recent') or [])

    def pick(options, **values):
        fresh = [o for o in options if o not in recent] or options
        choice = rng.choice(fresh)
        used.append(choice)
        return _fill(choice, name, **values)

    used = []
    bucket = time_bucket(now)
    last = None
    if memory.get('last_seen'):
        try:
            last = datetime.fromisoformat(memory['last_seen']).astimezone(now.tzinfo)
        except (ValueError, TypeError):
            last = None
    gap_hours = (now - last).total_seconds() / 3600 if last else None
    days = (now.date() - last.date()).days if last else 0

    if last and days >= 2:
        opener = pick(BACK_LATER, days=days)
    elif last and gap_hours is not None and gap_hours < 3 and now.date() == last.date():
        opener = pick(BACK_SOON)
    elif bucket == 'morning' and now.weekday() >= 5:
        opener = pick(WEEKEND, day=now.strftime('%A'))
    else:
        opener = pick(OPENERS[bucket])
    lines = [opener]

    # What matters most right now, in order. Lin mentions at most two things, so it sounds like a person
    # catching you up rather than a report: a meeting now or soon, what's new since you were away, the
    # high-priority task, then what's later today.
    facts = []  # (rank, sentence, question or None)
    start, end = actions.day_bounds('today', now)
    snap = calendar.snapshot()
    state = actions.calendar_state(snap, start, end, now)
    timed = []
    if state.get('available'):
        timed = [e for e in actions.day_events(snap, start, end, now) if not e['all_day']]
        current = next((e for e in timed if e['status'] == 'now'), None)
        ahead = sorted((e for e in timed if e['status'] == 'upcoming'), key=lambda e: e['_start'])
        if current:
            facts.append((0, pick(EVENT_NOW, title=current['title'], end=current['end']), pick(ASK_NOW)))
        elif ahead:
            e = ahead[0]
            mins = int((e['_start'] - now).total_seconds() // 60)
            if mins < 60:
                soon = EVENT_SOON[:1] if ':' in e['title'] else EVENT_SOON  # "Heads up: Rehearsal: ..." reads badly
                facts.append((1, pick(soon, title=e['title'], mins=max(mins, 1)), pick(ASK_EVENT)))
            elif mins < 120:
                facts.append((1, pick(EVENT_HOUR, title=e['title'], start=e['start']), pick(ASK_EVENT)))
            else:
                facts.append((4, pick(EVENT_MORNING if bucket == 'night' else EVENT_LATER, title=e['title'], start=e['start']), None))
        elif timed and bucket in ('afternoon', 'evening', 'late'):
            facts.append((5, pick(DAY_CLEAR), None))

    seen = memory.get('counts')
    if seen and gap_hours is not None and gap_hours >= 3:
        now_counts = _counts(brain_status)
        new_docs = now_counts['documents'] - int(seen.get('documents', 0))
        new_files = now_counts['files'] - int(seen.get('files', 0)) - max(new_docs, 0)
        if new_docs > 0:
            facts.append((2, pick(NEW_DOCS, n=new_docs, docs='document' if new_docs == 1 else 'documents'), None))
        elif new_files > 0:
            facts.append((2, pick(NEW_NOTES, n=new_files, notes='note' if new_files == 1 else 'notes'), None))

    tasks = sorted((t for t in planner.snapshot()['tasks'] if not t['done']), key=lambda t: t['priority'])
    high = [t for t in tasks if t['priority'] == 1]
    if high:
        facts.append((3, pick(TASK_HIGH, title=high[0]['title']), pick(ASK_TASK)))
    elif len(tasks) == 1:
        facts.append((6, pick(TASK_ONE, title=tasks[0]['title']), None))
    elif tasks:
        facts.append((6, pick(TASK_MANY, n=len(tasks)), None))
    else:
        facts.append((6, pick(TASK_NONE), None))

    chosen = sorted(facts, key=lambda f: f[0])[:2]
    if len(chosen) == 2 and chosen[0][0] <= 1 and chosen[1][0] == 3:
        chosen = chosen[:1]  # a meeting soon is enough; the task can wait until after it
    owner = next((f for f in chosen if f[2]), None)
    if owner:  # the sentence the question is about goes right before the question
        chosen = [f for f in chosen if f is not owner] + [owner]
    lines += [f[1] for f in chosen]
    ask = owner[2] if owner else None
    if bucket in ('late', 'night') and not (chosen and min(f[0] for f in chosen) <= 1):
        ask = pick(ASK_NIGHT if bucket == 'night' else ASK_LATE)
    if not ask:
        ask = pick(ASK_ANY)
    lines.append(ask)
    greeting.last_used = used
    return ' '.join(lines)


def load_memory(path):
    import json
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def remember(memory, brain_status, now, used=None):
    """What the next greeting needs: when you were last here, what Lin Brain held, and the wording just used."""
    return {'last_seen': now.isoformat(timespec='seconds'), 'counts': _counts(brain_status),
            'count': int(memory.get('count', 0)) + 1, 'recent': list(used or getattr(greeting, 'last_used', []))[:12]}


def save_memory(path, memory):
    import json
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(memory, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)


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
