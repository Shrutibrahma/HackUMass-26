# Real signers through the app pipeline

ASL Citizen clips (MediaPipe Holistic) streamed at 30 fps through `SignPipeline` ->
`Segmenter` -> `POST /api/signs/classify` (hand: auto). Unsure signs count as their first option (no tap).
These signers may be in the model's training data: this checks segmentation and the pipeline, not held-out accuracy.

- Signs in the right place: **22/24**
- Whole phrases exactly right: **8/12**
- Segments sent to the server: 29 for 24 signs

| Signed | Recognized | Exact |
|---|---|---|
| YES SUNDAY COME | YES SUNDAY COME | yes |
| WANT SIX | WANT SIX | yes |
| THANK-YOU | FINE | no |
| NO TOMORROW | NO TOMORROW | yes |
| NEED MORE | NEED MORE | yes |
| YES SEVEN | YES SEVEN FINE | no |
| YES SUNDAY COME | YES SUNDAY COME | yes |
| WANT SIX | WANT WANT SIX | no |
| THANK-YOU | THANK-YOU | yes |
| NO TOMORROW | NO TOMORROW TOMORROW | no |
| NEED MORE | NEED MORE | yes |
| YES SEVEN | YES SEVEN | yes |


