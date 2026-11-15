import numpy as np, collections
d = np.load('logits.npz'); R, L, T, G = d['R'], d['L'], d['T'], d['G']
def score(vocab):
    mask = np.isin(G, list(vocab))
    def pred(X):
        Z = np.where(mask, X, -1e9); Z = Z - Z.max(1, keepdims=True); P = np.exp(Z); P /= P.sum(1, keepdims=True)
        out = []
        for p in P:
            agg = collections.defaultdict(float)
            for i in np.nonzero(p > 1e-6)[0]: agg[G[i]] += p[i]
            s = max(agg, key=agg.get); out.append((s, agg[s]))
        return out
    pr, pl = pred(R), pred(L)
    res = collections.defaultdict(lambda: [0, 0, 0, 0])  # n, right, auto, oracle
    for t, (a, pa), (b, pb) in zip(T, pr, pl):
        if t not in vocab: continue
        r = res[t]; r[0] += 1; r[1] += a == t; r[2] += (a if pa >= pb else b) == t; r[3] += (a == t or b == t)
    return res
if __name__ == "__main__":
  V = set(T)
  while len(V) > 50:
    res = score(V); worst = min(V, key=lambda s: (res[s][3] / res[s][0], res[s][2] / res[s][0])); print('drop', worst, res[worst]); V.discard(worst)
  res = score(V)
  n = sum(r[0] for r in res.values())
  print('FINAL', len(V), 'right', sum(r[1] for r in res.values()) / n, 'auto', sum(r[2] for r in res.values()) / n, 'hand-matched', sum(r[3] for r in res.values()) / n)
  for s in sorted(V): print(s, res[s])
