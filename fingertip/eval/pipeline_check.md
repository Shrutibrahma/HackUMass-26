# Real signers through the app pipeline

ASL Citizen clips (MediaPipe Holistic) streamed at 30 fps through `SignPipeline` ->
`Segmenter` -> `POST /api/signs/classify` (hand: auto). Unsure signs count as their first option (no tap).
These signers may be in the model's training data: this checks segmentation and the pipeline, not held-out accuracy.

- Signs in the right place: **57/60**
- Whole phrases exactly right: **18/20**
- Segments sent to the server: 71 for 60 signs

| Signed | Recognized | Exact |
|---|---|---|
| TOMORROW LATER WHY | TOMORROW LATER WHY | yes |
| PLEASE YES HUNGRY | PLEASE YES HUNGRY | yes |
| NO SAD HUNGRY | NO SAD HUNGRY | yes |
| THIRSTY HUNGRY DAD | THIRSTY HUNGRY DAD | yes |
| HOME YES NOT | HOME YES NOT | yes |
| TOMORROW PLEASE HELLO | TOMORROW PLEASE HELLO | yes |
| HOT YES HOME | HOT YES HOME | yes |
| HOT THANK-YOU WHERE | HOT THANK-YOU WHERE | yes |
| NOT LIKE DAD | NOT LIKE DAD | yes |
| HELLO LATER FINISH | HELLO LATER FINISH | yes |
| THIRSTY DAD TOMORROW | THIRSTY DAD TOMORROW | yes |
| NO LIKE SAD | NO LIKE SAD | yes |
| SAD WHO HOME | SAD WHO HOME | yes |
| WHY NO NOT | WHY NO NOT | yes |
| NO NOT THIRSTY | NO NOT THIRSTY | yes |
| WHO HOME TOMORROW | WHO HOME YES TOMORROW | no |
| PLEASE NO SEE | PLEASE NO SEE | yes |
| YES PLEASE HAVE | YES YES PLEASE HAVE | no |
| FINE NOW FINISH | FINE NOW FINISH | yes |
| TOMORROW NO HELLO | TOMORROW NO HELLO | yes |
