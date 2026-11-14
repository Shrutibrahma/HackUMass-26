import glob, os, sys, json, numpy as np
sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\server'); sys.path.insert(0, r'C:\Users\shrut\dev\sign2speak\fingertip\model')
from validate_aslcitizen import frames_from_pose
from app.signs.models import SignBartModel, gloss_of, signbart_input
from app.signs.service import _swap
m = SignBartModel()
G = [gloss_of(l) for l in m.labels]
files = sorted(glob.glob(r'C:\Users\shrut\dev\signeval\poses\**\*.pose', recursive=True))
T = [gloss_of(os.path.basename(f).rsplit('-', 1)[-1][:-5]) for f in files]
R, L = [], []
for f in files:
    fr = frames_from_pose(f)
    R.append(m.sess.run(None, {'keypoints': signbart_input(fr)})[0][0]); L.append(m.sess.run(None, {'keypoints': signbart_input(_swap(fr))})[0][0])
np.savez('logits.npz', R=np.array(R), L=np.array(L), T=np.array(T), G=np.array(G))
