"""What Lin's voice actually reads. The caption keeps the original text; the voice gets a spoken version:
list markers, numbers, times, money, percentages, units, symbols, acronyms, links and Markdown turned into words,
plus your own pronunciations (Settings, Talking hands-free: "How Lin says words").
Deterministic and offline; checked by verify_voice.py."""
import json
import re
from pathlib import Path

ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
ORDINAL = {'one': 'first', 'two': 'second', 'three': 'third', 'five': 'fifth', 'eight': 'eighth', 'nine': 'ninth', 'twelve': 'twelfth'}
LIST_WORDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth']
# Acronyms said as a word, not letter by letter.
WORDS = {'NASA', 'PIN', 'RAM', 'ROM', 'GIF', 'JPEG', 'PNG', 'JSON', 'SIM', 'LAN', 'WAN', 'NATO', 'COVID', 'LASER', 'RADAR',
         'SCUBA', 'ASAP', 'FAQ', 'OK', 'IKEA', 'UNESCO', 'UNICEF', 'CAPTCHA', 'WIFI', 'LIN', 'PDF'}
UNITS = {'ms': ('millisecond', 'milliseconds'), 's': ('second', 'seconds'), 'sec': ('second', 'seconds'),
         'min': ('minute', 'minutes'), 'mins': ('minute', 'minutes'), 'h': ('hour', 'hours'), 'hr': ('hour', 'hours'),
         'hrs': ('hour', 'hours'), 'km': ('kilometre', 'kilometres'), 'kg': ('kilogram', 'kilograms'),
         'cm': ('centimetre', 'centimetres'), 'mm': ('millimetre', 'millimetres'), 'm': ('metre', 'metres'),
         'GB': ('gigabyte', 'gigabytes'), 'MB': ('megabyte', 'megabytes'), 'KB': ('kilobyte', 'kilobytes'),
         'TB': ('terabyte', 'terabytes'), 'GHz': ('gigahertz', 'gigahertz'), 'MHz': ('megahertz', 'megahertz'),
         'fps': ('frame per second', 'frames per second'), 'kph': ('kilometre per hour', 'kilometres per hour'),
         'km/h': ('kilometre per hour', 'kilometres per hour'), '°C': ('degree Celsius', 'degrees Celsius'),
         '°F': ('degree Fahrenheit', 'degrees Fahrenheit')}
CURRENCY = {'$': ('dollar', 'dollars', 'cent', 'cents'), '₱': ('peso', 'pesos', 'centavo', 'centavos'),
            'PHP': ('peso', 'pesos', 'centavo', 'centavos'), '€': ('euro', 'euros', 'cent', 'cents'),
            '£': ('pound', 'pounds', 'penny', 'pence'), '¥': ('yen', 'yen', '', '')}
NUM = r'\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?'
PHRASES = [(r'\be\.g\.,?', 'for example'), (r'\bi\.e\.,?', 'that is'), (r'\betc\.', 'and so on'), (r'\bvs\.?(?=\s)', 'versus'),
           (r'\bapprox\.', 'about'), (r'\bw/o\b', 'without'), (r'\bw/(?=\s)', 'with'), (r'\band/or\b', 'and or')]


def words(n):
    """0 to 999,999,999,999 as English words."""
    n = int(n)
    if n < 0:
        return 'minus ' + words(-n)
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ('-' + ONES[n % 10] if n % 10 else '')
    if n < 1000:
        return ONES[n // 100] + ' hundred' + (' and ' + words(n % 100) if n % 100 else '')
    for size, name in ((10 ** 9, 'billion'), (10 ** 6, 'million'), (1000, 'thousand')):
        if n >= size:
            head, rest = divmod(n, size)
            tail = '' if not rest else (' and ' if rest < 100 else ' ') + words(rest)
            return words(head) + ' ' + name + tail
    return str(n)


def ordinal(n):
    w = words(n)
    last = re.split(r'([ -])', w)
    end = last[-1]
    if end in ORDINAL:
        end = ORDINAL[end]
    elif end.endswith('y'):
        end = end[:-1] + 'ieth'
    else:
        end += 'th'
    return ''.join(last[:-1]) + end


def year(n):
    n = int(n)
    if 2000 <= n <= 2009:
        return words(n)
    head, tail = divmod(n, 100)
    return words(head) + ' ' + ('hundred' if tail == 0 else ('oh ' + words(tail) if tail < 10 else words(tail)))


def number(text):
    """'1,250' / '3.75' / '0.5' as words."""
    text = text.replace(',', '')
    if '.' in text:
        whole, frac = text.split('.', 1)
        return words(whole or 0) + ' point ' + ' '.join(ONES[int(d)] for d in frac)
    return words(text)


def _money(m):
    sym, amount = m['sym'] or m['code'], m['amount'].replace(',', '')
    one, many, small1, smalln = CURRENCY[sym]
    whole, _, cents = amount.partition('.')
    out = f"{words(whole)} {one if int(whole) == 1 else many}"
    if cents and int(cents.ljust(2, '0')[:2]) and small1:
        c = int(cents.ljust(2, '0')[:2])
        out += f" and {words(c)} {small1 if c == 1 else smalln}"
    return out + ({'k': ' thousand', 'K': ' thousand', 'M': ' million', 'B': ' billion'}.get(m['scale'] or '', '') if not cents else '')


def _time(m):
    h, mins, ampm = int(m['h']), int(m['m']), (m['ampm'] or '').replace('.', '').upper()
    if h > 23 or mins > 59:
        return m[0]
    if not ampm and (h > 12 or h == 0):
        ampm, h = ('PM', h - 12) if h > 12 else ('AM', 12)   # 16:00 is said "four P M"
    spoken = words(h) + (" o'clock" if mins == 0 and not ampm else '' if mins == 0 else
                         ' oh ' + ONES[mins] if mins < 10 else ' ' + words(mins))
    return spoken + (' A M' if ampm == 'AM' else ' P M' if ampm == 'PM' else '')


def _unit(m):
    value, unit = m['num'], m['unit']
    one, many = UNITS[unit]
    plain = value.replace(',', '')
    return number(value) + ' ' + (one if plain in ('1', '1.0') else many)


def _acronym(m):
    word = m[0]
    if word.upper() in WORDS or len(word) > 5:
        return word
    plural = word.endswith('s') and word[:-1].isupper()
    letters = word[:-1] if plural else word
    return ' '.join(letters) + ("'s" if plural else '')


def load_pronunciations(path):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return {str(k): str(v) for k, v in (data.get('words') or {}).items() if str(k).strip() and str(v).strip()}


def for_voice(text, pronunciations=None):
    """The spoken form of one sentence (or a few)."""
    t = ' '.join(str(text or '').split())
    # Markdown, links, emoji.
    t = re.sub(r'\[([^\]]+)\]\((?:[^)]*)\)', r'\1', t)
    t = re.sub(r'(\*\*|__|`+|~~)', '', t)
    t = re.sub(r'(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)', '', t)
    t = re.sub(r'^\s*(?:#+|>)\s*', '', t)
    t = re.sub(r'https?://(?:www\.)?([\w-]+(?:\.[\w-]+)+)(?:[/?#]\S*?)?(?=[.,;:!?)]*(?:\s|$))', lambda m: 'a link to ' + m[1].replace('.', ' dot '), t)
    t = re.sub(r'\b[\w.+-]+@([\w-]+\.)+\w+\b', 'an email address', t)
    t = re.sub(r'[\U0001F000-\U0001FAFF☀-➿️‍]', '', t)
    # Your own words first, so they are not spelled out or changed below.
    for word, say in sorted((pronunciations or {}).items(), key=lambda kv: -len(kv[0])):
        t = re.sub(r'(?<!\w)' + re.escape(word) + r'(?!\w)', say, t, flags=re.I)
    # A list marker at the start becomes "First,", "Second," ...
    m = re.match(r'^\s*(\d{1,2})[.)]\s+(?=\S)', t)
    if m and 1 <= int(m[1]) <= 10:
        t = LIST_WORDS[int(m[1]) - 1] + ', ' + t[m.end():]
    t = re.sub(r'^\s*[-•–*]\s+', '', t)
    t = re.sub(r'(?<=[.:;])\s+(\d{1,2})[.)]\s+(?=[A-Z])', lambda m: ' ' + LIST_WORDS[min(int(m[1]), 10) - 1] + ', ', t)
    for pattern, say in PHRASES:
        t = re.sub(pattern, say, t, flags=re.I)
    # Times, money, percentages, units, ordinals, ranges, years, plain numbers.
    # "a.m." / "am" / "AM"; a final dot that also ended the sentence is kept.
    ampm = r'(?P<ampm>[AaPp](?:\.[Mm]\.|[Mm]))'
    keep = lambda m, said: said + ('.' if m[0].endswith('.') and (m.end() == len(m.string) or m.string[m.end()].isspace()) else '')
    t = re.sub(r'\b(?P<h>\d{1,2}):(?P<m>\d{2})(?:\s*' + ampm + r')?(?!\w)', lambda m: keep(m, _time(m)), t)
    t = re.sub(r'\b(?P<h>\d{1,2})\s*' + ampm + r'(?!\w)', lambda m: keep(m, words(int(m['h'])) + (' A M' if m['ampm'][0] in 'Aa' else ' P M')), t)
    t = re.sub(r'(?:(?P<sym>[$₱€£¥])|\b(?P<code>PHP)\s?)(?P<amount>' + NUM + r')(?P<scale>[kKMB]\b)?', _money, t)
    months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    t = re.sub(r'\b(\d{4})-(\d{2})-(\d{2})\b', lambda m: f"{months[int(m[2]) - 1]} {ordinal(int(m[3]))}, {year(m[1])}" if 1 <= int(m[2]) <= 12 and 1 <= int(m[3]) <= 31 else m[0], t)
    t = re.sub(r'(' + NUM + r')\s?%', lambda m: number(m[1]) + ' percent', t)
    units = '|'.join(sorted((re.escape(u) for u in UNITS), key=len, reverse=True))
    def _range(m):
        unit = m['unit']
        return number(m['a']) + ' to ' + number(m['b']) + (' ' + UNITS[unit][1] if unit else '')
    # 5–8, 2.1–2.7 s (a hyphen only between short numbers, so dates like 2026-10-24 are left alone)
    t = re.sub(r'(?<![\w.-])(?P<a>' + NUM + r')\s?(?:[–—]|-(?=\d{1,4}(?!-)))\s?(?P<b>' + NUM + r')(?:\s?(?P<unit>' + units + r'))?(?![\w/-])', _range, t)
    t = re.sub(r'(?P<num>' + NUM + r')\s?(?P<unit>' + units + r')(?![\w/])', _unit, t)
    t = re.sub(r'\b(\d+)(?:st|nd|rd|th)\b', lambda m: ordinal(int(m[1])), t)
    t = re.sub(r'\b(1[5-9]\d\d|20\d\d)\b(?![.,]\d)', lambda m: year(m[1]), t)
    t = re.sub(r'(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.])\d+(?:\.\d+)?(?![\w])', lambda m: number(m[0]), t)
    # Symbols.
    t = re.sub(r'\s*(?:→|->|=>)\s*', ' to ', t)
    t = re.sub(r'\s*&\s*', ' and ', t)
    t = re.sub(r'(?<=\s)\+(?=\s)', 'plus', t)
    t = re.sub(r'(?<=\s)=(?=\s)', 'equals', t)
    t = re.sub(r'\b([A-Z]{2,5})/([A-Z]{2,5})\b', r'\1 \2', t)
    t = re.sub(r'(?<=[A-Za-z])/(?=[A-Za-z])', ' or ', t)
    t = re.sub(r'[#*_<>{}\[\]|^~\\]', ' ', t)
    # Acronyms letter by letter (IP, CPU, URLs's), unless said as a word.
    t = re.sub(r'\b[A-Z]{2,5}s?\b', _acronym, t)
    t = re.sub(r'\s+([,.;:!?])', r'\1', t)
    return ' '.join(t.split()).strip()
