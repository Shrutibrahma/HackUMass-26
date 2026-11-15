# Sign recognition plan (M3)

> **Status:** built. Results so far are in `eval/model_check.md` (real ASL Citizen signers) and
> `eval/pipeline_check.md` (real phrases through the app pipeline). Decisions: DECISIONS.md D-020..D-027.
> Still to do on site: framing + fps on the demo phone, hand setting, held-out teammate (`eval/sign_eval.py`).

**Goal:** the 30-second demo works by signing. Recognize a small, *tested* set of everyday signs
reliably. Open-ended ASL translation is a non-goal. Typing and quick replies always work, so
no turn depends on recognition alone.

## Hour one, in parallel with telephony: test real checkpoints on our phone

Candidates (pick by **demonstrated coverage of OUR demo signs and phrase success on our device**,
not by published accuracy):

| Candidate | What it is | Notes |
|---|---|---|
| Kaggle "Google - Isolated Sign Language Recognition" solutions | MediaPipe Holistic landmarks → 1D conv + transformer, 250 signs | Landmark ordering and normalization are documented in each solution's preprocessing |
| GestureSign | ONNX, 250 signs | Demo-grade; easy to run in the browser or on CPU |
| SignBart | WLASL / ASL-Citizen checkpoints | Larger vocabulary; check CPU latency |

For each candidate:
1. List which of our demo signs it covers (table below).
2. Copy its **exact** landmark ordering, normalization, missing-point handling and frame
   sampling. Don't reimplement "roughly the same" preprocessing.
3. On the demo phone, on its stand: each teammate signs each covered sign 5 times, plus the
   three demo phrases 5 times. Record top-1 hits and phrase success.

## One sign per segment

These are single-sign classifiers. **Never feed a multi-sign window to them.**
- The signer makes short, deliberate pauses between signs.
- Segmenter (browser, on landmarks): a sign starts when the hands rise above the rest zone and
  start moving. It ends when wrist speed stays below a threshold for about 250 ms, or the hands
  drop. The phrase ends when the hands rest for about 0.5 s.
- Each segment goes through the checkpoint's own preprocessing and is classified on its own.
  The sign sequence goes to `POST /api/calls/{sid}/signs` after every segment, so the draft is
  ready (and sealed with its hash) before the signer taps Send.

## Uncertainty and context

- Below the confidence threshold (tuned on held-out data), the sign is "unsure". The app shows
  the top two as a pick ("Ten or Twelve?") and nothing is said until the signer taps.
- Context boost: when the caller named options ("six or twelve?"), boost those signs when
  re-ranking the top 5. Never restrict recognition to them.
- No landmarks, skeletons or confidence numbers on screen, ever.

## Vocabulary: start with 15-25 signs that demonstrably work

Seed list for the demo phrases. Expand only after the evaluation supports it.

| Phrase / use | Signs |
|---|---|
| Call Mom | YES, NO, SUNDAY, COME, LOVE, SEE-YOU-LATER, THANK-YOU |
| Restaurant | WANT, SIX, TEN, TWELVE, PICK-UP, PLEASE, FINISH |
| Control | WAIT, AGAIN, MAYBE, SORRY, HELLO, GOOD |

(The original ~80-sign list in the brief stays a backlog, not a claim.)

## Data

- Every teammate records each kept sign 20+ times, in different lighting and against different
  backgrounds, using the phone on its stand.
- Keep **one teammate out of training entirely**. All reported numbers come from that person only.
- Ask a fluent signer to check the sign forms before recording.
- Store landmarks only (no video). The data card goes in `model/DATA_CARD.md`.

## What we report (eval/results.md)

- Single-sign top-1 accuracy on the held-out signer, per sign and overall.
- **Complete-phrase success** on the held-out signer: YES SUNDAY COME, WANT TWELVE PICK-UP,
  NO MAYBE LATER. A phrase counts only if every sign is right, or the signer fixed the one
  unsure sign with a single tap.
- Draft latency (signing ends → draft ready), from `/api/health`.

Until those numbers exist, the README says: "a tested set of everyday signs, with typing for
the rest."

## Framing check (before any UI polish)

Phone on a stand, front camera. Both hands, the face and the upper body must stay in frame for
every demo sign, including signs near the face and signs that move outward. Mark the stand
position on the table.


