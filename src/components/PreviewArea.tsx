import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { forwardRef } from "react";
import { projectDuration, useProjectStore } from "../store/projectStore";

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

interface Props {
  onPlayPause: () => void;
  onSeek: (sec: number) => void;
  seekDisabled?: boolean;
  seekDisabledReason?: string;
}

export const PreviewArea = forwardRef<HTMLCanvasElement, Props>(function PreviewArea(
  { onPlayPause, onSeek, seekDisabled, seekDisabledReason },
  canvasRef,
) {
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const currentTime = useProjectStore((s) => s.currentTime);
  const duration = useProjectStore(projectDuration);
  const hasContent = useProjectStore((s) => s.assets.length > 0);

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-bg">
      <div className="flex-1 flex items-center justify-center p-6 min-h-0 overflow-hidden">
        <div className="max-w-full max-h-full bg-black rounded-lg overflow-hidden shadow-2xl flex items-center justify-center" style={{ aspectRatio: "16 / 9" }}>
          {hasContent ? (
            <canvas ref={canvasRef} className="w-full h-full object-contain" />
          ) : (
            <div className="text-text-muted text-sm px-8 text-center">
              Drop video or audio onto the window to begin.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-surface-0 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          className="p-1.5 rounded hover:bg-surface-2 text-text-muted disabled:opacity-30"
          disabled
          title="Frame back (coming soon)"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={onPlayPause}
          disabled={!hasContent}
          className="rounded-md bg-accent/20 hover:bg-accent/30 disabled:opacity-30 border border-accent/40 px-3 py-1.5 inline-flex items-center gap-1.5 text-sm"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          className="p-1.5 rounded hover:bg-surface-2 text-text-muted disabled:opacity-30"
          disabled
          title="Frame forward (coming soon)"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <div className="text-xs font-mono text-text-muted min-w-[140px]">
          {fmt(currentTime)} / {fmt(duration)}
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={seekDisabled || !hasContent}
          className="flex-1 accent-cyan-400 disabled:opacity-40"
          title={seekDisabled ? seekDisabledReason : undefined}
        />
        {seekDisabled && seekDisabledReason && (
          <span className="text-[10px] text-amber-400/80 hidden lg:block">{seekDisabledReason}</span>
        )}
      </div>
    </section>
  );
});
