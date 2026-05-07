import { useMemo } from "react";
import { Film, Music } from "lucide-react";
import { projectDuration, useProjectStore, type Clip, type Track } from "../store/projectStore";

const PIXELS_PER_SECOND = 40;

export function Timeline() {
  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const currentTime = useProjectStore((s) => s.currentTime);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectClip = useProjectStore((s) => s.selectClip);
  const duration = useProjectStore(projectDuration);
  const contentWidth = Math.max(800, Math.round((duration + 5) * PIXELS_PER_SECOND));

  const ticks = useMemo(() => {
    const out: number[] = [];
    const total = duration + 5;
    const step = total > 60 ? 5 : 1;
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  }, [duration]);

  return (
    <section className="h-64 shrink-0 bg-surface-0 border-t border-border flex flex-col min-h-0">
      <div className="h-9 border-b border-border px-3 flex items-center gap-3 text-xs text-text-muted">
        <span className="font-medium text-text-primary">Timeline</span>
        <span>· {tracks.length} tracks · {clips.length} clips · {duration.toFixed(2)}s</span>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-32 shrink-0 border-r border-border">
          <div className="h-7 border-b border-border" />
          {tracks.map((t) => (
            <div
              key={t.id}
              className="h-14 border-b border-border/60 px-3 flex items-center gap-2 text-xs text-text-muted"
            >
              {t.kind === "video" ? <Film className="w-3.5 h-3.5" /> : <Music className="w-3.5 h-3.5 text-accent" />}
              <span className="truncate">{t.name}</span>
            </div>
          ))}
          {tracks.length === 0 && (
            <p className="px-3 py-3 text-[11px] text-text-muted">No tracks yet</p>
          )}
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-hidden relative">
          <div style={{ width: contentWidth, position: "relative" }}>
            <div className="h-7 border-b border-border relative">
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 border-l border-border/40"
                  style={{ left: t * PIXELS_PER_SECOND }}
                >
                  <span className="text-[10px] text-text-muted ml-1 font-mono">
                    {Math.floor(t / 60)}:{String(t % 60).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>

            {tracks.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                clips={clips.filter((c) => c.trackId === t.id)}
                onSelect={selectClip}
                selectedId={selectedClipId}
                getAssetName={(id) => assets.find((a) => a.id === id)?.name ?? "Clip"}
              />
            ))}

            <div
              className="absolute top-0 bottom-0 w-px bg-accent z-20 pointer-events-none"
              style={{ left: currentTime * PIXELS_PER_SECOND }}
            >
              <div className="w-2 h-2 -ml-[3px] bg-accent rounded-sm" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackRow({
  track,
  clips,
  onSelect,
  selectedId,
  getAssetName,
}: {
  track: Track;
  clips: Clip[];
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  getAssetName: (id: string) => string;
}) {
  return (
    <div className="h-14 border-b border-border/60 relative">
      {clips.map((c) => {
        const left = c.startTime * PIXELS_PER_SECOND;
        const width = Math.max(20, c.duration * PIXELS_PER_SECOND);
        const selected = c.id === selectedId;
        const isVideo = track.kind === "video";
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`absolute top-1.5 bottom-1.5 rounded text-[11px] text-left px-2 truncate transition-colors ${
              isVideo
                ? "bg-cyan-900/60 border border-cyan-700/60 hover:bg-cyan-900/80"
                : "bg-emerald-900/60 border border-emerald-700/60 hover:bg-emerald-900/80"
            } ${selected ? "ring-2 ring-accent" : ""}`}
            style={{ left, width }}
            title={getAssetName(c.assetId)}
          >
            {getAssetName(c.assetId)}
          </button>
        );
      })}
    </div>
  );
}
