#!/usr/bin/env bash
# Re-download the source weights. The server only needs model/signbart/signbart.onnx (committed).
#   SignBart-ASL-2730 (ASL Citizen): huggingface.co/tinh2312/SignBart-ASL-2730. NO LICENSE declared on the
#     model card or the GitHub repo: fine for a hackathon demo, ask the authors before redistributing.
#   ISLR 1st place (model card: license MIT): huggingface.co/sign/kaggle-asl-signs-1st-place
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p signbart islr
curl -fL -o signbart/model.safetensors https://huggingface.co/tinh2312/SignBart-ASL-2730/resolve/main/model.safetensors
curl -fL -o signbart/config.json https://huggingface.co/tinh2312/SignBart-ASL-2730/resolve/main/config.json
curl -fL -o islr/model.tflite https://huggingface.co/sign/kaggle-asl-signs-1st-place/resolve/main/model.tflite
curl -fL -o islr/sign_to_prediction_index_map.json https://huggingface.co/sign/kaggle-asl-signs-1st-place/resolve/main/sign_to_prediction_index_map.json
# Rebuild the ONNX file (needs torch + safetensors + onnx + onnxruntime):  python signbart_model.py


