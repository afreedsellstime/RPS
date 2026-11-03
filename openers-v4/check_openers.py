"""Checks every v4 text against the team's texting rules and SMS length limits."""
import json, re, sys
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'openers_v4.json'))
FOOT = d['footer_added_by_ghl']
GSM7 = set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
BANNED = [r'\boffer', r'\bcash\b', r'\bbuy', r'\bas is\b', r'\bhomeowner', r'http', r'www\.', r'\.com\b', r'\$', '!', r'\bKW\b', 'Keller', 'Rayle', 'Property Solutions', r'\bHey\b', '—', '–', ' - ', '`', '‘', '’', '“', '”', r'(?<![A-Za-z])i(?![A-Za-z])', r'real estate solutions', r'foreclos', r'default', r'divorc', r'bankrupt', r'passed away', r'death']
# worst case first names / streets seen in the lists
FIRST = ['Al', 'Christopher', 'Maximiliano']
STREET = ['9858 Via Caceres', '14955 Avenida Venusto #31', '12834 Rockwell Ct', '1234 Rancho Santa Fe Farms Rd Space 12']
items = [(k, v['text']) for k, v in d['openers'].items()] + [('follow_up', d['follow_up']['text'])]
ok = True
for name, t in items:
    probs = [p for p in BANNED if re.search(p, t, flags=0 if p.startswith('(?<!') else re.I)]
    if not t.startswith('Hi '): probs.append('must start with Hi')
    if re.match(r'Hi,|Hi \{first\},', t): probs.append('comma after greeting/name')
    worst = 0
    for f in FIRST:
        for s in STREET:
            full = t.replace('{first}', f).replace('{street}', s) + FOOT
            if set(full) - GSM7: probs.append('non GSM-7 chars: ' + repr(set(full) - GSM7))
            worst = max(worst, len(full))
    typical = len(t.replace('{first}', 'Maria').replace('{street}', '12834 Rockwell Ct') + FOOT)
    segs = lambda n: 1 if n <= 160 else -(-n // 153)
    ok &= not probs
    print(f"{'PASS' if not probs else 'FAIL'}  {name:10} typical {typical:3} chars ({segs(typical)} text)  worst {worst:3} ({segs(worst)} texts)  {'; '.join(probs)}")
sys.exit(0 if ok else 1)
