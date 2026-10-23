"""Isolated graph checks; never writes the user's notes or memory database."""
from pathlib import Path
import tempfile
from brain import Brain

with tempfile.TemporaryDirectory(prefix='lin-map-',dir=Path(__file__).parent/'runtime') as tmp:
    root=Path(tmp);folder=root/'notes';folder.mkdir()
    note=folder/'Plan.md';note.write_text('\n'.join(f'Line {i}' for i in range(28)),encoding='utf-8')
    (folder/'Empty.txt').write_text('',encoding='utf-8')
    brain=Brain(root/'data',folder)
    memory=brain.save({'title':'Preference','fact':'Short briefings.','scope':'personal'})
    graph=brain.graph();assert len(graph['nodes'])==2
    file=next(n for n in graph['nodes'] if n['kind']=='file')
    assert len(file['passages'])==3
    assert [p['start'] for p in file['passages']]==[1,13,25]
    assert all(e['relation']=='contains' for e in graph['edges'])
    assert brain.source(file['passages'][0]['id'])['body'].startswith('Line 0')
    note.write_text('Corrected note.',encoding='utf-8');brain.scan()
    updated=next(n for n in brain.graph()['nodes'] if n['kind']=='file')
    assert updated['id']==file['id'] and updated['passages']!=file['passages']
    assert brain.source(file['passages'][0]['id']) is None
    memory=brain.save({**memory,'fact':'Detailed briefings.','scope':'business'})
    graph=brain.graph();assert next(n for n in graph['nodes'] if n['id']==memory['id'])['group']=='business'
    assert {'from':'group-business','to':memory['id'],'relation':'contains'} in graph['edges']
    brain.connect(False);assert len(brain.graph()['nodes'])==1
    brain.connect(True);assert len(brain.graph()['nodes'])==2
    brain.forget(memory['id'],memory['revision']);note.unlink();brain.scan()
    assert brain.graph()['nodes']==[] and brain.graph()['edges']==[]
print('PASS: exact passages, stable file identity, corrections, scope edges, disconnect/reconnect, forget/delete, empty files.')
