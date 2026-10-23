"""Isolated calendar parsing, recurrence, persistence and briefing checks."""
from datetime import date, datetime, timedelta
from pathlib import Path
import tempfile
from calendar_store import CalendarStore, ZONE, parse_calendar, briefing
from planner import Planner
from brain import Conflict

def export(*events):return ('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lin test//EN\r\n'+''.join('BEGIN:VEVENT\r\n'+event.replace('\n','\r\n')+'\r\nEND:VEVENT\r\n' for event in events)+'END:VCALENDAR\r\n').encode()
day=date(2026,10,22)
raw=export('UID:utc\nDTSTART:20261022T010000Z\nDTEND:20261022T020000Z\nSUMMARY:UTC meeting',
 'UID:daily\nDTSTART;TZID=Asia/Manila:20261022T110000\nDTEND;TZID=Asia/Manila:20261022T113000\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE;TZID=Asia/Manila:20261023T110000\nSUMMARY:Daily meeting',
 'UID:daily\nRECURRENCE-ID;TZID=Asia/Manila:20261024T110000\nDTSTART;TZID=Asia/Manila:20261024T140000\nDTEND;TZID=Asia/Manila:20261024T143000\nSUMMARY:Moved meeting',
 'UID:all\nDTSTART;VALUE=DATE:20261022\nDTEND;VALUE=DATE:20261024\nSUMMARY:Two-day event',
 'UID:cancel\nDTSTART:20261022T020000Z\nDTEND:20261022T030000Z\nSTATUS:CANCELLED\nSUMMARY:Cancelled',
 'UID:float\nDTSTART:20261022T160000\nDTEND:20261022T163000\nSUMMARY:Floating meeting',
 'UID:overnight\nDTSTART:20261021T150000Z\nDTEND:20261021T170000Z\nSUMMARY:Overnight')
parsed=parse_calendar(raw,day)
assert parsed['floating']
events=parsed['events'];assert not any(e['title']=='Cancelled' for e in events)
assert next(e for e in events if e['title']=='UTC meeting')['start']=='2026-10-22T09:00:00+08:00'
assert next(e for e in events if e['title']=='Floating meeting')['start']=='2026-10-22T16:00:00+08:00'
assert next(e for e in events if e['title']=='Moved meeting')['start']=='2026-10-24T14:00:00+08:00'
assert len([e for e in events if e['title']=='Daily meeting'])==1
dst=parse_calendar(export('UID:dst\nDTSTART;TZID=America/New_York:20261031T090000\nDTEND;TZID=America/New_York:20261031T100000\nRRULE:FREQ=DAILY;COUNT=3\nSUMMARY:DST test'),day)
assert [e['start'][11:16] for e in dst['events']]==['21:00','22:00','22:00']
for bad in [b'not calendar',export('UID:bad\nDTSTART;TZID=Unknown/Zone:20261022T090000'),export('UID:bad\nDTSTART:20261022T090000Z\nRRULE:FREQ=SECONDLY'),export('UID:bad\nDTSTART:20261022T090000Z\nDTEND:20261022T080000Z')]:
    try:parse_calendar(bad,day);raise AssertionError('Invalid calendar accepted')
    except ValueError:pass
with tempfile.TemporaryDirectory(prefix='calendar-test-',dir=Path(__file__).parent/'runtime') as tmp:
    store=CalendarStore(tmp);planner=Planner(tmp)
    assert store.snapshot()=={'revision':0,'calendar':None}
    preview=store.prepare(raw,'test-calendar.ics');assert store.snapshot()['calendar'] is None
    store.commit({'id':preview['id'],'revision':preview['revision']})
    saved=store.snapshot();assert CalendarStore(tmp).snapshot()==saved
    try:store.commit({'id':preview['id'],'revision':preview['revision']});raise AssertionError('Consumed preview accepted')
    except Conflict:pass
    try:store.prepare(b'invalid','invalid.ics');raise AssertionError('Invalid worker result accepted')
    except ValueError:pass
    assert store.snapshot()==saved
    p=store.prepare(raw,'discard.ics');store.discard(p['id']);assert store.snapshot()==saved
    p=store.prepare(raw,'expire.ics');store.preview['expires']=0
    try:store.commit({'id':p['id'],'revision':p['revision']});raise AssertionError('Expired preview accepted')
    except Conflict:pass
    # Use a fixed snapshot to verify exact day boundaries independent of system date.
    fixed={'revision':3,'calendar':{**parsed,'name':'Test calendar','imported_at':'2026-10-22T08:00:00+08:00'}}
    a=briefing(fixed,planner.snapshot(),datetime(2026,10,22,8,30,tzinfo=ZONE))
    assert a['covered'] and not a['stale'] and len(a['summary'])<=600
    assert next(e for e in a['events'] if e['title']=='Overnight')['status']=='Finished'
    assert 'Next at 9:00 AM: UTC meeting' in a['summary']
    b=briefing(fixed,planner.snapshot(),datetime(2026,10,22,9,15,tzinfo=ZONE));assert b['revision']!=a['revision'] and 'Happening now' in b['summary']
    c=briefing(fixed,planner.snapshot(),datetime(2026,10,24,10,tzinfo=ZONE));assert not any(e['title']=='Two-day event' for e in c['events']);assert c['stale']
    expired=briefing(fixed,planner.snapshot(),datetime(2026,11,30,tzinfo=ZONE));assert not expired['covered'] and not expired['events']
    store.forget(saved['revision']);assert not store.snapshot()['calendar']
print('PASS: UTC/floating/Manila/DST times, recurrence exclusions and moved occurrences, cancelled/all-day/overnight events, rejected invalid input, preview/commit/discard/expiry, persistence, stale/out-of-range briefings and event-boundary revisions.')
