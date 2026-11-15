// Copies MediaPipe's WASM runtime into public/ so the app never needs a CDN at the venue.
import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('public/mediapipe', { recursive: true })
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true })
console.log('copied MediaPipe wasm -> public/mediapipe/wasm')


