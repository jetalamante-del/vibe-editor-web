import { useEffect, useRef, useState } from "react";
import { Pause, Play, Upload } from "lucide-react";
import { demuxMp4 } from "./lib/mp4Demuxer";
import { WebCodecsPlayer } from "./lib/webcodecsPlayer";

interface FileInfo {
  name: string;
  codec: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  hardware: string;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<WebCodecsPlayer | null>(null);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [state, setState] = useState<string>("idle");
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [webcodecsAvailable] = useState(() => typeof window !== "undefined" && "VideoDecoder" in window);

  useEffect(() => () => playerRef.current?.dispose(), []);

  const onFile = async (file: File) => {
    if (!canvasRef.current) return;
    setError(null);
    setInfo(null);
    setState("demuxing");
    try {
      const { track, chunks } = await demuxMp4(file);
      const player = new WebCodecsPlayer(canvasRef.current, {
        onState: setState,
        onTime: setTime,
        onError: (e) => setError(e.message),
        onConfigured: ({ codec, hardwareAcceleration }) =>
          setInfo({
            name: file.name,
            codec,
            width: track.width,
            height: track.height,
            durationSec: track.durationSec,
            fps: track.fps,
            hardware: hardwareAcceleration,
          }),
      });
      playerRef.current?.dispose();
      playerRef.current = player;
      await player.load(track, chunks);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setState("error");
    }
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    state === "playing" ? p.pause() : p.play();
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    playerRef.current?.seek(Number(e.target.value));
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 100)).padStart(2, "0")}`;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Vibe Editor</h1>
          <p className="text-xs text-text-muted">Web · WebCodecs · Hardware-accelerated</p>
        </div>
        <div className="text-xs text-text-muted">
          WebCodecs:{" "}
          <span className={webcodecsAvailable ? "text-emerald-400" : "text-red-400"}>
            {webcodecsAvailable ? "available" : "not available in this browser"}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-4 min-h-0">
        {!info ? (
          <label className="cursor-pointer border border-dashed border-border rounded-2xl px-12 py-16 hover:border-accent transition-colors flex flex-col items-center gap-4 bg-surface-0">
            <Upload className="w-10 h-10 text-text-muted" />
            <div className="text-center">
              <p className="text-text-primary font-medium">Drop or pick a video</p>
              <p className="text-sm text-text-muted mt-1">MP4, MOV — H.264, HEVC, AV1</p>
            </div>
            <input
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
        ) : (
          <div className="w-full max-w-5xl flex flex-col gap-4 min-h-0">
            <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center" style={{ aspectRatio: `${info.width} / ${info.height}` }}>
              <canvas ref={canvasRef} className="w-full h-full object-contain" />
            </div>
            <div className="bg-surface-0 border border-border rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="rounded-md bg-accent/20 hover:bg-accent/30 border border-accent/40 px-3 py-1.5 flex items-center gap-2 text-sm">
                  {state === "playing" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {state === "playing" ? "Pause" : "Play"}
                </button>
                <div className="text-xs text-text-muted font-mono min-w-[120px]">
                  {fmt(time)} / {fmt(info.durationSec)}
                </div>
                <input type="range" min={0} max={info.durationSec} step={0.01} value={time} onChange={onSeek} className="flex-1 accent-cyan-400" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <Field label="File" value={info.name} />
                <Field label="Codec" value={info.codec} />
                <Field label="Resolution" value={`${info.width}×${info.height}`} />
                <Field label="FPS" value={info.fps.toFixed(2)} />
                <Field label="Duration" value={fmt(info.durationSec)} />
                <Field
                  label="Hardware decode"
                  value={info.hardware}
                  highlight={info.hardware.includes("hardware") || info.hardware === "no-preference"}
                />
                <Field label="State" value={state} />
              </div>
            </div>
          </div>
        )}
        {error && <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-md px-4 py-2 text-sm max-w-3xl">{error}</div>}
      </main>

      <footer className="px-6 py-3 border-t border-border text-xs text-text-muted flex justify-between">
        <span>v0.0.1 · Web preview engine: WebCodecs + Canvas2D</span>
        <span>{state}</span>
      </footer>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-text-muted uppercase tracking-wide text-[10px]">{label}</p>
      <p className={`font-mono truncate ${highlight ? "text-emerald-400" : "text-text-primary"}`}>{value}</p>
    </div>
  );
}
