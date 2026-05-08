import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { MediaPanel } from "./components/MediaPanel";
import { PreviewArea } from "./components/PreviewArea";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Timeline } from "./components/Timeline";
import { demuxMp4Streaming } from "./lib/mp4Demuxer";
import { WebCodecsPlayer } from "./lib/webcodecsPlayer";
import { AudioPlayer } from "./lib/audioPlayer";
import { useProjectStore, type MediaKind } from "./store/projectStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hardware, setHardware] = useState<string | null>(null);
  const [webcodecsAvailable] = useState(() => typeof window !== "undefined" && "VideoDecoder" in window);

  const addAsset = useProjectStore((s) => s.addAsset);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const addClipForAsset = useProjectStore((s) => s.addClipForAsset);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const mediaPanelOpen = useProjectStore((s) => s.mediaPanelOpen);
  const propertiesPanelOpen = useProjectStore((s) => s.propertiesPanelOpen);

  useEffect(
    () => () => {
      videoPlayerRef.current?.dispose();
      audioPlayerRef.current?.dispose();
    },
    [],
  );

  const handleFiles = async (files: File[]) => {
    const sorted = files
      .map((f) => ({ f, kind: detectKind(f) }))
      .filter((x): x is { f: File; kind: MediaKind } => x.kind !== null);
    if (sorted.length === 0) {
      setError(`Unsupported: ${files.map((f) => f.name).join(", ")}`);
      return;
    }
    setError(null);

    const videoFile = sorted.find((x) => x.kind === "video")?.f;
    const audioFile = sorted.find((x) => x.kind === "audio")?.f;

    videoPlayerRef.current?.dispose();
    audioPlayerRef.current?.dispose();
    videoPlayerRef.current = null;
    audioPlayerRef.current = null;

    if (videoFile) {
      // Add asset placeholder so the canvas mounts.
      const assetId = `asset-${Date.now()}-v`;
      addAsset({ id: assetId, kind: "video", name: videoFile.name, file: videoFile, durationSec: 0 });
      // Wait one paint so the canvas ref attaches.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      if (!canvasRef.current) {
        setError("Internal: canvas didn't mount");
        return;
      }

      const player = new WebCodecsPlayer(canvasRef.current, {
        onState: (s) => {
          if (s === "playing") setPlaying(true);
          else if (s === "paused" || s === "ended") setPlaying(false);
        },
        onTime: (t) => setCurrentTime(t),
        onError: (e) => setError(e.message),
        onConfigured: ({ hardwareAcceleration }) => setHardware(hardwareAcceleration),
      });
      videoPlayerRef.current = player;

      demuxMp4Streaming(videoFile, {
        onTrack: async (track, samples) => {
          updateAsset(assetId, {
            durationSec: track.durationSec,
            width: track.width,
            height: track.height,
            fps: track.fps,
            codec: track.codec,
          });
          addClipForAsset(assetId);
          try {
            await player.configure(track);
            player.attachRandomAccess(videoFile, samples);
          } catch (e: any) {
            setError(e.message ?? String(e));
          }
        },
        onSamples: (chunks) => {
          player.pushChunks(chunks);
        },
        onComplete: () => player.markComplete(),
        onError: (e) => setError(e.message),
      });
    }

    if (audioFile) {
      const assetId = `asset-${Date.now()}-a`;
      addAsset({ id: assetId, kind: "audio", name: audioFile.name, file: audioFile, durationSec: 0 });
      const ap = new AudioPlayer({
        onState: videoFile
          ? undefined // video drives transport when both present
          : (s) => {
              if (s === "playing") setPlaying(true);
              else if (s === "paused" || s === "ended") setPlaying(false);
            },
        onTime: videoFile ? undefined : (t) => setCurrentTime(t),
        onError: (e) => setError(e.message),
        onLoaded: ({ durationSec, sampleRate, channels }) => {
          updateAsset(assetId, { durationSec, sampleRate, channels });
          addClipForAsset(assetId);
        },
      });
      audioPlayerRef.current = ap;
      try {
        await ap.load(audioFile);
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    }
  };

  const togglePlay = () => {
    const v = videoPlayerRef.current;
    const a = audioPlayerRef.current;
    if (!v && !a) return;
    if (isPlaying) {
      v?.pause();
      a?.pause();
    } else {
      v?.play();
      a?.play();
    }
  };

  const onSeek = (sec: number) => {
    videoPlayerRef.current?.seek(sec);
    audioPlayerRef.current?.seek(sec);
    setCurrentTime(sec);
  };

  useKeyboardShortcuts({ onTogglePlay: togglePlay, onSeek });

  const openPicker = () => fileInputRef.current?.click();

  // Window-level drag-and-drop so the user can drop anywhere (matches CapCut).
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

  return (
    <div className="h-full flex flex-col">
      {isDragging && (
        <div className="fixed inset-0 z-50 pointer-events-none border-4 border-accent bg-accent/10 flex items-center justify-center">
          <div className="bg-surface-1 border border-accent rounded-xl px-8 py-6 text-text-primary font-medium">
            Drop to import
          </div>
        </div>
      )}

      <TopBar webcodecsAvailable={webcodecsAvailable} />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.mp4,.mov,.m4v,.wav,.mp3,.m4a,.aac,.flac,.ogg"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void handleFiles(files);
          e.target.value = "";
        }}
      />

      <div className="flex-1 flex min-h-0">
        {mediaPanelOpen && <MediaPanel onPick={openPicker} />}
        <PreviewArea ref={canvasRef} onPlayPause={togglePlay} onSeek={onSeek} />
        {propertiesPanelOpen && <PropertiesPanel engineHardware={hardware} />}
      </div>

      <Timeline />

      {error && (
        <div className="fixed bottom-4 right-4 max-w-md bg-red-950/80 border border-red-900 text-red-200 rounded-md px-4 py-2 text-sm shadow-xl">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-3 text-red-200/60 hover:text-red-200 text-xs underline"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
