import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // NOTE: when ffmpeg.wasm is added later we'll need cross-origin isolation
  // (Cross-Origin-Opener-Policy: same-origin + Cross-Origin-Embedder-Policy:
  // require-corp) for SharedArrayBuffer. Adding it now breaks Vite's HMR
  // client because its scripts aren't marked as same-origin resources.
});
