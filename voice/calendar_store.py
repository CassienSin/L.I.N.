"""Local, reviewed calendar snapshots and deterministic daily briefings."""
from datetime import date, datetime, time, timedelta, timezone
from contextlib import contextmanager
from pathlib import Path
from zoneinfo import ZoneInfo
import hashlib
import json
import secrets
import sqlite3
import subprocess
import sys
import threading
import time as clock
from brain import Conflict

ZONE=ZoneInfo('Asia/Manila')
MAX_BYTES=256*1024

def local_now():return datetime.now(ZONE)

def clean(value,limit=120):
    return ' '.join(str(value or '').replace('\x00','').split())[:limit]

def parse_calendar(raw, day):
    from icalendar import Calendar
    import recurring_ical_events
    if not raw or len(raw)>MAX_BYTES:raise ValueError('Use an .ics export up to 256 KB.')
    try:cal=Calendar.from_ical(raw.decode('utf-8-sig'))
    except Exception as exc:raise ValueError('This is not a readable UTF-8 calendar export.') from exc
    if cal.name!='VCALENDAR' or str(cal.get('VERSION'))!='2.0':raise ValueError('Use an iCalendar 2.0 export.')
    if str(cal.get('METHOD','PUBLISH')).upper()!='PUBLISH':raise ValueError('Use a calendar export, not a meeting invitation or cancellation message.')
    definitions=cal.walk('VEVENT')
    if len(definitions)>200:raise ValueError('This preview supports up to 200 event definitions. Export a smaller calendar.')
    for component in cal.walk():
        if component.errors:raise ValueError('The export contains invalid calendar properties. Correct it and export again.')
    floating=False
    for event in definitions:
        if 'DTSTART' not in event or not event.get('UID'):raise ValueError('Every event must have a start and a calendar identifier.')
        if isinstance(event.get('DTSTART'),list):raise ValueError('An event has more than one start time.')
        for name in ['DTSTART','DTEND','RECURRENCE-ID','RDATE','EXDATE']:
            values=event.get(name,[]);values=values if isinstance(values,list) else [values]
            for value in values:
                dates=[d.dt for d in value.dts] if hasattr(value,'dts') else [getattr(value,'dt',None)]
                for dt in dates:
                    if isinstance(dt,tuple):raise ValueError('Period-valued recurrence dates are not supported yet.')
                    if isinstance(dt,datetime) and dt.tzinfo is None:
                        if value.params.get('TZID'):raise ValueError('An event uses an unrecognized time zone. Export it with a defined time zone or UTC.')
                        floating=True
        rule=event.get('RRULE')
        if rule:
            if isinstance(rule,list):raise ValueError('Multiple recurrence rules on one event are not supported.')
            if str(rule.get('FREQ',[''])[0]) not in {'DAILY','WEEKLY','MONTHLY','YEARLY'}:
                raise ValueError('Only daily, weekly, monthly and yearly recurrence is supported.')
            if len(rule.get('BYHOUR',[]))>4 or len(rule.get('BYMINUTE',[]))>4 or any(int(s)!=0 for s in rule.get('BYSECOND',[])):
                raise ValueError('This recurrence is too dense for the local preview.')
        start=event.decoded('DTSTART')
        if 'DTEND' in event and 'DURATION' in event:raise ValueError('An event cannot contain both an end and a duration.')
        end=event.decoded('DTEND',None)
        if end is not None and (isinstance(start,datetime)!=isinstance(end,datetime)):
            raise ValueError('An event mixes all-day and timed dates.')
        if end is not None:
            try:
                if end<start or (not isinstance(start,datetime) and end==start):raise ValueError('An event has an invalid end date.')
            except TypeError as exc:raise ValueError('An event mixes floating and zoned times.') from exc
        if event.decoded('DURATION',timedelta(0))<timedelta(0):raise ValueError('Negative event durations are not supported.')
    start=datetime.combine(day,time.min,ZONE);stop=start+timedelta(days=30)
    # A floating timestamp belongs to the explicitly displayed Manila time zone.
    for event in definitions:
        rule=event.get('RRULE')
        if rule and 'UNTIL' in rule:
            rule['UNTIL']=[d.replace(tzinfo=ZONE).astimezone(timezone.utc) if isinstance(d,datetime) and d.tzinfo is None else d for d in rule['UNTIL']]
        for name in ['DTSTART','DTEND','RECURRENCE-ID','RDATE','EXDATE']:
            values=event.get(name,[]);values=values if isinstance(values,list) else [values]
            for value in values:
                for item in value.dts if hasattr(value,'dts') else [value]:
                    if isinstance(getattr(item,'dt',None),datetime) and item.dt.tzinfo is None:item.dt=item.dt.replace(tzinfo=ZONE)
    try:expanded=recurring_ical_events.of(cal).between(start,stop)
    except Exception as exc:raise ValueError('The recurrence or time zone in this export could not be expanded reliably.') from exc
    if len(expanded)>2000:raise ValueError('More than 2,000 occurrences fall in the 30-day preview. Export a smaller calendar.')
    result={}
    for event in expanded:
        if str(event.get('STATUS','')).upper()=='CANCELLED':continue
        a=event.decoded('DTSTART');b=event.decoded('DTEND',None)
        all_day=not isinstance(a,datetime)
        if b is None:b=a+event.decoded('DURATION',timedelta(days=1) if all_day else timedelta(0))
        if all_day:
            a=datetime.combine(a,time.min,ZONE);b=datetime.combine(b,time.min,ZONE)
        else:
            a=a.replace(tzinfo=ZONE) if a.tzinfo is None else a.astimezone(ZONE)
            b=b.replace(tzinfo=ZONE) if b.tzinfo is None else b.astimezone(ZONE)
        if b<a:raise ValueError('An expanded occurrence ends before it starts.')
        if a>=stop or b<start or (b==start and a<b):continue
        key=hashlib.sha256(f"{event.get('UID')}:{a.isoformat()}".encode()).hexdigest()[:32]
        result[key]={'id':key,'title':clean(event.get('SUMMARY')) or 'Untitled event',
                     'start':a.isoformat(),'end':b.isoformat(),'all_day':all_day,
                     'location':clean(event.get('LOCATION')),'tentative':str(event.get('STATUS','')).upper()=='TENTATIVE'}
    events=sorted(result.values(),key=lambda e:(e['start'],e['title'],e['id']))
    return {'events':events,'coverage_start':start.isoformat(),'coverage_end':stop.isoformat(),
            'timezone':'Asia/Manila','definitions':len(definitions),'floating':floating}


class CalendarStore:
    def __init__(self,data_dir):
        self.path=Path(data_dir)/'calendar.sqlite3';self.path.parent.mkdir(parents=True,exist_ok=True)
        self.lock=threading.RLock();self.parser_lock=threading.Lock();self.preview=None
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS calendar(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,payload TEXT)')
            db.execute('INSERT OR IGNORE INTO calendar VALUES(1,0,NULL)')

    @contextmanager
    def db(self):
        with self.lock:
            db=sqlite3.connect(self.path);db.execute('PRAGMA secure_delete=ON')
            try:
                with db:yield db
            finally:db.close()

    def snapshot(self):
        with self.db() as db:revision,payload=db.execute('SELECT revision,payload FROM calendar').fetchone()
        return {'revision':revision,'calendar':json.loads(payload) if payload else None}

    def prepare(self,raw,name):
        if len(raw)>MAX_BYTES or not raw:raise ValueError('Choose an .ics file up to 256 KB.')
        if not self.parser_lock.acquire(False):raise Conflict('A calendar preview is already being prepared.')
        try:
            try:
                worker=subprocess.run([sys.executable,str(Path(__file__).resolve()),local_now().date().isoformat()],input=raw,
                    capture_output=True,timeout=8,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            except subprocess.TimeoutExpired as exc:raise ValueError('This calendar took too long to parse. Export a smaller date range.') from exc
            try:parsed=json.loads(worker.stdout)
            except Exception as exc:raise ValueError('The calendar preview could not be read. The saved calendar is unchanged.') from exc
            if worker.returncode or 'error' in parsed:raise ValueError(parsed.get('error','The calendar could not be read.'))
            parsed.update(name=clean(str(name).replace('\\','/').split('/')[-1],100) or 'Calendar.ics',imported_at=local_now().isoformat())
            with self.lock:
                self.preview={'id':secrets.token_hex(16),'expires':clock.monotonic()+600,'payload':parsed,'revision':self.snapshot()['revision']}
                return {'id':self.preview['id'],'revision':self.preview['revision'],'calendar':parsed}
        finally:self.parser_lock.release()

    def commit(self,body):
        with self.db() as db:
            if not self.preview or body.get('id')!=self.preview['id'] or clock.monotonic()>self.preview['expires']:
                raise Conflict('This preview expired or was replaced. Preview the file again.')
            revision=db.execute('SELECT revision FROM calendar').fetchone()[0]
            if type(body.get('revision')) is not int or body['revision']!=revision or self.preview['revision']!=revision:
                raise Conflict('The saved calendar changed. Preview the file again.')
            db.execute('UPDATE calendar SET revision=revision+1,payload=?',(json.dumps(self.preview['payload']),))
            self.preview=None
        return self.snapshot()

    def forget(self,revision):
        with self.db() as db:
            current=db.execute('SELECT revision FROM calendar').fetchone()[0]
            if type(revision) is not int or revision!=current:raise Conflict('The calendar changed. Refresh before removing it.')
            db.execute('UPDATE calendar SET revision=revision+1,payload=NULL');self.preview=None

    def discard(self,preview_id):
        with self.lock:
            if self.preview and self.preview['id']==preview_id:self.preview=None


def briefing(calendar_snapshot,planner_snapshot,now=None):
    now=now or local_now();now=now.astimezone(ZONE)
    start=datetime.combine(now.date(),time.min,ZONE);end=start+timedelta(days=1)
    cal=calendar_snapshot['calendar'];covered=bool(cal and datetime.fromisoformat(cal['coverage_start'])<=start and end<=datetime.fromisoformat(cal['coverage_end']))
    stale=bool(cal and now-datetime.fromisoformat(cal['imported_at'])>timedelta(hours=24))
    events=[]
    if covered:
        for event in cal['events']:
            a=datetime.fromisoformat(event['start']);b=datetime.fromisoformat(event['end'])
            if a<end and (b>start or a==b and a>=start):
                status='All day' if event['all_day'] else 'Finished' if b<=now else 'Now' if a<=now else 'Upcoming'
                events.append({**event,'status':status})
    remaining=[e for e in events if e['status'] in {'Now','Upcoming'}]
    tasks=[t for t in planner_snapshot['tasks'] if not t['done']]
    high=sum(t['priority']==1 for t in tasks)
    if not cal:calendar_line='No calendar is imported yet.'
    elif not covered:calendar_line='Your calendar snapshot does not cover today. Please import a fresh export.'
    else:
        calendar_line=('Your calendar import is over a day old. ' if stale else 'From your imported calendar: ')+f"{len(events)} events today."
        if remaining:
            event=remaining[0];at=datetime.fromisoformat(event['start']).strftime('%I:%M %p').lstrip('0')
            calendar_line+=f" {'Happening now' if event['status']=='Now' else 'Next at '+at}: {clean(event['title'],65)}."
        elif events:calendar_line+=' No timed events remain in this snapshot today.'
    plan=planner_snapshot['plan']
    summary=f"{calendar_line} You have {len(tasks)} open tasks, including {high} high priority. Your focus plan uses {plan['used']} of {plan['available']} minutes. It has not been fitted around calendar events. Inbox is not connected."
    revision=hashlib.sha256(json.dumps([calendar_snapshot['revision'],planner_snapshot['revision'],str(now.date()),stale,covered,[(e['id'],e['status']) for e in events]]).encode()).hexdigest()[:32]
    return {'revision':revision,'generated_at':now.isoformat(),'date':now.date().isoformat(),'timezone':'Asia/Manila',
            'calendar_revision':calendar_snapshot['revision'],'source':{k:v for k,v in cal.items() if k!='events'} if cal else None,
            'covered':covered,'stale':stale,'events':events,'open_tasks':len(tasks),'high_priority':high,
            'top_tasks':tasks[:3],'plan':{'used':plan['used'],'available':plan['available'],'free':plan['free'],'deferred':len(plan['deferred'])},
            'summary':summary}


if __name__=='__main__':
    import offline  # The parser worker cannot follow URLs or make outbound connections.
    try:
        result=parse_calendar(sys.stdin.buffer.read(MAX_BYTES+1),date.fromisoformat(sys.argv[1]))
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({'error':str(exc) if isinstance(exc,ValueError) else 'The calendar contains unsupported or invalid data.'}));sys.exit(1)
