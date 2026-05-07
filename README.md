# Vibe Editor (Web)

Web-based video editor with **WebCodecs** for hardware-accelerated video decoding directly in the browser. No download, no transcoding, native playback performance for H.264/HEVC/AV1.

This is the web rebuild of [Vibe Editor (desktop)](https://github.com/jetalamante-del/vibe-editor), which is a fork of [Clypra](https://github.com/AIEraDev/Clypra). The desktop version hit WebKit limitations on 4K HEVC; the web version uses `VideoDecoder` to talk directly to VideoToolbox / Media Foundation / VAAPI.

## Stack

- **React 19** + TypeScript + Vite + Tailwind v4
- **WebCodecs API** for hardware video decode
- **mp4box.js** for MP4/MOV demuxing
- **Web Audio API** for audio playback
- **OPFS / File System Access API** for local file handling
- **ffmpeg.wasm** for export (planned)

## Browser support

WebCodecs requires:
- Chrome 94+ ✅
- Edge 94+ ✅
- Safari 16.4+ ✅
- Firefox 130+ ✅

## Status

**v0.0.1 — proof-of-concept.** Drop a video file, watch it play with hardware decode. The full editor UI (timeline, multi-track, effects, export) ships in subsequent commits.

## Dev

```bash
npm install
npm run dev
```

Then open the URL Vite prints.
