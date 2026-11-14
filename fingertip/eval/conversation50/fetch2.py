import os, sys, random
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import HfApi, hf_hub_download
sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\server')
from app.signs.models import gloss_of
want = set('HAPPY MAD THIRSTY SLEEPY FOOD NOW MOTHER FATHER LIKE HATE CAN WILL NOT SEE LOOK HEAR TALK SAY THINK GIVE STAY BAD BETTER HOT MY WE SLEEP CRY SAME FIND MAKE ALL MANY READ STORE OUTSIDE GRANDMA GRANDPA BROTHER QUIET LISTEN AFTER BEFORE FIRST BED CAR DOG CAT MILK PERSON'.split())
fs = HfApi().list_repo_files('SorensenAI/asl-citizen-poses', repo_type='dataset')
by = {}
for f in fs:
    if f.endswith('.pose'):
        g = gloss_of(os.path.basename(f).rsplit('-', 1)[-1][:-5])
        if g in want: by.setdefault(g, []).append(f)
print('missing', sorted(want - set(by)))
random.seed(2); pick = []
for g, xs in by.items(): random.shuffle(xs); pick += xs[:10]
out = r'C:\Users\shrut\dev\signeval\poses'
with ThreadPoolExecutor(16) as ex: list(ex.map(lambda f: hf_hub_download('SorensenAI/asl-citizen-poses', f, repo_type='dataset', local_dir=out), pick))
print('got', len(pick))
