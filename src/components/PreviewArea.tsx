import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { forwardRef } from "react";
import { projectDuration, useProjectStore } from "../store/projectStore";
import { fmtPrecise as fmt } from "../lib/timecode";

interface Props {
  onPlayPause: () => void;
  /** Commit a seek — decoder flushes and re-feeds from the keyframe at sec. */
  onSeek: (sec: number) => void;
  /** Cheap update of the displayed time during a slider drag. No decoder work. */
  onScrubPreview?: (sec: number) => void;
  seekDisabled?: boolean;
  seekDisabledReason?: string;
}

export const PreviewArea = forwardRef<HTMLCanvasElement, Props>(function PreviewArea(
  { onPlayPause, onSeek, onScrubPreview, seekDisabled, seekDisabledReason },
  canvasRef,
) {
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const currentTime = useProjectStore((s) => s.currentTime);
  const duration = useProjectStore(projectDuration);
  const hasContent = useProjectStore((s) => s.assets.length > 0);
  const hasVideo = useProjectStore((s) => s.assets.some((a) => a.kind === "video"));

  return (
    <section
      aria-label="Preview"
      className="flex-1 flex flex-col min-w-0 bg-bg"
    >
      <div className="flex-1 flex items-center justify-center p-6 min-h-0 overflow-hidden">
        <div
          className="max-w-full max-h-full bg-black rounded-lg overflow-hidden shadow-2xl flex items-center justify-center relative"
          style={{ aspectRatio: "16 / 9" }}
        >
          {/* The canvas is always mounted so the player ref is stable. When
              there's no video asset, we lay an audio-only placeholder on top. */}
          <canvas
            ref={canvasRef}
            className={`w-full h-full object-contain ${hasVideo ? "" : "invisible"}`}
            aria-label="Video preview"
          />
          {!hasContent && (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm px-8 text-center">
              Drop video or audio onto the window to begin.
            </div>
          )}
          {hasContent && !hasVideo && <AudioPreviewPlaceholder />}
        </div>
      </div>

      <div
        role="toolbar"
        aria-label="Playback transport"
        className="border-t border-border bg-surface-0 px-4 py-3 flex items-center gap-3 shrink-0"
      >
        <button
          type="button"
          aria-label="Step one frame backward"
          aria-describedby="frame-step-help"
          className="p-2 rounded-md hover:bg-surface-2 text-text-muted disabled:opacity-30 min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
          disabled
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!hasContent}
          aria-label={isPlaying ? "Pause (Space)" : "Play (Space)"}
          aria-pressed={isPlaying}
          className="rounded-md bg-accent/20 hover:bg-accent/30 disabled:opacity-30 border border-accent/40 px-3 py-2 inline-flex items-center gap-1.5 text-sm min-h-[36px]"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          <span>{isPlaying ? "Pause" : "Play"}</span>
        </button>
        <button
          type="button"
          aria-label="Step one frame forward"
          aria-describedby="frame-step-help"
          className="p-2 rounded-md hover:bg-surface-2 text-text-muted disabled:opacity-30 min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
          disabled
        >
          <SkipForward className="w-4 h-4" />
        </button>
        <span id="frame-step-help" className="sr-only">
          Frame stepping is not yet implemented. Use the scrub slider or arrow keys.
        </span>

        <div
          className="text-xs font-mono text-text-muted min-w-[140px]"
          aria-live="off"
        >
          {fmt(currentTime)} / {fmt(duration)}
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={currentTime}
          // While the user drags, only update the displayed playhead — issuing
          // a real decoder seek per pointer move would flush the decoder
          // dozens of times per second and the user would see each
          // intermediate keyframe flash. Commit the seek on release.
          onChange={(e) => onScrubPreview?.(Number(e.target.value))}
          // Latch a scrubbing flag while the pointer is held so playback ticks
          // don't overwrite the slider value mid-drag.
          onPointerDown={() => useProjectStore.setState({ isScrubbing: true })}
          onPointerUp={(e) => {
            useProjectStore.setState({ isScrubbing: false });
            onSeek(Number((e.currentTarget as HTMLInputElement).value));
          }}
          onPointerCancel={() => useProjectStore.setState({ isScrubbing: false })}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(e.key)) {
              onSeek(Number((e.currentTarget as HTMLInputElement).value));
            }
          }}
          disabled={seekDisabled || !hasContent}
          aria-label="Playback position"
          aria-valuetext={fmt(currentTime)}
          className="editor-range flex-1"
        />
        {seekDisabled && seekDisabledReason && (
          <span className="text-[10px] text-warning/80 hidden lg:block">{seekDisabledReason}</span>
        )}
      </div>
    </section>
  );
});

/** Audio-only placeholder. Static bars stand in for a real waveform — once
 *  we decode the audio buffer we'll render samples here. */
function AudioPreviewPlaceholder() {
  const bars = 24;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-muted">
      <Music className="w-10 h-10 text-accent" aria-hidden />
      <div className="flex items-end gap-1 h-16" role="img" aria-label="Audio playback indicator">
        {Array.from({ length: bars }).map((_, i) => {
          const h = 25 + 60 * Math.abs(Math.sin((i / bars) * Math.PI * 2 + i));
          return (
            <span key={i} className="w-1 rounded-full bg-accent/50" style={{ height: `${h}%` }} />
          );
        })}
      </div>
      <p className="text-xs">Audio only · waveform rendering coming soon</p>
    </div>
  );
}
