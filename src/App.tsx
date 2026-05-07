import { useEffect, useRef, useState } from "react";
import { Music, Pause, Play, Upload } from "lucide-react";
import { demuxMp4 } from "./lib/mp4Demuxer";
import { WebCodecsPlayer } from "./lib/webcodecsPlayer";
import { AudioPlayer } from "./lib/audioPlayer";

type MediaKind = "video" | "audio";

interface VideoFileInfo {
  kind: "video";
  name: string;
  codec: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  hardware: string;
  // Optional secondary audio track imported alongside.
  audioFileName?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  audioDurationSec?: number;
}

interface AudioFileInfo {
  kind: "audio";
  name: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
}

type FileInfo = VideoFileInfo | AudioFileInfo;

const VIDEO_EXTS = [".mp4", ".mov", ".m4v"];
const AUDIO_EXTS = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"];

const detectKind = (file: File): MediaKind | null => {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("video/") || VIDEO_EXTS.some((e) => name.endsWith(e))) return "video";
  if (file.type.startsWith("audio/") || AUDIO_EXTS.some((e) => name.endsWith(e))) return "audio";
  return null;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoPlayerRef = useRef<WebCodecsPlayer | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [state, setState] = useState<string>("idle");
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [webcodecsAvailable] = useState(() => typeof window !== "undefined" && "VideoDecoder" in window);

  useEffect(
    () => () => {
      videoPlayerRef.current?.dispose();
      audioPlayerRef.current?.dispose();
    },
    [],
  );

  const handleFiles = async (files: File[]) => {
    console.log("[vibe] handleFiles called with", files.length, "files:", files.map((f) => `${f.name} (${f.type || "no-type"}, ${f.size}B)`));
    const sorted = files
      .map((f) => ({ f, kind: detectKind(f) }))
      .filter((x): x is { f: File; kind: MediaKind } => x.kind !== null);
    console.log("[vibe] detected kinds:", sorted.map((s) => `${s.f.name} -> ${s.kind}`));
    if (sorted.length === 0) {
      const msg = `Unsupported file type${files.length > 1 ? "s" : ""}: ${files.map((f) => `${f.name} (${f.type || "?"})`).join(", ")}`;
      console.error("[vibe]", msg);
      setError(msg);
      return;
    }
    const videoFile = sorted.find((x) => x.kind === "video")?.f;
    const audioFile = sorted.find((x) => x.kind === "audio")?.f;
    console.log("[vibe] routing:", { video: videoFile?.name, audio: audioFile?.name });

    // mp4box accumulates the whole file in memory until it finds the moov box.
    // Sony cameras put moov at the END, so an 8 GB capture forces ~8 GB of
    // browser heap before even one frame can be emitted. Until we replace
    // mp4box with a random-access demuxer, refuse files past a sane limit.
    const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
    if (videoFile && videoFile.size > MAX_VIDEO_BYTES) {
      const gb = (videoFile.size / 1024 / 1024 / 1024).toFixed(1);
      setError(
        `Video file is ${gb} GB. The current demuxer can't stream files larger than 2 GB without a custom random-access reader (coming next). Drop a smaller file, or use the 1080p H.264 proxy at ~/Desktop/C0126_proxy_1080p.mp4 (already generated for you).`,
      );
      setState("idle");
      setInfo(null);
      return;
    }

    setError(null);
    setInfo(null);
    setTime(0);
    videoPlayerRef.current?.dispose();
    audioPlayerRef.current?.dispose();
    videoPlayerRef.current = null;
    audioPlayerRef.current = null;

    // Mount the player UI immediately with a placeholder so the canvas/audio
    // shells render synchronously. Without this, canvasRef.current is still
    // null when WebCodecsPlayer tries to read it, and the load fails silently.
    if (videoFile) {
      setInfo({
        kind: "video",
        name: videoFile.name,
        codec: "—",
        width: 1920,
        height: 1080,
        durationSec: 0,
        fps: 0,
        hardware: "—",
        audioFileName: audioFile?.name,
      });
    } else if (audioFile) {
      setInfo({ kind: "audio", name: audioFile.name, durationSec: 0, sampleRate: 0, channels: 0 });
    }
    // Wait one paint so refs settle.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    // Time updates only come from the video clock when both are present
    // (otherwise audio drives). State follows whichever drives.
    const driver: "video" | "audio" = videoFile ? "video" : "audio";

    if (videoFile) {
      if (!canvasRef.current) {
        const msg = "Internal: canvas ref not attached after rAF wait";
        console.error("[vibe]", msg);
        setError(msg);
        return;
      }
      setState("demuxing 0%");
      console.log("[vibe] starting demuxMp4 for", videoFile.name, "size:", videoFile.size);
      try {
        const { track, chunks } = await demuxMp4(videoFile, (loaded, total) => {
          const pct = Math.floor((loaded / total) * 100);
          setState(`demuxing ${pct}%`);
        });
        console.log("[vibe] demuxed", { codec: track.codec, chunks: chunks.length, width: track.width, height: track.height, durationSec: track.durationSec });
        const player = new WebCodecsPlayer(canvasRef.current, {
          onState: driver === "video" ? setState : undefined,
          onTime: driver === "video" ? setTime : undefined,
          onError: (e) => setError(e.message),
          onConfigured: ({ codec, hardwareAcceleration }) =>
            setInfo((prev) => ({
              ...((prev ?? {}) as object),
              kind: "video",
              name: videoFile.name,
              codec,
              width: track.width,
              height: track.height,
              durationSec: track.durationSec,
              fps: track.fps,
              hardware: hardwareAcceleration,
              audioFileName: audioFile?.name,
            }) as VideoFileInfo),
        });
        videoPlayerRef.current = player;
        await player.load(track, chunks);
      } catch (e: any) {
        setError(e.message ?? String(e));
        setState("error");
      }
    }

    if (audioFile) {
      try {
        const player = new AudioPlayer({
          onState: driver === "audio" ? setState : undefined,
          onTime: driver === "audio" ? setTime : undefined,
          onError: (e) => setError(e.message),
          onLoaded: ({ durationSec, sampleRate, channels }) =>
            setInfo((prev) => {
              if (prev?.kind === "video") {
                return { ...prev, audioFileName: audioFile.name, audioSampleRate: sampleRate, audioChannels: channels, audioDurationSec: durationSec };
              }
              return { kind: "audio", name: audioFile.name, durationSec, sampleRate, channels };
            }),
        });
        audioPlayerRef.current = player;
        await player.load(audioFile);
      } catch (e: any) {
        setError(e.message ?? String(e));
        setState("error");
      }
    }
  };

  // Drive both players together. Video clock leads; audio is started/stopped
  // and seeked alongside it. Sync drift accumulates in long playback because
  // their clocks are independent — fine for the POC, the proper fix is to
  // route audio through the same wall-clock the video rAF uses.
  const togglePlay = () => {
    const v = videoPlayerRef.current;
    const a = audioPlayerRef.current;
    if (!v && !a) return;
    if (state === "playing") {
      v?.pause();
      a?.pause();
    } else {
      v?.play();
      a?.play();
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    videoPlayerRef.current?.seek(t);
    audioPlayerRef.current?.seek(t);
  };

  // Drag-and-drop on the whole window so the user can drop anywhere
  // — without preventDefault on dragover the browser navigates away to the file.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void handleFiles(files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 100)).padStart(2, "0")}`;

  const duration = info?.durationSec ?? 0;

  return (
    <div className="h-full flex flex-col relative">
      {isDragging && (
        <div className="fixed inset-0 z-50 pointer-events-none border-4 border-accent bg-accent/10 flex items-center justify-center">
          <div className="bg-surface-1 border border-accent rounded-xl px-8 py-6 text-text-primary font-medium">
            Drop to import
          </div>
        </div>
      )}

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
              <p className="text-text-primary font-medium">Drop or pick a media file</p>
              <p className="text-sm text-text-muted mt-1">Video: MP4, MOV (H.264, HEVC, AV1)</p>
              <p className="text-sm text-text-muted">Audio: WAV, MP3, M4A, AAC, FLAC</p>
            </div>
            <input
              type="file"
              multiple
              accept="video/*,audio/*,.mp4,.mov,.m4v,.wav,.mp3,.m4a,.aac,.flac,.ogg"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void handleFiles(files);
              }}
            />
          </label>
        ) : info.kind === "video" ? (
          <div className="w-full max-w-5xl flex flex-col gap-4 min-h-0">
            <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center" style={{ aspectRatio: `${info.width} / ${info.height}` }}>
              <canvas ref={canvasRef} className="w-full h-full object-contain" />
            </div>
            <Transport state={state} time={time} duration={duration} onPlay={togglePlay} onSeek={onSeek} fmt={fmt} />
            <div className="bg-surface-0 border border-border rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Field label="Video file" value={info.name} />
              <Field label="Codec" value={info.codec} />
              <Field label="Resolution" value={`${info.width}×${info.height}`} />
              <Field label="FPS" value={info.fps.toFixed(2)} />
              <Field label="Duration" value={fmt(info.durationSec)} />
              <Field label="Hardware decode" value={info.hardware} highlight={info.hardware.includes("hardware") || info.hardware === "no-preference"} />
              <Field label="State" value={state} />
              {info.audioFileName && (
                <>
                  <Field label="Audio file" value={info.audioFileName} highlight />
                  <Field label="Audio sample rate" value={`${info.audioSampleRate ?? "?"} Hz`} />
                  <Field label="Audio channels" value={String(info.audioChannels ?? "?")} />
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full max-w-3xl flex flex-col gap-4">
            <div className="bg-surface-0 border border-border rounded-lg flex flex-col items-center justify-center py-16 gap-3">
              <Music className="w-12 h-12 text-accent" />
              <p className="text-text-primary font-medium">{info.name}</p>
              <p className="text-text-muted text-xs">Audio · Web Audio API · 24-bit safe</p>
            </div>
            <Transport state={state} time={time} duration={duration} onPlay={togglePlay} onSeek={onSeek} fmt={fmt} />
            <div className="bg-surface-0 border border-border rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Field label="File" value={info.name} />
              <Field label="Sample rate" value={`${info.sampleRate} Hz`} />
              <Field label="Channels" value={String(info.channels)} />
              <Field label="Duration" value={fmt(info.durationSec)} />
              <Field label="Engine" value="Web Audio API" highlight />
              <Field label="State" value={state} />
            </div>
          </div>
        )}
        {error && <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-md px-4 py-2 text-sm max-w-3xl">{error}</div>}
      </main>

      <footer className="px-6 py-3 border-t border-border text-xs text-text-muted flex justify-between">
        <span>v0.0.1 · Web preview engine: WebCodecs + Web Audio</span>
        <span>{state}</span>
      </footer>
    </div>
  );
}

function Transport({
  state,
  time,
  duration,
  onPlay,
  onSeek,
  fmt,
}: {
  state: string;
  time: number;
  duration: number;
  onPlay: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fmt: (s: number) => string;
}) {
  return (
    <div className="bg-surface-0 border border-border rounded-lg p-4 flex items-center gap-3">
      <button onClick={onPlay} className="rounded-md bg-accent/20 hover:bg-accent/30 border border-accent/40 px-3 py-1.5 flex items-center gap-2 text-sm">
        {state === "playing" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {state === "playing" ? "Pause" : "Play"}
      </button>
      <div className="text-xs text-text-muted font-mono min-w-[120px]">
        {fmt(time)} / {fmt(duration)}
      </div>
      <input type="range" min={0} max={duration || 1} step={0.01} value={time} onChange={onSeek} className="flex-1 accent-cyan-400" />
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
