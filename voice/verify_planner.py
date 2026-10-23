"""Isolated planner persistence, validation, scheduling and conflict tests."""
from pathlib import Path
import random
import tempfile
from planner import Planner, make_plan, spoken_summary
from brain import Conflict

with tempfile.TemporaryDirectory(prefix='planner-test-',dir=Path(__file__).parent/'runtime') as tmp:
    planner=Planner(tmp)
    def change(action,**body):return planner.mutate(action,{'revision':planner.revision(),**body})
    a=change('save',title='Proposal',scope='business',minutes=35,priority=1)['tasks'][0]
    change('save',title='Long workshop',scope='business',minutes=70,priority=1)
    b=next(t for t in change('save',title='Review notes',scope='personal',minutes=15,priority=2)['tasks'] if t['title']=='Review notes')
    change('save',title='Clear desk',scope='personal',minutes=10,priority=3)
    snapshot=planner.snapshot();plan=snapshot['plan']
    assert [t['title'] for t in plan['steps']]==['Proposal','Review notes']
    assert (plan['used'],plan['free'],plan['breaks'])==(55,5,5)
    assert plan['steps'][1]['start']==40 and len(plan['deferred'])==2
    assert len(snapshot['summary'])<=600
    old=planner.revision();change('done',id=a['id'],done=True)
    try:planner.mutate('remove',{'id':a['id'],'revision':old});raise AssertionError('Stale write accepted')
    except Conflict:pass
    assert len(planner.snapshot()['tasks'])==4
    change('done',id=a['id'],done=False)
    change('save',id=b['id'],title='Review notes corrected',scope='business',minutes=20,priority=2)
    assert planner.snapshot()['plan']['used']==60
    for field,value in [('minutes',0),('minutes',True),('priority',4),('scope','unknown')]:
        before=planner.revision();body={'title':'Invalid','scope':'personal','minutes':5,'priority':2,field:value}
        try:change('save',**body);raise AssertionError('Invalid write accepted')
        except ValueError:pass
        assert planner.revision()==before
    change('plan',minutes=5,pause=0,scope='personal')
    assert not planner.snapshot()['plan']['steps']
    restored=Planner(tmp).snapshot()
    assert restored==planner.snapshot() and restored['preferences']['minutes']==5
    change('remove',id=a['id']);assert a['id'] not in [t['id'] for t in planner.snapshot()['tasks']]
    for task in planner.snapshot()['tasks']:change('remove',id=task['id'])
    assert not planner.snapshot()['plan']['steps'] and not planner.snapshot()['plan']['deferred']

rng=random.Random(42)
for run in range(250):
    tasks=[{'id':str(i),'title':'A'*80,'scope':rng.choice(['personal','business']),'minutes':rng.randint(1,480),'priority':rng.randint(1,3),'created_at':str(i).zfill(4),'done':rng.choice([True,False])} for i in range(200)]
    budget=rng.randint(5,480);pause=rng.randint(0,30);scope=rng.choice(['all','personal','business'])
    plan=make_plan(tasks,budget,pause,scope)
    assert 0<=plan['used']<=budget and plan['free']+plan['used']==budget
    assert plan['work']+plan['breaks']==plan['used']
    assert len(spoken_summary(plan))<=600
    assert all(not s['done'] and (scope=='all' or s['scope']==scope) for s in plan['steps'])
    assert [s['priority'] for s in plan['steps']]==sorted(s['priority'] for s in plan['steps'])
    assert len({t['id'] for t in plan['steps']+plan['deferred']})==len(plan['steps'])+len(plan['deferred'])
print('PASS: exact budget/break accounting, priority, deferred tasks, scopes, done/reopen, corrections, invalid and stale writes, persistence, removal; 250 bounded random plans.')
