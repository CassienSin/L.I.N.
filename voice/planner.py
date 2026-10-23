"""Explicit local tasks and deterministic, capacity-bounded focus plans."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import secrets
import sqlite3
import threading
from brain import Conflict, plain


def integer(value, low, high, name):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{name} must be a whole number from {low} to {high}.')
    return value


def make_plan(tasks, minutes, pause, scope):
    candidates=sorted((t for t in tasks if not t['done'] and (scope=='all' or t['scope']==scope)),
                      key=lambda t:(t['priority'],t['created_at'],t['id']))
    steps=[]; deferred=[]; used=0
    for task in candidates:
        gap=pause if steps else 0
        if used+gap+task['minutes'] <= minutes:
            start=used+gap;used=start+task['minutes']
            steps.append({**task,'start':start,'end':used,'break_before':gap})
        else:
            deferred.append({**task,'reason':f"Needs {task['minutes']} minutes"+
                             (f' plus a {gap}-minute break.' if gap else '.')})
    return {'steps':steps,'deferred':deferred,'used':used,'available':minutes,
            'free':minutes-used,'work':sum(t['minutes'] for t in steps),
            'breaks':max(0,len(steps)-1)*pause,'scope':scope}


def spoken_summary(plan):
    if not plan['steps']:
        return ('No tasks fit this time window. Try more time or a smaller task.' if plan['deferred']
                else 'There are no open tasks in this view. Add a task when you are ready.')
    parts=[f"Your plan uses {plan['used']} of {plan['available']} minutes, including {plan['breaks']} minutes of breaks."]
    for index,step in enumerate(plan['steps'][:3]):
        title=' '.join(step['title'].split())
        parts.append(f"{'Start with' if index==0 else 'Then'} {title}, for {step['minutes']} minutes.")
    if len(plan['steps'])>3:
        parts.append(f"There are {len(plan['steps'])-3} more tasks on the plan card.")
    parts.append(f"{plan['free']} minutes remain free.")
    if plan['deferred']:
        parts.append(f"{len(plan['deferred'])} tasks did not fit.")
    return ' '.join(parts)


class Planner:
    def __init__(self, data_dir):
        Path(data_dir).mkdir(parents=True,exist_ok=True)
        self.path=Path(data_dir)/'planner.sqlite3';self.lock=threading.RLock()
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,
                  scope TEXT NOT NULL,minutes INTEGER NOT NULL,priority INTEGER NOT NULL,
                  done INTEGER NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS preferences(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                  minutes INTEGER NOT NULL,pause INTEGER NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL);
                INSERT OR IGNORE INTO preferences VALUES(1,60,5,'all',0);
            ''')

    @contextmanager
    def db(self):
        with self.lock:
            db=sqlite3.connect(self.path);db.row_factory=sqlite3.Row
            db.execute('PRAGMA secure_delete=ON')
            try:
                with db: yield db
            finally: db.close()

    def revision(self):
        with self.db() as db:
            return db.execute('SELECT revision FROM preferences').fetchone()[0]

    def snapshot(self):
        with self.db() as db:
            prefs=dict(db.execute('SELECT minutes,pause,scope,revision FROM preferences').fetchone())
            tasks=[dict(t) for t in db.execute('SELECT * FROM tasks ORDER BY done,priority,created_at,id')]
            for task in tasks: task['done']=bool(task['done'])
            plan=make_plan(tasks,prefs['minutes'],prefs['pause'],prefs['scope'])
            return {'tasks':tasks,'preferences':prefs,'revision':prefs['revision'],'plan':plan,'summary':spoken_summary(plan)}

    def mutate(self, action, body):
        with self.db() as db:
            if type(body.get('revision')) is not int or body['revision']!=self.revision():
                raise Conflict('The task list changed. Refresh and review before saving again.')
            if action=='plan':
                minutes=integer(body.get('minutes'),5,480,'Available time')
                pause=integer(body.get('pause'),0,30,'Break length')
                scope=body.get('scope')
                if scope not in {'all','personal','business'}:raise ValueError('Choose a valid scope.')
                db.execute('UPDATE preferences SET minutes=?,pause=?,scope=?',(minutes,pause,scope))
            elif action=='save':
                title=' '.join(plain(body.get('title'),80,'Task title').split())
                scope=body.get('scope')
                if scope not in {'personal','business'}:raise ValueError('Choose personal or business.')
                minutes=integer(body.get('minutes'),1,480,'Task estimate')
                priority=integer(body.get('priority'),1,3,'Priority')
                tid=body.get('id')
                if tid is not None:
                    if not isinstance(tid,str) or not db.execute('SELECT id FROM tasks WHERE id=?',(tid,)).fetchone():
                        raise Conflict('This task was removed. Refresh the list.')
                    db.execute('UPDATE tasks SET title=?,scope=?,minutes=?,priority=?,revision=revision+1 WHERE id=?',(title,scope,minutes,priority,tid))
                else:
                    if db.execute('SELECT count(*) FROM tasks').fetchone()[0]>=200:
                        raise ValueError('This prototype supports 200 tasks. Remove an old task before adding another.')
                    db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,0,1,?)',(secrets.token_hex(16),title,scope,minutes,priority,datetime.now(timezone.utc).isoformat()))
            elif action in {'done','remove'}:
                tid=body.get('id')
                if not isinstance(tid,str) or not db.execute('SELECT id FROM tasks WHERE id=?',(tid,)).fetchone():
                    raise Conflict('This task was removed. Refresh the list.')
                if action=='remove':db.execute('DELETE FROM tasks WHERE id=?',(tid,))
                else:
                    if type(body.get('done')) is not bool:raise ValueError('Choose done or open.')
                    db.execute('UPDATE tasks SET done=?,revision=revision+1 WHERE id=?',(int(body['done']),tid))
            else:raise ValueError('Unknown planner action.')
            db.execute('UPDATE preferences SET revision=revision+1')
        return self.snapshot()
