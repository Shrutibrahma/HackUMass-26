# Sign model check on real signers (ASL Citizen poses)

313 clips of 62 of our signs, from HF `SorensenAI/asl-citizen-poses` (MediaPipe Holistic landmarks).

**Not held-out accuracy.** SignBart was trained on ASL Citizen and these clips may be in its training set.
This checks the landmark format, preprocessing and model port end to end on real signers.
Held-out numbers come from our own signer (`eval/sign_eval.py`).

## SignBart ASL-Citizen-2730 (primary)

| Setting | Top-1 of all 2,730 signs | Top-1 within our signs |
|---|---|---|
| Right-handed order only | 209/313 (67%) | 261/313 (83%) |
| **Hand setting matches the signer** (app setting) | **267/313 (85%)** | **301/313 (96%)** |
| Automatic (more confident of both orders) | 214/313 (68%) | 268/313 (86%) |

Top-5 (right-handed order): 263/313 (84%). Median CPU time per sign: 8 ms.

## ISLR 1st place (250 signs, second opinion)

Top-1 on the 100 clips of signs it knows: 84/100 (84%). Median CPU time: 20 ms. It needs 468 face points per frame, so it isn't in the live path.

## Per sign

| Sign | Clips | Right-hand top-1 | Hand-matched top-1 | Hand-matched, within ours | ISLR top-1 | Active |
|---|---|---|---|---|---|---|
| AFTERNOON | 4 | 3 | 3 | 4 | - | yes |
| AGAIN | 5 | 4 | 4 | 4 | - | yes |
| APPOINTMENT | 6 | 5 | 5 | 6 | - | yes |
| BUSY | 6 | 2 | 2 | 6 | - | yes |
| CANCEL | 3 | 2 | 3 | 3 | - | yes |
| CHANGE | 4 | 3 | 3 | 4 | - | yes |
| COME | 2 | 2 | 2 | 2 | - | yes |
| EIGHT | 6 | 6 | 6 | 6 | - | yes |
| ELEVEN | 5 | 5 | 5 | 5 | - | yes |
| FINE | 6 | 2 | 6 | 6 | 5/6 | yes |
| FINISH | 6 | 3 | 6 | 6 | 6/6 | yes |
| FOUR | 5 | 0 | 5 | 5 | - | yes |
| FRIDAY | 6 | 4 | 4 | 5 | - | yes |
| GO | 6 | 0 | 6 | 6 | 4/6 | yes |
| GOOD | 5 | 1 | 1 | 2 | - |  |
| HAPPY | 6 | 4 | 4 | 5 | 6/6 | yes |
| HAVE | 6 | 6 | 6 | 6 | 4/6 | yes |
| HELLO | 3 | 0 | 2 | 3 | 2/3 | yes |
| HELP | 6 | 4 | 4 | 5 | - | yes |
| HOME | 3 | 2 | 2 | 3 | 3/3 | yes |
| LATER | 6 | 0 | 5 | 5 | 6/6 | yes |
| LOVE | 6 | 4 | 4 | 6 | - | yes |
| MAYBE | 4 | 0 | 4 | 4 | - | yes |
| MONDAY | 6 | 4 | 4 | 6 | - | yes |
| MORE | 6 | 6 | 6 | 6 | - | yes |
| MORNING | 5 | 0 | 4 | 5 | 2/5 | yes |
| NAME | 5 | 0 | 4 | 5 | - | yes |
| NEED | 5 | 5 | 5 | 5 | - | yes |
| NIGHT | 6 | 2 | 6 | 6 | 3/6 | yes |
| NINE | 1 | 1 | 1 | 1 | - |  |
| NO | 6 | 6 | 6 | 6 | 6/6 | yes |
| NOW | 6 | 4 | 4 | 4 | 6/6 |  |
| ONE | 6 | 4 | 4 | 6 | - | yes |
| ORDER | 5 | 4 | 4 | 5 | - | yes |
| PAY | 6 | 0 | 6 | 6 | - | yes |
| PLEASE | 6 | 5 | 5 | 6 | 6/6 | yes |
| READY | 5 | 5 | 5 | 5 | - | yes |
| SATURDAY | 6 | 5 | 5 | 5 | - | yes |
| SEVEN | 6 | 6 | 6 | 6 | - | yes |
| SIX | 6 | 5 | 5 | 5 | - | yes |
| SLOW | 6 | 0 | 6 | 6 | - | yes |
| SMALL | 4 | 3 | 3 | 4 | - | yes |
| SORRY | 6 | 5 | 5 | 6 | - | yes |
| SUNDAY | 6 | 6 | 6 | 6 | - | yes |
| THANK-YOU | 5 | 5 | 5 | 5 | 5/5 | yes |
| THREE | 3 | 3 | 3 | 3 | - | yes |
| THURSDAY | 5 | 5 | 5 | 5 | - | yes |
| TIME | 4 | 4 | 4 | 4 | 1/4 | yes |
| TIRED | 6 | 5 | 5 | 6 | - | yes |
| TODAY | 3 | 3 | 3 | 3 | - | yes |
| TOMORROW | 5 | 5 | 5 | 5 | 5/5 | yes |
| TUESDAY | 6 | 6 | 6 | 6 | - | yes |
| TWO | 3 | 0 | 3 | 3 | - | yes |
| W.H.A.T | 4 | 3 | 3 | 4 | - | yes |
| WAIT | 5 | 4 | 4 | 5 | 4/5 | yes |
| WANT | 6 | 4 | 5 | 6 | - | yes |
| WEDNESDAY | 2 | 2 | 2 | 2 | - | yes |
| WEEK | 6 | 6 | 6 | 6 | - | yes |
| WHEN | 6 | 5 | 5 | 6 | - | yes |
| WHERE | 4 | 2 | 2 | 4 | 4/4 | yes |
| YES | 6 | 6 | 6 | 6 | 6/6 | yes |
| ZERO | 5 | 3 | 3 | 5 | - | yes |

**Active vocabulary (59 signs, hand-matched within-ours top-1 >= 80% on 2+ clips):** AFTERNOON, AGAIN, APPOINTMENT, BUSY, CANCEL, CHANGE, COME, EIGHT, ELEVEN, FINE, FINISH, FOUR, FRIDAY, GO, HAPPY, HAVE, HELLO, HELP, HOME, LATER, LOVE, MAYBE, MONDAY, MORE, MORNING, NAME, NEED, NIGHT, NO, ONE, ORDER, PAY, PLEASE, READY, SATURDAY, SEVEN, SIX, SLOW, SMALL, SORRY, SUNDAY, THANK-YOU, THREE, THURSDAY, TIME, TIRED, TODAY, TOMORROW, TUESDAY, TWO, W.H.A.T, WAIT, WANT, WEDNESDAY, WEEK, WHEN, WHERE, YES, ZERO


