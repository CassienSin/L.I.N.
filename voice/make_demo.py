"""Builds Lin's demo data: an invented fourth-year IT student's semester.

Everything here is made up and safe to show on screen. It lives in voice/demo/ only and is
never mixed with real notes, memories, tasks or calendars. A fixed seed makes the map the
same every time; calendar dates are placed relative to today so the day ribbon stays current.

    python make_demo.py           create the demo data if it is missing
    python make_demo.py --reset   delete and rebuild it
"""
from datetime import date, datetime, timedelta
from pathlib import Path
import json
import random
import shutil
import sys

HERE = Path(__file__).resolve().parent
DEMO = HERE / 'demo'
VERSION = '1'

NOTES = {
    'Capstone/SmartQueue overview.md': """# SmartQueue overview
SmartQueue is our capstone: a patient queueing system for [[Barangay Mabini Health Center]].
Team: [[Mika Santos]] (frontend), [[Jerome Dela Cruz]] (backend), [[Ria Villanueva]] (documentation).
Adviser: [[Engr. Carlo Mendoza]].
Stack: Laravel API, Flutter app, MySQL, SMS gateway.
See [[Chapter 4 results]] and [[Defense prep]].""",
    'Capstone/Defense prep.md': """# Defense prep
Final defense: 9:00 AM, Room 304. Panel: [[Dr. Lea Fernandez]] and [[Engr. Carlo Mendoza]].
- Slides: 15 minutes, live demo 10 minutes
- Rehearse the [[SMS notification demo]] with [[Jerome Dela Cruz]]
- Bring three printed copies of [[Chapter 4 results]]
- Prepare an answer to the load testing question in [[Panel feedback]]""",
    'Capstone/Panel feedback.md': """# Panel feedback
From the pre-defense, [[Dr. Lea Fernandez]] asked for load testing beyond 50 patients
and clearer handling of patient privacy. Add a consent screen before registration.
Revise [[Chapter 3 methodology]] with a data privacy section.""",
    'Capstone/Chapter 4 results.md': """# Chapter 4 results
Usability test with 30 respondents at [[Barangay Mabini Health Center]]: SUS score 82.5.
Average waiting time dropped from 47 to 18 minutes.
Load test: 120 simulated patients, median response 240 ms.""",
    'Capstone/Chapter 3 methodology.md': """# Chapter 3 methodology
Agile with two-week sprints. Respondents chosen by purposive sampling.
Revision requested in [[Panel feedback]]: add the data privacy section.""",
    'Capstone/SMS notification demo.md': """# SMS notification demo
Use the test SIM. Queue number 12 should receive the "you are next" message.
[[Jerome Dela Cruz]] owns the SMS gateway. Practise before the [[Defense prep]] run-through.""",
    'Capstone/Team meeting 19 October.md': """# Team meeting 19 October
Present: [[Mika Santos]], [[Jerome Dela Cruz]], [[Ria Villanueva]].
- Mika fixes the admin dashboard filters
- Ria finalises the user manual
- I update the defense slides and the consent screen""",
    'Classes/Systems Administration.md': """# Systems Administration
Instructor: [[Prof. Ramon Uy]].
Final exam covers Linux permissions, cron jobs and Active Directory basics.
Lab 6 is due Friday: set up an Nginx reverse proxy.""",
    'Classes/Mobile Development.md': """# Mobile Development
IT Elective 4 final project: a Flutter to-do app with local storage.
Reuse the queue card widgets from [[SmartQueue overview]].""",
    'Classes/Technopreneurship.md': """# Technopreneurship
Business model canvas for SmartQueue as a startup idea.
Pitch practice with [[Mika Santos]]. Final pitch is the week after the defense.""",
    'Classes/Professional Ethics.md': """# Professional Ethics
Essay: the Data Privacy Act of 2012 and how SmartQueue handles patient data. 1,500 words.
Use the consent screen from [[Panel feedback]] as an example.""",
    'People/Mika Santos.md': """# Mika Santos
Groupmate. Frontend and interface design for SmartQueue. Prefers Messenger. Very good with Figma.""",
    'People/Jerome Dela Cruz.md': """# Jerome Dela Cruz
Groupmate. Backend and the SMS gateway. Usually free after 4 PM.""",
    'People/Ria Villanueva.md': """# Ria Villanueva
Groupmate. Documentation, user manual and the defense handouts.""",
    'People/Engr. Carlo Mendoza.md': """# Engr. Carlo Mendoza
Capstone adviser. Consultation on Tuesdays and Thursdays, 1 to 3 PM, faculty room. Prefers email.""",
    'People/Dr. Lea Fernandez.md': """# Dr. Lea Fernandez
Panel chair. Focuses on testing evidence and data privacy.""",
    'Personal/October budget.md': """# October budget
Allowance ₱6,000. Transport ₱1,200, food ₱3,000, printing for the defense ₱500, savings ₱800.""",
    'Personal/Gym routine.md': """# Gym routine
Upper body on Mondays and Thursdays, legs on Tuesdays and Saturdays. 45 minutes each.""",
    'Personal/After graduation.md': """# After graduation
Apply as a junior web developer. Build a portfolio from SmartQueue and the Mobile Development project.
Keep a list of companies in [[Job search]].""",
    'Ideas/Job search.md': """# Job search
Shortlist: three Cebu software companies hiring junior developers. Update the resume after the defense.""",
}

MEMORIES = [
    ('Defense outfit', 'Wear the barong and bring the school ID lace for the defense.'),
    ('Adviser contact', 'Engr. Mendoza prefers email for consultation requests.'),
    ('Study style', 'I focus best in 45-minute blocks with music off.'),
    ('Mika birthday', 'Mika Santos has a birthday on 5 November.'),
    ('Printing shop', 'Print Hub near school opens at 7 AM and prints a page for ₱3.'),
    ('Coffee', 'I like my coffee iced with no sugar.'),
]

TASKS = [
    ('Finish defense slides', 'business', 90, 1),
    ('Rehearse SMS notification demo with Jerome', 'business', 30, 1),
    ('Add consent screen from panel feedback', 'business', 60, 1),
    ('Print Chapter 4 results copies', 'business', 20, 2),
    ('Email Engr. Mendoza about consultation', 'business', 10, 2),
    ('Lab 6 Nginx reverse proxy', 'business', 60, 2),
    ('Professional Ethics essay outline', 'business', 45, 2),
    ('Technopreneurship pitch practice with Mika', 'business', 30, 3),
    ('Upper body gym session', 'personal', 45, 3),
    ('Buy printer ink', 'personal', 10, 3),
]

PROFILE = {
    'name': 'Sam',
    'about': 'Invented demo profile: a fourth-year IT student finishing a capstone project called SmartQueue.',
    'tone': 'Talk to me like a friend who is also my assistant: warm, casual and honest, and keep it short.',
}


def events(today):
    d = [today + timedelta(days=i) for i in range(7)]
    rows = [
        (d[0], '0800', '0930', 'Systems Administration class', 'Room 210'),
        (d[0], '1300', '1400', 'Consultation with Engr. Mendoza', 'Faculty room'),
        (d[0], '1600', '1700', 'Team rehearsal: SMS notification demo', 'Library discussion room'),
        (d[1], '1000', '1200', 'Mobile Development lab', 'Computer lab 2'),
        (d[1], '1800', '1845', 'Upper body gym session', ''),
        (d[2], '0900', '1000', 'Technopreneurship pitch practice', 'Room 112'),
        (d[3], None, None, 'Lab 6 due: Nginx reverse proxy', ''),
        (d[5], '0900', '1100', 'Capstone final defense', 'Room 304'),
    ]
    out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lin demo//EN', 'METHOD:PUBLISH']
    for i, (day, a, b, title, place) in enumerate(rows):
        out += ['BEGIN:VEVENT', f'UID:lin-demo-{i}@demo.local']
        if a:
            out += [f'DTSTART;TZID=Asia/Manila:{day:%Y%m%d}T{a}00', f'DTEND;TZID=Asia/Manila:{day:%Y%m%d}T{b}00']
        else:
            out += [f'DTSTART;VALUE=DATE:{day:%Y%m%d}', f'DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}']
        out += [f'SUMMARY:{title}'] + ([f'LOCATION:{place}'] if place else []) + ['END:VEVENT']
    out.append('END:VCALENDAR')
    return ('\r\n'.join(out) + '\r\n').encode()


def study_logs():
    """A few extra notes, generated from a fixed seed so the map is identical every run."""
    rng = random.Random(2026)
    topics = ['Chapter 4 results', 'Panel feedback', 'SMS notification demo', 'Systems Administration', 'Mobile Development', 'Professional Ethics']
    people = ['Mika Santos', 'Jerome Dela Cruz', 'Ria Villanueva']
    notes = {}
    for i in range(8):
        day = date(2026, 10, 6) + timedelta(days=i * 2)
        picked = rng.sample(topics, 2)
        person = rng.choice(people)
        minutes = rng.choice([45, 60, 90])
        notes[f'Journal/Study log {day:%d %B}.md'] = (f"# Study log {day:%d %B}\n"
            f"Worked {minutes} minutes on [[{picked[0]}]], then reviewed [[{picked[1]}]].\n"
            f"Checked in with [[{person}]] about the capstone.")
    return notes


def ensure(reset=False, today=None):
    """Create the demo folder if needed and keep its calendar covering today."""
    from brain import Brain
    from calendar_store import CalendarStore, local_now
    from planner import Planner
    if reset and DEMO.exists():
        shutil.rmtree(DEMO)
    notes_dir, data_dir = DEMO / 'Lin Brain', DEMO / 'data'
    marker = DEMO / '.demo-version'
    fresh = not marker.exists() or marker.read_text(encoding='utf-8').strip() != VERSION
    if fresh:
        if DEMO.exists():
            shutil.rmtree(DEMO)
        notes_dir.mkdir(parents=True)
        data_dir.mkdir(parents=True)
        for rel, text in {**NOTES, **study_logs()}.items():
            path = notes_dir / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text + '\n', encoding='utf-8')
        brain = Brain(data_dir, notes_dir)
        for title, fact in MEMORIES:
            brain.save({'title': title, 'fact': fact, 'scope': 'personal'})
        planner = Planner(data_dir)
        for title, scope, minutes, priority in TASKS:
            planner.mutate('save', {'revision': planner.revision(), 'title': title, 'scope': scope, 'minutes': minutes, 'priority': priority})
        planner.mutate('plan', {'revision': planner.revision(), 'minutes': 180, 'pause': 10, 'scope': 'all'})
        (data_dir / 'profile.json').write_text(json.dumps({**PROFILE, 'revision': 1, 'demo': True}, indent=2), encoding='utf-8')
        marker.write_text(VERSION, encoding='utf-8')
    today = today or local_now().date()
    calendar = CalendarStore(data_dir)
    snapshot = calendar.snapshot()
    cal = snapshot['calendar']
    if not cal or cal.get('coverage_start', '')[:10] != today.isoformat():
        preview = calendar.prepare(events(today), 'demo-calendar.ics')
        calendar.commit({'id': preview['id'], 'revision': preview['revision']})
    return {'notes': notes_dir, 'data': data_dir, 'created': fresh}


if __name__ == '__main__':
    result = ensure(reset='--reset' in sys.argv)
    print(json.dumps({k: str(v) for k, v in result.items()}))
