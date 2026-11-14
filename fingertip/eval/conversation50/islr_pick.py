import glob, os, sys, numpy as np, collections, json
sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\server'); sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\model')
from validate_aslcitizen import frames_from_pose
from app.signs.models import IslrModel, gloss_of, _softmax
m = IslrModel(r'C:\Users\shrut\dev\sign2speak\fingertip\model')
IG = [gloss_of(l) for l in m.labels]
MAP = {'MOTHER': 'MOM', 'FATHER': 'DAD', 'MY': 'MINEMY', 'WE': 'WEUS'}
CAND = set('HELLO BYE YES NO PLEASE THANK-YOU HAVE FINE SAD SICK HUNGRY DRINK WATER HOME GO WAIT FINISH WHERE WHO WHY TOMORROW YESTERDAY LATER MORNING NIGHT TIME MOM DAD HAPPY MAD THIRSTY SLEEPY FOOD NOW LIKE HATE CAN WILL NOT SEE LOOK HEAR TALK SAY THINK GIVE STAY BAD BETTER HOT MINEMY WEUS SLEEP CRY SAME FIND MAKE ALL MANY READ STORE OUTSIDE GRANDMA GRANDPA BROTHER QUIET LISTEN AFTER BEFORE FIRST BED CAR DOG CAT MILK PERSON CALLONPHONE POTTY YOURSELF HESHEIT'.split())
assert CAND <= set(IG), CAND - set(IG)
files = glob.glob(r'C:\Users\shrut\dev\signeval\poses\**\*.pose', recursive=True)
X, T = [], []
for f in files:
    t = gloss_of(os.path.basename(f).rsplit('-', 1)[-1][:-5]); t = MAP.get(t, t)
    if t not in CAND: continue
    out = m.runner(**{m.in_name: __import__('app.signs.models', fromlist=['x']).islr_input(frames_from_pose(f))})[m.out_name]
    X.append(np.asarray(out, dtype=np.float32).reshape(-1)); T.append(t)
X = np.array(X); T = np.array(T); IG = np.array(IG)
np.savez('islr_logits.npz', X=X, T=T, IG=IG)
def score(V):
    mask = np.isin(IG, list(V)); r = collections.defaultdict(lambda: [0, 0]); conf = collections.Counter()
    for x, t in zip(X, T):
        if t not in V: continue
        p = IG[np.argmax(np.where(mask, x, -1e9))]; r[t][0] += 1; r[t][1] += p == t
        if p != t: conf[(t, p)] += 1
    return r, conf
V = set(CAND); KEEP = set('HELLO YES NO PLEASE THANK-YOU WHERE WHO WHY'.split())
r, _ = score(V); n = sum(a for a, b in r.values()); print('all', len(V), sum(b for a, b in r.values()) / n)
while True:
    r, conf = score(V)
    worst = min((s for s in r if s not in KEEP), key=lambda s: r[s][1] / r[s][0])
    if r[worst][1] / r[worst][0] >= 0.8: break
    print('drop', worst, r[worst]); V.discard(worst)
r, conf = score(V); n = sum(a for a, b in r.values())
print('FINAL', len(V), 'evaluated', len(r), 'acc %.3f' % (sum(b for a, b in r.values()) / n))
print('not evaluable (no clips):', sorted(V - set(r)))
print({s: r[s] for s in sorted(r)})
print(conf.most_common(10))
json.dump(sorted(V), open('islr_vocab.json', 'w'))
