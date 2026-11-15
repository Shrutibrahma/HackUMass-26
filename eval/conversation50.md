# Live sign engine: Google ISLR (Kaggle 1st place), 55 signs

**Why it changed:** in live use on a laptop webcam, SignBart answered EIGHT at 98% confidence for unrelated signs.
The ISLR model was trained on MediaPipe Holistic landmarks from Deaf signers recording on their own phones
and webcams (Google's "Isolated Sign Language Recognition" Kaggle competition), which is what the app sends.

**Held-out check:** ASL Citizen clips are a different dataset with different signers, so ISLR never saw them.
- 632 clips, restricted to the 55 signs: **96.5% top-1**.
- With the unsure rule (p < 0.45 or margin < 0.15 → the app asks), 94% are said directly and 1.4% are said wrong.
- Through the live HTTP endpoint, in the browser's wire format (76 face points, 10 fps): **99/100**.
- Without face points: 70% (all 250 signs) vs 80% with them. The 76 lip, nose and eye points give the same result as all 468.

Signs: ALL BAD BED BEFORE BETTER BYE CAR CAT DAD FIND FINE FINISH FIRST GIVE GO HAPPY HAVE HEAR HELLO HOME HOT
HUNGRY LATER LIKE MAD MAKE MANY MILK MOM NIGHT NO NOT NOW OUTSIDE PERSON PLEASE QUIET READ SAD SAME SEE SLEEP STAY
THANK-YOU THINK THIRSTY TOMORROW WAIT WATER WE WHERE WHO WHY YES YESTERDAY.
Dropped (below 80% within the set): HATE LISTEN TALK DRINK AFTER TIME WILL SICK DOG MORNING CRY MY CAN BROTHER.
Scripts: eval/conversation50/islr_pick.py. Engine switch: SIGN_ENGINE=signbart.

---

# Previous engine (SignBart, ASL Citizen 2,730)

# The 50 conversation signs: check on real signers

500 ASL Citizen clips (HF `SorensenAI/asl-citizen-poses`), 10 random clips per sign, many different signers.
Recognition restricted to the app's active vocabulary (79 signs, the 50 plus the earlier tested set).

**Caveat:** SignBart was trained on ASL Citizen, so some of these clips may be in its training set. These numbers check the port and the vocabulary choice; they are not held-out accuracy on a new signer. Your own webcam will be lower; that is what Settings → Signing → "Tune to me" is for.

| Setting | Top-1 |
|---|---|
| Hand setting matches the signer (the app's setting) | **98.8%** |
| Not sure (picks the more confident hand order) | 93.0% |
| Always right-handed order | 76.4% |

Chosen from 73 everyday candidates. Dropped because they were confused with others: GOOD, FEEL, NOW, BUSY, LIKE, HAPPY, CALL.

| Sign | Clips | Hand matched | Not sure | Right order |
|---|---|---|---|---|
| HELLO | 10 | 10 | 9 | 0 |
| BYE | 10 | 10 | 9 | 10 |
| YES | 10 | 10 | 10 | 10 |
| NO | 10 | 10 | 10 | 10 |
| OK | 10 | 10 | 10 | 10 |
| PLEASE | 10 | 10 | 9 | 10 |
| THANK-YOU | 10 | 9 | 9 | 9 |
| SORRY | 10 | 10 | 10 | 10 |
| HELP | 10 | 10 | 10 | 10 |
| WANT | 10 | 10 | 10 | 7 |
| NEED | 10 | 10 | 10 | 10 |
| HAVE | 10 | 10 | 10 | 10 |
| LOVE | 10 | 10 | 10 | 10 |
| FINE | 10 | 10 | 10 | 10 |
| SAD | 10 | 10 | 10 | 10 |
| TIRED | 10 | 10 | 10 | 10 |
| SICK | 10 | 10 | 10 | 10 |
| HUNGRY | 10 | 10 | 10 | 10 |
| EAT | 10 | 10 | 10 | 10 |
| DRINK | 10 | 10 | 9 | 10 |
| WATER | 10 | 10 | 3 | 10 |
| BATHROOM | 10 | 10 | 10 | 10 |
| HOME | 10 | 9 | 2 | 9 |
| WORK | 10 | 10 | 10 | 1 |
| GO | 10 | 10 | 10 | 2 |
| COME | 10 | 10 | 10 | 10 |
| WAIT | 10 | 9 | 9 | 9 |
| STOP | 10 | 9 | 9 | 9 |
| FINISH | 10 | 10 | 10 | 10 |
| AGAIN | 10 | 9 | 9 | 9 |
| MORE | 10 | 10 | 10 | 10 |
| UNDERSTAND | 10 | 10 | 10 | 0 |
| KNOW | 10 | 10 | 5 | 10 |
| NAME | 10 | 10 | 10 | 3 |
| WHAT | 10 | 9 | 4 | 3 |
| WHERE | 10 | 10 | 10 | 10 |
| WHEN | 10 | 10 | 10 | 10 |
| WHO | 10 | 10 | 10 | 1 |
| WHY | 10 | 10 | 10 | 0 |
| HOW | 10 | 10 | 10 | 10 |
| TODAY | 10 | 10 | 10 | 10 |
| TOMORROW | 10 | 10 | 10 | 10 |
| YESTERDAY | 10 | 10 | 10 | 10 |
| LATER | 10 | 10 | 9 | 1 |
| MORNING | 10 | 10 | 10 | 0 |
| NIGHT | 10 | 10 | 10 | 9 |
| TIME | 10 | 10 | 10 | 10 |
| FRIEND | 10 | 10 | 10 | 10 |
| MOTHER | 10 | 10 | 10 | 0 |
| MAYBE | 10 | 10 | 10 | 0 |

## Personal signs (taught by the signer)

Few-shot nearest neighbour on SignBart logits + hand-shape trajectory. Calibrated by teaching 12 signs with 3 clips each and testing on clips by *other* signers (harder than the real case, where the same person teaches and signs). 5 trials.

| Threshold | Taught signs recognised | Taught signs wrong | Untaught signs that fire by mistake |
|---|---|---|---|
| 0.70 (said without asking) | 29% | 2% | 0.8% |
| 0.55 (offered as a choice) | 60% | 8% | 11% |

Below 0.70 a personal match is only offered as a choice next to the model's guess, never spoken without a tap.
