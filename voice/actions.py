"""Lin's action layer: local read tools, approval-gated writes, and receipts.

The language model may *suggest* which tool fits a request. Everything that
matters is deterministic here: argument validation, what a tool may read, the
exact preview a person approves, execution, verification, and undo.

Rules enforced in this module:
- Read tools only read Lin's own local stores (tasks, imported calendar, notes).
- Write tools never run when proposed. They create a preview with a payload
  hash; only an approval carrying that exact hash executes it, once.
- Changing any field creates a new hash, so the earlier approval is void.
- Writes can only be proposed from the user's own request text, never from a
  tool result, note, or calendar entry (there is no tool chaining).
- Every proposal, decision, execution, failure and undo is kept as a receipt.
"""
from contextlib import contextmanager
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import hashlib
import json
import re
import secrets
import sqlite3
import threading
import time as clock

from brain import Conflict

ZONE = ZoneInfo('Asia/Manila')
PROPOSAL_SECONDS = 600
READ_TOOLS = ('tasks', 'agenda', 'free_time', 'plan', 'notes')
WRITE_TOOLS = ('add_task', 'complete_task')
TOOLS = READ_TOOLS + WRITE_TOOLS
PRIORITY = {'high': 1, 'normal': 2, 'low': 3}
PRIORITY_LABEL = {1: 'high', 2: 'normal', 3: 'low'}
PARTS = {'morning': (8, 12), 'afternoon': (12, 17), 'evening': (17, 21), 'workday': (8, 18)}
MIN_GAP = 15


def local_now():
    return datetime.now(ZONE)


def clock_label(value):
    return value.astimezone(ZONE).strftime('%I:%M %p').lstrip('0')


def words(text):
    return re.findall(r'[a-z0-9]+', (text or '').lower())


def clean_title(text, limit=80):
    text = ' '.join(str(text or '').replace('\x00', '').split()).strip(' .,:;-"\'')
    if not text:
        raise ValueError('Say what the task is, for example: add a task to draft the proposal.')
    if len(text) > limit:
        raise ValueError(f'Keep the task title to {limit} characters.')
    return text[0].upper() + text[1:]


# ---------------------------------------------------------------- routing ---

GATE = re.compile(r"\b(tasks?|to-?dos?|to do list|calendar|schedule|agenda|meetings?|appointments?|events?|busy|"
                  r"free|available|availability|today|tonight|tomorrow|morning|afternoon|evening|plan|notes?|"
                  r"wrote|written|finished|done|complete|completed|add|remind|next|deadline)\b", re.I)

ADD_PATTERNS = [
    re.compile(r"^(?:please\s+)?(?:can you\s+|could you\s+)?(?:add|create|make|put)\s+(?:a\s+)?(?:new\s+)?(?:task|to-?do)"
               r"(?:\s+(?:to|on|in)\s+(?:my\s+)?(?:list|tasks|task list|to-?do list))?\s*(?:[:,\-]\s*|\s+to\s+|\s+)(.+)$", re.I | re.S),
    re.compile(r"^(?:please\s+)?(?:can you\s+|could you\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+)?"
               r"(?:tasks|task list|to-?do(?:\s+list)?|list)[.!]?$", re.I | re.S),
    re.compile(r"^(?:please\s+)?remind me to\s+(.+)$", re.I | re.S),
]
DONE_PATTERNS = [
    re.compile(r"^(?:please\s+)?(?:mark|check off|tick off|cross off)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)[.!]?$", re.I | re.S),
    re.compile(r"^(?:please\s+)?(?:check|tick|cross)\s+off\s+(?:the\s+)?(?:task\s+)?(.+?)[.!]?$", re.I | re.S),
    re.compile(r"^i(?:'ve| have)?\s+(?:just\s+)?(?:finished|completed)\s+(?:the\s+)?(?:task\s+)?(.+?)[.!]?$", re.I | re.S),
    re.compile(r"^(?:i(?:'m| am)\s+)?(?:all\s+)?done with\s+(?:the\s+)?(?:task\s+)?(.+?)[.!]?$", re.I | re.S),
]
AGENDA_PATTERN = re.compile(r"^(?:what(?:'s| is)\s+on\s+)?(?:my\s+)?(?:calendar|agenda|schedule)(?:\s+(?:for\s+)?(today|tomorrow))?\??$"
                            r"|^what(?:'s| is)\s+on\s+my\s+(?:calendar|agenda|schedule)(?:\s+(?:for\s+)?(today|tomorrow))?[?.!]?$", re.I)
NEXT_PATTERN = re.compile(r"^what(?:'s| is)\s+(?:my\s+)?next(?:\s+(?:meeting|event|appointment|on my calendar))?[?.!]?$", re.I)


DAY_RE = re.compile(r"\btomorrow\b", re.I)
PART_RE = re.compile(r"\b(morning|afternoon|evening|tonight)\b", re.I)
FREE_RE = re.compile(r"\b(?:am i|are we|i'?m|i am|will i be)\s+(?:free|available|busy|open)\b|\bfree time\b|\bwhen\b.*\bfree\b|"
                     r"\b(?:any|have|got)\s+(?:free\s+)?time\b|\bavailability\b", re.I)
AGENDA_RE = re.compile(r"\b(?:what|which|any|show|list|read|do i have|have i got)\b.*\b(?:calendar|agenda|schedule|meetings?|appointments?|events?)\b|"
                       r"\bwhat do i have\b.*\b(?:today|tomorrow|on)\b|\bwhat(?:'s| is) (?:happening|on)\b.*\b(?:today|tomorrow)\b", re.I)
TASKS_RE = re.compile(r"\b(?:what|which|show|list|read|any|how many)\b.*\b(?:tasks?|to-?dos?|to do list)\b|\b(?:tasks?|to-?dos?)\b.*\b(?:left|open|remaining|pending|outstanding)\b", re.I)
PLAN_RE = re.compile(r"\b(?:what(?:'s| is)|show|read|tell me)\b.*\b(?:focus plan|my plan)\b", re.I)
NOTES_RE = re.compile(r"\b(?:what|anything)\b.*\b(?:did|have) i\s+(?:write|written|note|noted|save|saved|jot|jotted)\b.*?\b(?:about|on|for|regarding)\s+(.+?)[?.!]*$|"
                      r"\bwhat do (?:my|the) notes say about\s+(.+?)[?.!]*$|\b(?:search|check|look in) my notes (?:for|about)\s+(.+?)[?.!]*$|"
                      r"\bfind (?:my|the) notes? (?:on|about|for)\s+(.+?)[?.!]*$", re.I)


def read_rule(q):
    day = 'tomorrow' if DAY_RE.search(q) else 'today'
    part = PART_RE.search(q)
    part = {'tonight': 'evening'}.get(part[1].lower(), part[1].lower()) if part else 'workday'
    note = NOTES_RE.search(q)
    if note:
        topic = next(g for g in note.groups() if g)
        return {'tool': 'notes', 'args': {'query': re.sub(r"^(?:the|my|a)\s+", '', topic.strip(), flags=re.I)[:120]}, 'source': 'rule'}
    if FREE_RE.search(q):
        return {'tool': 'free_time', 'args': {'day': day, 'part': part}, 'source': 'rule'}
    if TASKS_RE.search(q) and not re.search(r"\b(?:calendar|meetings?|appointments?)\b", q, re.I):
        scope = re.search(r"\b(business|work|personal)\b", q, re.I)
        return {'tool': 'tasks', 'args': {'scope': ('personal' if scope[1].lower() == 'personal' else 'business') if scope else 'all'}, 'source': 'rule'}
    if AGENDA_RE.search(q):
        return {'tool': 'agenda', 'args': {'day': day}, 'source': 'rule'}
    if PLAN_RE.search(q):
        return {'tool': 'plan', 'args': {}, 'source': 'rule'}
    return None


def extract_task_details(text):
    """Pull minutes, priority and scope out of a spoken task phrase."""
    args = {}
    patterns = [
        (r"\b(?:for|takes?|about|around)?\s*(\d{1,3})\s*(?:minutes?|mins?|m)\b", lambda m: int(m[1])),
        (r"\b(?:for|takes?|about|around)?\s*(\d{1,2}(?:\.5)?)\s*(?:hours?|hrs?|h)\b", lambda m: round(float(m[1]) * 60)),
        (r"\b(?:for|takes?|about|around)?\s*(?:an|one)\s+hour\b", lambda m: 60),
        (r"\b(?:for|takes?|about|around)?\s*half an hour\b", lambda m: 30),
    ]
    for pattern, value in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            args['minutes'] = value(match)
            text = text[:match.start()] + text[match.end():]
            break
    match = re.search(r"\b(?:as\s+)?(?:a\s+)?(high|low|normal|top|urgent)(?:[\s-]+priority)?\b(?=[\s,.!]*$|\s*,)|\b(urgent(?:ly)?|asap)\b", text, re.I)
    if match:
        word = (match[1] or match[2]).lower()
        args['priority'] = 'high' if word in {'high', 'top', 'urgent', 'urgently', 'asap'} else word
        text = text[:match.start()] + text[match.end():]
    match = re.search(r"\b(?:for\s+)?(?:my\s+)?(work|business|personal)\b(?=[\s,.!]*$)|\b(?:for|at)\s+(work)\b", text, re.I)
    if match:
        args['scope'] = 'personal' if (match[1] or match[2]).lower() == 'personal' else 'business'
        text = text[:match.start()] + text[match.end():]
    text = re.sub(r"\s+(?:and|,)\s*$", '', text.strip(' ,.!'))
    args['title'] = text
    return args


def fast_route(question):
    """High-confidence phrasings that need no model call."""
    q = ' '.join(question.split())
    for pattern in ADD_PATTERNS:
        match = pattern.match(q)
        if match:
            return {'tool': 'add_task', 'args': extract_task_details(match[1]), 'source': 'rule',
                    'reminder': q.lower().startswith(('remind', 'please remind'))}
    for pattern in DONE_PATTERNS:
        match = pattern.match(q)
        if match and match[1].strip():
            return {'tool': 'complete_task', 'args': {'task': match[1].strip()}, 'source': 'rule'}
    match = AGENDA_PATTERN.match(q)
    if match:
        return {'tool': 'agenda', 'args': {'day': (match[1] or match[2] or 'today').lower()}, 'source': 'rule'}
    if NEXT_PATTERN.match(q):
        return {'tool': 'agenda', 'args': {'day': 'today'}, 'source': 'rule'}
    return read_rule(q)


ORDINALS = {'first': 0, '1st': 0, 'second': 1, '2nd': 1, 'third': 2, '3rd': 2, 'fourth': 3, '4th': 3, 'fifth': 4, '5th': 4, 'last': -1}
ORDINAL_RE = re.compile(r"\b(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)(?:\s+(?:one|task|item))?\b", re.I)


def resolve_reference(question, items):
    """Turn "mark the second one done" into the exact title from the list Lin just showed."""
    if not items:
        return None
    match = ORDINAL_RE.search(question)
    if not match:
        return None
    index = ORDINALS[match[1].lower()]
    if index >= len(items):
        return None
    candidate = question[:match.start()] + items[index] + question[match.end():]
    route = fast_route(candidate)
    return candidate if route and route['tool'] == 'complete_task' else None


def needs_router(question):
    return bool(GATE.search(question))


ROUTER_SCHEMA = {
    'type': 'object',
    'properties': {
        'tool': {'type': 'string', 'enum': ['none', *TOOLS]},
        'day': {'type': 'string', 'enum': ['today', 'tomorrow']},
        'part': {'type': 'string', 'enum': list(PARTS)},
        'scope': {'type': 'string', 'enum': ['all', 'personal', 'business']},
        'query': {'type': 'string', 'maxLength': 120},
        'title': {'type': 'string', 'maxLength': 80},
        'task': {'type': 'string', 'maxLength': 80},
        'minutes': {'type': 'integer', 'minimum': 1, 'maximum': 480},
        'priority': {'type': 'string', 'enum': list(PRIORITY)},
    },
    'required': ['tool'],
}

ROUTER_PROMPT = """You choose which local tool can answer a request to Lin, a personal assistant. Reply with JSON only.
Tools:
- tasks: list the user's saved tasks. Optional scope (all, personal, business).
- agenda: events in the user's imported calendar. day = today or tomorrow.
- free_time: open gaps between calendar events. day = today or tomorrow; part = morning, afternoon, evening or workday.
- plan: the user's current focus plan built from saved tasks.
- notes: search the user's own notes and saved memories. query = a few key words.
- add_task: the user asks to add or create a task. title = the task in a few words; optional minutes, priority (high, normal, low), scope (personal, business).
- complete_task: the user says a saved task is done. task = words naming the task.
- none: general conversation, advice, drafting or anything else.
Only choose add_task or complete_task when the user clearly asks for that change.
Examples:
"Am I free tomorrow afternoon?" -> {"tool":"free_time","day":"tomorrow","part":"afternoon"}
"What do I have on today?" -> {"tool":"agenda","day":"today"}
"What business tasks are left?" -> {"tool":"tasks","scope":"business"}
"What did I write about the Cebu supplier?" -> {"tool":"notes","query":"Cebu supplier"}
"Add calling the bank to my list, 15 minutes" -> {"tool":"add_task","title":"Call the bank","minutes":15}
"The invoice task is finished" -> {"tool":"complete_task","task":"invoice"}
"How should I prioritize my afternoon?" -> {"tool":"plan"}
"Write a short thank you note to a client" -> {"tool":"none"}"""


def normalize_route(raw):
    """Turn model JSON into validated tool arguments, or None for chat."""
    if not isinstance(raw, dict) or raw.get('tool') not in TOOLS:
        return None
    tool = raw['tool']
    keep = {'tasks': ['scope'], 'agenda': ['day'], 'free_time': ['day', 'part'], 'plan': [], 'notes': ['query'],
            'add_task': ['title', 'minutes', 'priority', 'scope'], 'complete_task': ['task']}[tool]
    args = {k: raw[k] for k in keep if k in raw and raw[k] not in (None, '')}
    if tool == 'notes' and not str(args.get('query', '')).strip():
        return None
    if tool == 'complete_task' and not str(args.get('task', '')).strip():
        return None
    if tool == 'add_task':
        if not str(args.get('title', '')).strip():
            return None
        if args.get('scope') == 'all':
            args.pop('scope')
    return {'tool': tool, 'args': args, 'source': 'model'}


# ------------------------------------------------------------- read tools ---

def day_bounds(day, now):
    start = datetime.combine(now.date(), time.min, ZONE) + timedelta(days=1 if day == 'tomorrow' else 0)
    return start, start + timedelta(days=1)


def calendar_state(snapshot, start, end, now):
    cal = snapshot['calendar']
    if not cal:
        return {'available': False, 'note': 'No calendar has been imported yet, so I can’t see your events or free time. Import one in Today.'}
    covered = datetime.fromisoformat(cal['coverage_start']) <= start and end <= datetime.fromisoformat(cal['coverage_end'])
    age = now - datetime.fromisoformat(cal['imported_at'])
    hours = int(age.total_seconds() // 3600)
    freshness = (f'imported {hours} hours ago' if hours >= 1 else 'imported within the last hour')
    note = f"Imported snapshot {cal['name']}, {freshness}; changes made later in the calendar app are not included."
    if not covered:
        return {'available': False, 'note': 'The imported calendar does not cover that day. Import a fresh export.', 'source': cal['name']}
    return {'available': True, 'note': note, 'stale': age > timedelta(hours=24), 'source': cal['name'],
            'imported_at': cal['imported_at']}


def day_events(snapshot, start, end, now):
    events = []
    for event in snapshot['calendar']['events']:
        a = datetime.fromisoformat(event['start'])
        b = datetime.fromisoformat(event['end'])
        if a < end and (b > start or (a == b and a >= start)):
            status = 'all day' if event['all_day'] else 'finished' if b <= now else 'now' if a <= now else 'upcoming'
            item = {'id': event['id'], 'title': event['title'], 'status': status, 'all_day': event['all_day'],
                    'tentative': event['tentative'], 'location': event['location']}
            if not event['all_day']:
                item.update(start=clock_label(a), end=clock_label(b), _start=a, _end=b)
            events.append(item)
    return events


def public(items):
    return [{k: v for k, v in item.items() if not k.startswith('_')} for item in items]


def tool_tasks(planner, args):
    scope = args.get('scope', 'all')
    if scope not in {'all', 'personal', 'business'}:
        scope = 'all'
    snap = planner.snapshot()
    tasks = [t for t in snap['tasks'] if not t['done'] and (scope == 'all' or t['scope'] == scope)]
    shown = [{'id': t['id'], 'title': t['title'], 'scope': t['scope'], 'minutes': t['minutes'],
              'priority': PRIORITY_LABEL[t['priority']]} for t in tasks[:10]]
    kind = '' if scope == 'all' else scope + ' '
    if not tasks:
        summary = f'You have no open {kind}tasks right now.'
    else:
        high = sum(t['priority'] == 1 for t in tasks)
        summary = (f"You have {len(tasks)} open {kind}task{'s' if len(tasks) != 1 else ''}"
                   + (f", {high} of them high priority." if high else '.'))
        summary += ' ' + ' '.join(f"{'First' if i == 0 else 'Then'}, {t['title']}, {t['minutes']} minutes." for i, t in enumerate(shown[:3]))
        if len(tasks) > 3:
            summary += f' The rest are on the card.'
    return {'tool': 'tasks', 'label': 'Saved tasks', 'scope': scope, 'open': len(tasks), 'tasks': shown,
            'more': max(0, len(tasks) - len(shown)), 'summary': summary,
            'refs': [{'kind': 'task', 'id': t['id'], 'label': t['title']} for t in shown]}


def tool_agenda(calendar, args, now):
    day = args.get('day') if args.get('day') in {'today', 'tomorrow'} else 'today'
    start, end = day_bounds(day, now)
    state = calendar_state(calendar.snapshot(), start, end, now)
    result = {'tool': 'agenda', 'label': f'Calendar · {day}', 'day': day, 'date': start.date().isoformat(), **state, 'events': []}
    if not state['available']:
        result['summary'] = state['note']
        return result
    events = day_events(calendar.snapshot(), start, end, now)
    result['events'] = public(events)
    timed = [e for e in events if not e['all_day']]
    ahead = [e for e in timed if e['status'] in {'now', 'upcoming'}]
    label = day.capitalize()
    all_day = [e for e in events if e['all_day']]
    listed = ahead if day == 'today' else timed
    if not events:
        summary = f'Nothing is on your imported calendar {day}.'
    elif not listed:
        summary = f"{label} you had {len(timed)} timed event{'s' if len(timed) != 1 else ''}, and none remain." if timed else f'{label} has no timed events.'
    else:
        parts = [(f"{e['title']}, happening now until {e['end']}" if e['status'] == 'now' else f"{e['title']} at {e['start']}") for e in listed[:3]]
        lead = 'Coming up today' if day == 'today' else 'Tomorrow you have'
        summary = f"{lead}: {', then '.join(parts)}."
        if len(listed) > 3:
            summary += f' Plus {len(listed) - 3} more on the card.'
    if all_day:
        summary += f" All day: {', '.join(e['title'] for e in all_day[:2])}."
    summary += ' That is from your imported calendar' + (', which is over a day old.' if state.get('stale') else '.')
    result['summary'] = summary
    result['refs'] = [{'kind': 'event', 'id': e['id'], 'label': e['title']} for e in result['events']]
    return result


def tool_free_time(calendar, args, now):
    day = args.get('day') if args.get('day') in {'today', 'tomorrow'} else 'today'
    part = args.get('part') if args.get('part') in PARTS else 'workday'
    start, end = day_bounds(day, now)
    state = calendar_state(calendar.snapshot(), start, end, now)
    first, last = PARTS[part]
    window_start = start + timedelta(hours=first)
    window_end = start + timedelta(hours=last)
    result = {'tool': 'free_time', 'label': f'Free time · {day} {part}', 'day': day, 'part': part,
              'window': f'{clock_label(window_start)} to {clock_label(window_end)}', **state, 'gaps': [], 'busy': []}
    if not state['available']:
        result['summary'] = state['note']
        return result
    if day == 'today' and now > window_start:
        rounded = now + timedelta(minutes=(5 - now.minute % 5) % 5)
        window_start = rounded.replace(second=0, microsecond=0)
    if window_start >= window_end:
        result['summary'] = f'The {part} has already passed today.'
        return result
    events = day_events(calendar.snapshot(), start, end, now)
    blocks = sorted((max(e['_start'], window_start), min(e['_end'], window_end), e)
                    for e in events if not e['all_day'] and e['_start'] < window_end and e['_end'] > window_start)
    gaps, cursor = [], window_start
    for a, b, e in blocks:
        result['busy'].append({'id': e['id'], 'title': e['title'], 'start': e['start'], 'end': e['end'], 'tentative': e['tentative']})
        if (a - cursor) >= timedelta(minutes=MIN_GAP):
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    if (window_end - cursor) >= timedelta(minutes=MIN_GAP):
        gaps.append((cursor, window_end))
    result['gaps'] = [{'start': clock_label(a), 'end': clock_label(b), 'minutes': int((b - a).total_seconds() // 60)} for a, b in gaps]
    total = sum(g['minutes'] for g in result['gaps'])
    when = f"this {part}" if day == 'today' and part != 'workday' else 'today' if day == 'today' else f'tomorrow {part}' if part != 'workday' else 'tomorrow'
    if not gaps:
        summary = f'You have no free block of {MIN_GAP} minutes or more {when}.'
    elif len(gaps) == 1:
        g = result['gaps'][0]
        summary = f"You're free {when} from {g['start']} to {g['end']}, {g['minutes']} minutes" + (' with nothing booked.' if not result['busy'] else '.')
    else:
        longest = max(result['gaps'], key=lambda g: g['minutes'])
        summary = (f"{when[0].upper() + when[1:]} you have {len(gaps)} free blocks, {total} minutes in all. "
                   f"The longest is {longest['start']} to {longest['end']}, {longest['minutes']} minutes.")
    if any(b['tentative'] for b in result['busy']):
        summary += ' I counted tentative events as busy.'
    summary += ' That is from your imported calendar' + (', which is over a day old.' if state.get('stale') else '.')
    result['summary'] = summary
    result['refs'] = [{'kind': 'event', 'id': b['id'], 'label': b['title']} for b in result['busy']]
    return result


def tool_plan(planner, args):
    snap = planner.snapshot()
    plan = snap['plan']
    steps = [{'id': s['id'], 'title': s['title'], 'minutes': s['minutes'], 'from_minute': s['start'], 'to_minute': s['end']} for s in plan['steps']]
    return {'tool': 'plan', 'label': 'Focus plan', 'used': plan['used'], 'available': plan['available'], 'free': plan['free'],
            'steps': steps[:6], 'deferred': len(plan['deferred']), 'summary': snap['summary'],
            'note': 'Built from saved task estimates; not fitted around calendar events.',
            'refs': [{'kind': 'task', 'id': s['id'], 'label': s['title']} for s in steps[:6]]}


def tool_notes(brain, args):
    query = str(args.get('query', '')).strip()[:120]
    sources = brain.search(query, refresh=False) if query else []
    items = [{'id': s['id'], 'kind': s['kind'], 'title': s['title'], 'scope': s.get('scope'),
              'lines': [s.get('line_start'), s.get('line_end')] if s['kind'] == 'file' else None,
              'where': s.get('where') if s['kind'] == 'file' else None,
              'text': ' '.join(s['body'].split())[:500]} for s in sources]
    summary = ('I could not find a matching note or saved memory for that.' if not items else
               f"The closest match is {items[0]['title']}: " + items[0]['text'][:240])
    return {'tool': 'notes', 'label': f'Notes · "{query}"', 'query': query, 'items': items, 'summary': summary,
            'sources': sources,
            'refs': [{'kind': s['kind'], 'id': s['id'], 'label': s['title']} for s in items]}


def run_read(tool, args, planner, calendar, brain, now=None):
    now = (now or local_now()).astimezone(ZONE)
    if tool == 'tasks':
        result = tool_tasks(planner, args)
    elif tool == 'agenda':
        result = tool_agenda(calendar, args, now)
    elif tool == 'free_time':
        result = tool_free_time(calendar, args, now)
    elif tool == 'plan':
        result = tool_plan(planner, args)
    elif tool == 'notes':
        result = tool_notes(brain, args)
    else:
        raise ValueError('Unknown read tool.')
    result['checked_at'] = now.isoformat(timespec='seconds')
    result['checked_label'] = now.strftime('%A %d %B %Y, ') + clock_label(now) + ' Manila time'
    return result


def model_context(result):
    """Compact, untrusted data for the answer model. No ids, no internal fields."""
    drop = {'refs', 'sources', 'checked_at', 'checked_label', 'imported_at', 'tool', 'window', 'label'}
    data = {k: v for k, v in result.items() if k not in drop}
    for key in ('tasks', 'events', 'steps', 'busy', 'items'):
        if key in data:
            data[key] = [{k: v for k, v in item.items() if k not in {'id'}} for item in data[key]]
    if 'gaps' in data:
        data['free_blocks'] = data.pop('gaps')
        data['busy_blocks'] = data.pop('busy')
    return data


def context_text(result):
    """Compact plain-text data for the answer model: fewer tokens than JSON, no ids or internals."""
    tool = result['tool']
    lines = []
    if result.get('available') is False:
        return result.get('note') or result['summary']
    if tool in {'agenda', 'free_time'}:
        lines.append(f"Source: imported calendar snapshot{' (over a day old)' if result.get('stale') else ''}.")
    if tool == 'agenda':
        lines.append(f"Events {result['day']}:")
        for e in result['events'][:10]:
            when = 'all day' if e['all_day'] else f"{e['start']} to {e['end']}"
            lines.append(f"- {e['title']}, {when}, {e['status']}{', tentative' if e['tentative'] else ''}")
        if not result['events']:
            lines.append('- none')
    elif tool == 'free_time':
        lines.append(f"Checked: {result['day']} {result['part']}.")
        lines.append('Free blocks: ' + ('; '.join(f"{g['start']} to {g['end']} ({g['minutes']} min)" for g in result['gaps']) or 'none') + '.')
        lines.append('Busy: ' + ('; '.join(f"{b['title']} {b['start']} to {b['end']}{' (tentative)' if b['tentative'] else ''}" for b in result['busy']) or 'nothing booked') + '.')
    elif tool == 'tasks':
        lines.append(f"Open {'' if result['scope'] == 'all' else result['scope'] + ' '}tasks: {result['open']}.")
        lines += [f"- {t['title']}, {t['scope']}, {t['minutes']} min, {t['priority']} priority" for t in result['tasks']]
    elif tool == 'plan':
        lines.append(f"Focus plan: {result['used']} of {result['available']} minutes used, {result['deferred']} tasks did not fit. Not fitted around calendar events.")
        lines += [f"- minute {s['from_minute']} to {s['to_minute']}: {s['title']} ({s['minutes']} min)" for s in result['steps']]
    elif tool == 'notes':
        lines += [f"- {i['title']}: {i['text'][:400]}" for i in result['items']] or ['- no matching notes']
    return '\n'.join(lines)


def answer_instruction(result):
    tool = result['tool']
    text = 'Answer my question above in at most three short spoken sentences using only this data. Do not repeat the data. Quote times exactly as written.'
    if tool in {'agenda', 'free_time'} and result.get('available'):
        text += ' Mention once that this comes from an imported calendar snapshot.'
    if tool == 'free_time':
        text += ' Only the listed free blocks are free; never describe the whole period as free when something is busy.'
    return text


TIME_RE = re.compile(r'\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?', re.I)
CLAIM_RE = re.compile(r"\b(i(?:'ve| have)?\s+(?:added|created|scheduled|booked|marked|completed|removed|deleted|sent|set (?:a|up)|moved)|"
                      r"(?:has|have) been (?:added|scheduled|booked|marked|sent))\b", re.I)


_T = r'\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\b\.?'
RANGE_RE = re.compile(rf'({_T})\s*(?:to|until|till|through|-|–|—)\s*({_T})', re.I)
ECHO_RE = re.compile(r'checked (?:on this computer|sources)|data lin checked|not instructions|end of data|free blocks:|busy:|checked:|source:|[{}\[\]]|"\w+":', re.I)


def verify_answer(answer, result):
    """Reject a generated answer that echoes the data, cites times absent from it, or claims an action."""
    if ECHO_RE.search(answer):
        return False, 'repeated the data block'
    if CLAIM_RE.search(answer):
        return False, 'claimed an action'
    allowed = set()
    blob = json.dumps(model_context(result))
    for m in TIME_RE.finditer(blob):
        allowed.add((int(m[1]) % 12, int(m[2] or 0), m[3].lower()))
    for m in TIME_RE.finditer(answer):
        if (int(m[1]) % 12, int(m[2] or 0), m[3].lower()) not in allowed:
            return False, f'mentioned {m[0]} which is not in the checked data'
    key = lambda m: (int(m[1]) % 12, int(m[2] or 0), m[3].lower())
    pairs = set()
    for item in result.get('gaps', []) + result.get('busy', []) + [e for e in result.get('events', []) if 'start' in e]:
        a, b = TIME_RE.search(item['start']), TIME_RE.search(item['end'])
        pairs.add((key(a), key(b)))
    if result['tool'] in {'free_time', 'agenda'}:
        for m in RANGE_RE.finditer(answer):
            a, b = TIME_RE.search(m[1]), TIME_RE.search(m[2])
            if (key(a), key(b)) not in pairs:
                return False, f'described {m[0]} which is not a listed block'
    return True, 'ok'


# ------------------------------------------------------------ write tools ---

def validate_add(args):
    title = clean_title(args.get('title'))
    minutes = args.get('minutes', 25)
    if type(minutes) is not int or not 1 <= minutes <= 480:
        raise ValueError('Task estimates must be 1 to 480 minutes.')
    priority = args.get('priority', 'normal')
    if isinstance(priority, int):
        priority = PRIORITY_LABEL.get(priority, priority)
    if priority not in PRIORITY:
        raise ValueError('Priority must be high, normal or low.')
    scope = args.get('scope', 'personal')
    if scope not in {'personal', 'business'}:
        raise ValueError('Scope must be personal or business.')
    return {'title': title, 'minutes': minutes, 'priority': priority, 'scope': scope}


def match_task(tasks, phrase):
    """Deterministic match of a spoken phrase to one open task, or explain why not."""
    target = [w for w in words(phrase) if w not in {'the', 'a', 'my', 'task', 'to', 'do'}]
    if not target:
        return None, []
    scored = []
    for task in tasks:
        if task['done']:
            continue
        title = words(task['title'])
        if ' '.join(title) == ' '.join(target):
            return task, []
        overlap = len(set(target) & set(title))
        if overlap:
            scored.append((overlap / max(len(set(target)), 1), overlap / max(len(set(title)), 1), task))
    scored.sort(key=lambda s: (-s[0], -s[1], s[2]['created_at']))
    if not scored or scored[0][0] < 0.5:
        return None, [s[2] for s in scored[:3]]
    if len(scored) > 1 and scored[1][0] == scored[0][0] and scored[1][1] == scored[0][1]:
        return None, [s[2] for s in scored[:3]]
    return scored[0][2], []


def describe(tool, payload):
    if tool == 'add_task':
        return (f"Add task “{payload['title']}” · {payload['scope']} · {payload['minutes']} min · "
                f"{payload['priority']} priority")
    if tool == 'complete_task':
        return f"Mark “{payload['title']}” as done"
    if tool == 'save_note':
        return f"Save “{payload['title']}” to Lin Brain · {payload['file']}"
    if tool == 'forget_conversations':
        turns, convs = payload.get('turns', 0), payload.get('conversations', 0)
        what = f"{turns} saved turn{'s' if turns != 1 else ''}" + (f" from {convs} conversations" if convs > 1 else '')
        return f"Forget {payload['label']} · {what} · can be undone for 10 minutes, then erased for good"
    if tool == 'send_to_claude':
        extra = ' and our last exchange' if payload.get('context') else ''
        return f"Send to Claude ({payload.get('label') or 'Claude'}) · your question{extra}, nothing else"
    if tool == 'mcp':
        args = ', '.join(f'{k}: {json.dumps(v, ensure_ascii=False)}' for k, v in payload['arguments'].items())
        args = args if len(args) <= 160 else args[:159] + '…'
        return f"Run {payload['tool']} from {payload['server']}" + (f' · {args}' if args else '')
    return tool


def payload_hash(tool, payload):
    return hashlib.sha256(json.dumps({'tool': tool, 'payload': payload}, sort_keys=True).encode()).hexdigest()[:32]


class ActionStore:
    """Persistent proposals and receipts. One row per proposed change."""

    def __init__(self, data_dir, planner):
        self.path = Path(data_dir) / 'actions.sqlite3'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.planner = planner
        self.mcp = None  # set by the server: mcp_client.Manager
        self.brain = None  # set by the server: brain.Brain (Save to brain writes into its folder)
        self.conversations = None  # set by the server: conversations.ConversationStore
        self.lock = threading.RLock()
        with self.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, tool TEXT NOT NULL, request TEXT NOT NULL,
                payload TEXT NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL,
                expires REAL NOT NULL, decided_at TEXT, result TEXT, undo TEXT, note TEXT)''')
            db.execute('CREATE TABLE IF NOT EXISTS meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL)')
            db.execute('INSERT OR IGNORE INTO meta VALUES(1,0)')
            # A crash between "executing" and the receipt leaves an honest unknown, never a silent retry.
            changed = db.execute("UPDATE actions SET state='unknown', note=? WHERE state='executing'",
                                 ('Lin stopped while making this change. Check your tasks before trying again.',)).rowcount
            if changed:
                db.execute('UPDATE meta SET revision=revision+1')

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.path)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA secure_delete=ON')
            try:
                with db:
                    yield db
            finally:
                db.close()

    def revision(self):
        with self.db() as db:
            return db.execute('SELECT revision FROM meta').fetchone()[0]

    def _bump(self, db):
        db.execute('UPDATE meta SET revision=revision+1')

    def _expire(self, db):
        if db.execute("UPDATE actions SET state='expired', decided_at=? WHERE state='proposed' AND expires<?",
                      (datetime.now(timezone.utc).isoformat(timespec='seconds'), clock.time())).rowcount:
            self._bump(db)

    def _row(self, row):
        item = dict(row)
        item['payload'] = json.loads(item['payload'])
        item['result'] = json.loads(item['result']) if item['result'] else None
        item['can_undo'] = item['state'] == 'executed' and bool(item.pop('undo'))
        item['description'] = describe(item['tool'], item['payload'])
        item['seconds_left'] = max(0, int(item['expires'] - clock.time())) if item['state'] == 'proposed' else 0
        item.pop('expires')
        return item

    def get(self, action_id):
        with self.db() as db:
            self._expire(db)
            row = db.execute('SELECT * FROM actions WHERE id=?', (action_id,)).fetchone()
            return self._row(row) if row else None

    def recent(self, limit=30):
        with self.db() as db:
            self._expire(db)
            rows = db.execute('SELECT * FROM actions ORDER BY created_at DESC, rowid DESC LIMIT ?', (limit,)).fetchall()
            return {'revision': db.execute('SELECT revision FROM meta').fetchone()[0], 'actions': [self._row(r) for r in rows]}

    def prepare(self, tool, args):
        """Validate arguments into the exact payload a person will approve."""
        if tool == 'add_task':
            return validate_add(args)
        if tool == 'complete_task':
            phrase = str(args.get('task', '')).strip()
            snap = self.planner.snapshot()
            task, candidates = match_task(snap['tasks'], phrase)
            if not task:
                names = ', '.join(f"“{c['title']}”" for c in candidates)
                raise ValueError(f'I could not tell which task you meant. Did you mean {names}?' if names else
                                 'I could not find an open task matching that. Check Plan my day for the exact name.')
            return {'task_id': task['id'], 'title': task['title'], 'task_revision': task['revision']}
        if tool == 'save_note':
            return self._note_payload(args)
        if tool == 'forget_conversations':
            if not self.conversations:
                raise ValueError('Conversation memory is not available right now.')
            scope = args.get('scope')
            if scope not in ('this', 'today', 'yesterday', 'week', 'all'):
                raise ValueError('Choose which conversations to forget.')
            payload = self.conversations.preview_forget(scope, args.get('conversation'))
            if not payload['turns']:
                raise ValueError(f"There is nothing saved from {payload['label']} to forget." if scope != 'this' else
                                 'Nothing from this conversation is saved, so there is nothing to forget.')
            return payload
        if tool == 'send_to_claude':
            import cloud_brain
            question, text = str(args.get('question', '')).strip(), str(args.get('text', ''))
            if not question or not text or len(text) > 4000 or '\x00' in text:
                raise ValueError('There is nothing to send to Claude.')
            if args.get('model') not in cloud_brain.MODELS or not re.fullmatch(r'[a-f0-9]{32}', str(args.get('conversation', ''))):
                raise ValueError('Choose a Claude model in Settings first.')
            context = args.get('context')
            if context is not None and not (isinstance(context, dict) and {'question', 'answer'} <= set(context)):
                raise ValueError('The context for Claude is not valid.')
            return {'question': question[:1000], 'text': text, 'context': context, 'conversation': args['conversation'],
                    'model': args['model'], 'label': cloud_brain.MODELS[args['model']]}
        if tool == 'mcp':
            import mcp_client
            server, name = str(args.get('server', '')), str(args.get('tool', ''))
            found = self.mcp.find(server, name) if self.mcp else None
            if not found:
                raise ValueError('That tool is not connected or is turned off in Tools.')
            arguments = mcp_client.check_arguments(found['schema'], args.get('arguments') or {})
            return {'server': server, 'tool': name, 'arguments': arguments, 'read_only': found['read_only']}
        raise ValueError('That change is not available.')

    def _note_payload(self, args):
        from presence import NOTE_FOLDER
        if not self.brain:
            raise ValueError('Lin Brain is not available right now.')
        title = ' '.join(str(args.get('title', '')).replace('\x00', '').split())[:80].strip()
        body = str(args.get('body', ''))
        if not title:
            raise ValueError('Give the note a title.')
        if not body.strip() or len(body) > 12000 or '\x00' in body:
            raise ValueError('The note must have 1 to 12,000 characters.')
        safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', title).strip(' .')[:70] or 'Saved answer'
        stamp = local_now().strftime('%Y-%m-%d')
        folder = Path(self.brain.folder) / NOTE_FOLDER
        name, n = f'{stamp} {safe}.md', 2
        while (folder / name).exists():
            name, n = f'{stamp} {safe} ({n}).md', n + 1
        return {'title': title, 'body': body, 'file': f'{NOTE_FOLDER}/{name}'}

    def propose(self, tool, args, request):
        if tool not in WRITE_TOOLS and tool not in ('mcp', 'save_note', 'forget_conversations', 'send_to_claude'):
            raise ValueError('Only listed changes can be proposed.')
        payload = self.prepare(tool, args)
        action_id = secrets.token_hex(16)
        with self.db() as db:
            self._expire(db)
            db.execute('INSERT INTO actions(id,tool,request,payload,hash,state,created_at,expires) VALUES(?,?,?,?,?,?,?,?)',
                       (action_id, tool, ' '.join(request.split())[:300], json.dumps(payload), payload_hash(tool, payload),
                        'proposed', datetime.now(timezone.utc).isoformat(timespec='seconds'), clock.time() + PROPOSAL_SECONDS))
            self._bump(db)
        return self.get(action_id)

    def revise(self, action_id, fields):
        """Edits produce a new payload and hash; any earlier approval no longer matches."""
        with self.db() as db:
            self._expire(db)
            row = db.execute('SELECT * FROM actions WHERE id=?', (action_id,)).fetchone()
            if not row or row['state'] != 'proposed':
                raise Conflict('This proposal is no longer open. Ask Lin again.')
            if row['tool'] == 'save_note':
                payload = self._note_payload({**json.loads(row['payload']), 'title': fields.get('title', '')})
                db.execute('UPDATE actions SET payload=?, hash=? WHERE id=?', (json.dumps(payload), payload_hash(row['tool'], payload), action_id))
                self._bump(db)
                return self._row(db.execute('SELECT * FROM actions WHERE id=?', (action_id,)).fetchone())
            if row['tool'] != 'add_task':
                raise ValueError('Only new task details can be edited here.')
            payload = validate_add({**json.loads(row['payload']), **{k: v for k, v in fields.items() if k in {'title', 'minutes', 'priority', 'scope'}}})
            db.execute('UPDATE actions SET payload=?, hash=? WHERE id=?', (json.dumps(payload), payload_hash(row['tool'], payload), action_id))
            self._bump(db)
        return self.get(action_id)

    def reject(self, action_id):
        with self.db() as db:
            self._expire(db)
            row = db.execute('SELECT state FROM actions WHERE id=?', (action_id,)).fetchone()
            if not row or row['state'] != 'proposed':
                raise Conflict('This proposal is no longer open.')
            db.execute("UPDATE actions SET state='rejected', decided_at=? WHERE id=?",
                       (datetime.now(timezone.utc).isoformat(timespec='seconds'), action_id))
            self._bump(db)
        return self.get(action_id)

    def approve(self, action_id, approved_hash):
        with self.db() as db:
            self._expire(db)
            row = db.execute('SELECT * FROM actions WHERE id=?', (action_id,)).fetchone()
            if not row:
                raise Conflict('This proposal no longer exists.')
            if row['state'] != 'proposed':
                raise Conflict({'expired': 'This proposal expired. Ask Lin again.',
                                'executed': 'This change was already made.'}.get(row['state'], 'This proposal is no longer open.'))
            if not isinstance(approved_hash, str) or approved_hash != row['hash']:
                raise Conflict('The proposal changed after you reviewed it. Review the current details and approve again.')
            db.execute("UPDATE actions SET state='executing', decided_at=? WHERE id=?",
                       (datetime.now(timezone.utc).isoformat(timespec='seconds'), action_id))
            self._bump(db)
        tool, payload = row['tool'], json.loads(row['payload'])
        try:
            result, undo = self._execute(tool, payload)
            state, note = 'executed', None
        except (Conflict, ValueError) as exc:
            result, undo, state, note = None, None, 'failed', str(exc)
        except Exception:
            result, undo, state, note = None, None, 'unknown', 'The change could not be confirmed. Check your tasks before trying again.'
        with self.db() as db:
            db.execute('UPDATE actions SET state=?, result=?, undo=?, note=? WHERE id=?',
                       (state, json.dumps(result) if result else None, json.dumps(undo) if undo else None, note, action_id))
            self._bump(db)
        return self.get(action_id)

    def _execute(self, tool, payload):
        planner = self.planner
        if tool == 'add_task':
            before = {t['id'] for t in planner.snapshot()['tasks']}
            snap = planner.mutate('save', {'revision': planner.revision(), 'title': payload['title'], 'scope': payload['scope'],
                                           'minutes': payload['minutes'], 'priority': PRIORITY[payload['priority']]})
            added = [t for t in snap['tasks'] if t['id'] not in before]
            if len(added) != 1:
                raise RuntimeError('Could not confirm the new task.')
            task = added[0]
            return ({'task_id': task['id'], 'title': task['title'], 'verified': True},
                    {'task_id': task['id'], 'task_revision': task['revision']})
        if tool == 'complete_task':
            task = next((t for t in planner.snapshot()['tasks'] if t['id'] == payload['task_id']), None)
            if not task:
                raise Conflict('That task was removed after Lin prepared this change.')
            if task['revision'] != payload['task_revision'] or task['done']:
                raise Conflict('That task changed after Lin prepared this change. Ask again to review it.')
            snap = planner.mutate('done', {'revision': planner.revision(), 'id': task['id'], 'done': True})
            after = next(t for t in snap['tasks'] if t['id'] == task['id'])
            if not after['done']:
                raise RuntimeError('Could not confirm the task is done.')
            return ({'task_id': task['id'], 'title': task['title'], 'verified': True},
                    {'task_id': task['id'], 'task_revision': after['revision']})
        if tool == 'save_note':
            path = Path(self.brain.folder) / payload['file']
            path.parent.mkdir(parents=True, exist_ok=True)
            text = f"# {payload['title']}\n\n{payload['body']}"
            with path.open('x', encoding='utf-8', newline='\n') as f:  # never overwrites an existing note
                f.write(text)
            if path.read_text(encoding='utf-8') != text:
                raise RuntimeError('Could not confirm the saved note.')
            digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
            self.brain.scan()
            return {'path': payload['file'], 'verified': True}, {'file': payload['file'], 'sha256': digest}
        if tool == 'forget_conversations':
            batch = secrets.token_hex(8)
            forgotten = self.conversations.forget(payload, batch)
            left = self.conversations.preview_forget(payload['scope'], payload.get('conversation'))
            return {'forgotten': forgotten, 'left': left['turns'], 'verified': left['turns'] == 0}, {'batch': batch}
        if tool == 'send_to_claude':
            # Approving only unlocks one send of exactly this text; Lin sends it when the answer starts (see consume).
            return {'approved': True, 'used': False}, None
        if tool == 'mcp':
            import mcp_client
            if not self.mcp:
                raise ValueError('Tools are not available right now.')
            try:
                text = self.mcp.call(payload['server'], payload['tool'], payload['arguments'])
            except mcp_client.MCPError as exc:
                raise ValueError(str(exc)) from exc
            return {'text': text, 'verified': False}, None
        raise ValueError('Unknown change.')

    def consume(self, action_id, conversation, within=600):
        """Use an approved "Send to Claude?" once: returns its payload, or raises Conflict."""
        with self.db() as db:
            row = db.execute('SELECT * FROM actions WHERE id=?', (action_id,)).fetchone()
            if not row or row['tool'] != 'send_to_claude' or row['state'] != 'executed':
                raise Conflict('That approval is not open. Ask again.')
            result = json.loads(row['result'] or '{}')
            if result.get('used'):
                raise Conflict('That question was already sent to Claude.')
            payload = json.loads(row['payload'])
            if payload.get('conversation') != conversation:
                raise Conflict('That approval belongs to another conversation.')
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(row['decided_at'])).total_seconds()
            except (TypeError, ValueError):
                age = within + 1
            if age > within:
                raise Conflict('That approval is more than 10 minutes old. Ask again.')
            db.execute('UPDATE actions SET result=? WHERE id=?', (json.dumps({**result, 'used': True}), action_id))
            self._bump(db)
            return payload

    def undo(self, action_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM actions WHERE id=?', (action_id,)).fetchone()
            if not row or row['state'] != 'executed' or not row['undo']:
                raise Conflict('This change cannot be undone.')
        undo = json.loads(row['undo'])
        if row['tool'] == 'forget_conversations':
            restored = self.conversations.restore(undo['batch'])
            if restored is None:
                raise Conflict('It has been more than 10 minutes, so those conversations are already erased for good.')
            with self.db() as db:
                db.execute("UPDATE actions SET state='undone', undo=NULL WHERE id=?", (action_id,))
                self._bump(db)
            return self.get(action_id)
        if row['tool'] == 'save_note':
            path = Path(self.brain.folder) / undo['file']
            if not path.exists():
                raise Conflict('That note was already removed.')
            if hashlib.sha256(path.read_bytes()).hexdigest() != undo['sha256']:
                raise Conflict('That note was edited afterwards. Remove it from your Lin Brain folder instead.')
            path.unlink()
            self.brain.scan()
            with self.db() as db:
                db.execute("UPDATE actions SET state='undone', undo=NULL WHERE id=?", (action_id,))
                self._bump(db)
            return self.get(action_id)
        planner = self.planner
        task = next((t for t in planner.snapshot()['tasks'] if t['id'] == undo['task_id']), None)
        if not task:
            raise Conflict('That task was already removed.')
        if task['revision'] != undo['task_revision']:
            raise Conflict('That task was edited afterwards. Change it in Plan my day instead.')
        if row['tool'] == 'add_task':
            planner.mutate('remove', {'revision': planner.revision(), 'id': task['id']})
        else:
            planner.mutate('done', {'revision': planner.revision(), 'id': task['id'], 'done': False})
        with self.db() as db:
            db.execute("UPDATE actions SET state='undone', undo=NULL WHERE id=?", (action_id,))
            self._bump(db)
        return self.get(action_id)


def proposal_answer(action, reminder=False):
    text = f"I've prepared this for you to approve: {action['description'].replace(' · ', ', ')}. Nothing changes until you approve it."
    if reminder:
        text += ' I cannot send reminders yet, so this becomes a task.'
    return text


def tool_result_answer(tool, text):
    plain = ' '.join(str(text).split())
    if len(plain) <= 240 and plain:
        return f'{tool} says: {plain}'
    return f'{tool} finished. The full result is on the card.'


def receipt_answer(action):
    if action['tool'] == 'send_to_claude':
        return None if action['state'] == 'executed' else (action.get('note') or 'Nothing was sent to Claude.')
    if action['state'] == 'executed' and action['tool'] == 'save_note':
        return "Saved. It's in Lin Brain under Saved answers, and it's on your map now."
    if action['state'] == 'executed' and action['tool'] == 'mcp':
        return 'Done. ' + tool_result_answer(action['payload']['tool'], (action.get('result') or {}).get('text', ''))
    if action['state'] == 'executed':
        if action['tool'] == 'forget_conversations':
            n = (action.get('result') or {}).get('forgotten', 0)
            return f"Done. I've forgotten {n} saved turn{'s' if n != 1 else ''} from {action['payload']['label']}. You can undo it for the next 10 minutes."
        return {'add_task': f"Done. {action['payload']['title']} is on your task list.",
                'complete_task': f"Done. {action['payload']['title']} is marked complete."}[action['tool']]
    return action.get('note') or 'That change was not made.'
