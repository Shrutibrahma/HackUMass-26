# Build the signer app, then run the FastAPI server that also serves it.
FROM node:22-slim AS web
WORKDIR /web
COPY app/package*.json app/scripts-copy-wasm.mjs ./
RUN npm ci
COPY app/ ./
RUN node scripts-copy-wasm.mjs && npm run build

FROM python:3.13-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1 STATIC_DIR=/srv/static LOG_DIR=/srv/logs SIGN_MODEL_DIR=/srv/model
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ ./
COPY model/ ./model/
COPY --from=web /web/dist ./static
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]


