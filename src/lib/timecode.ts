/**
 * Single source of truth for time formatting across the editor.
 *
 * Timeline ruler / ledger uses {@link fmtCoarse} (mm:ss).
 * Transport / playhead uses {@link fmtPrecise} (mm:ss.cs — centiseconds).
 * Asset cards reuse {@link fmtCoarse}.
 *
 * Frame-accurate (mm:ss:ff) formatting will live here when we wire up the
 * project frame rate, so the editor can show timecodes the way pros expect.
 */
const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

export function fmtCoarse(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${pad(m)}:${pad(s)}`;
}

export function fmtPrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}
