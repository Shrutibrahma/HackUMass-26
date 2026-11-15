import json, os, sys, random, re
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import HfApi, hf_hub_download
sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\server')
from app.signs.models import gloss_of
CAND = 'HELLO BYE YES NO PLEASE THANKYOU SORRY HELP WANT NEED HAVE LIKE LOVE GOOD BAD FINE HAPPY SAD TIRED SICK HUNGRY EAT DRINK WATER HOME WORK SCHOOL GO COME WAIT STOP FINISH AGAIN MORE UNDERSTAND KNOW DONTKNOW NAME WHAT WHERE WHEN WHO WHY HOW TODAY TOMORROW YESTERDAY NOW LATER MORNING NIGHT TIME FRIEND FAMILY MOTHER FATHER CALL PHONE MAYBE OK READY BUSY SLOW FAST HOT COLD BATHROOM MONEY PAY CAR FOOD SLEEP FEEL NOTUNDERSTAND SEE MEET'.split()
want = {gloss_of(c) for c in CAND}
fs = HfApi().list_repo_files('SorensenAI/asl-citizen-poses', repo_type='dataset')
by = {}
for f in fs:
    if not f.endswith('.pose'): continue
    g = gloss_of(os.path.basename(f).rsplit('-', 1)[-1][:-5])
    if g in want: by.setdefault(g, []).append(f)
random.seed(1)
pick = []
for g in sorted(want):
    xs = by.get(g, []); random.shuffle(xs); pick += xs[:10]
    print(g, len(by.get(g, [])))
out = r'C:\Users\shrut\dev\signeval\poses'
def dl(f): return hf_hub_download('SorensenAI/asl-citizen-poses', f, repo_type='dataset', local_dir=out)
with ThreadPoolExecutor(16) as ex: list(ex.map(dl, pick))
print('downloaded', len(pick))
