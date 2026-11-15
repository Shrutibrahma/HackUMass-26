import glob, os, sys, random, numpy as np
sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\server'); sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\model')
from validate_aslcitizen import frames_from_pose
from app.signs.models import gloss_of
from app.signs.personal import PersonalSigns
d = np.load(r'C:\Users\shrut\dev\signeval\logits.npz'); R, T = d['R'], d['T']
files = sorted(glob.glob(r'C:\Users\shrut\dev\signeval\poses\**\*.pose', recursive=True))
FR = [frames_from_pose(f) for f in files]
random.seed(3); signs = sorted(set(T)); pos_all, neg_all = [], []
for trial in range(5):
    taught = random.sample(signs, 12)
    P = PersonalSigns(os.devnull + '.x'); P._save = lambda: None
    test = []
    for s in taught:
        idx = [i for i in range(len(T)) if T[i] == s]; random.shuffle(idx)
        for i in idx[:3]: P.add(s, FR[i], 'right', R[i])
        test += [(i, True) for i in idx[3:]]
    test += [(i, False) for i in range(len(T)) if T[i] not in taught]
    for i, ispos in test:
        sc = P.score(FR[i], 'right', R[i]); top, s1 = sc[0]; s2 = sc[1][1]
        (pos_all if ispos else neg_all).append((top == T[i], s1, s1 - s2))
for th in (0.5, 0.55, 0.6, 0.65, 0.7, 0.75):
    for mg in (0.0, 0.03, 0.06):
        tp = sum(1 for c, s, m in pos_all if c and s >= th and m >= mg) / len(pos_all)
        wrong = sum(1 for c, s, m in pos_all if (not c) and s >= th and m >= mg) / len(pos_all)
        fp = sum(1 for c, s, m in neg_all if s >= th and m >= mg) / len(neg_all)
        print(f'th {th} mg {mg}: taught-correct {tp:.2f} taught-wrong {wrong:.2f} untaught-fires {fp:.3f}')
