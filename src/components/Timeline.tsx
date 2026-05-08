import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Music } from "lucide-react";
import { projectDuration, useProjectStore, type Clip, type Track } from "../store/projectStore";

const BASE_PIXELS_PER_SECOND = 40;

interface DragState {
  clipId: string;
  pointerStartX: number;
  startTimeAtPointerDown: number;
}

interface ContextMenu {
  x: number;
  y: number;
  clipId: string | null;
}

/** Marquee rectangle in *content* coordinates (relative to scrollable area). */
interface Marquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
}

/** Track row Y bounds inside the scrollable content area. */
const RULER_H = 28;
const TRACK_H = 56;
const CLIP_INNER_PAD_Y = 6;

export function Timeline() {
  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const currentTime = useProjectStore((s) => s.currentTime);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const selectClip = useProjectStore((s) => s.selectClip);
  const selectClips = useProjectStore((s) => s.selectClips);
  const moveClip = useProjectStore((s) => s.moveClip);
  const syncSelected = useProjectStore((s) => s.syncSelectedClips);
  const zoom = useProjectStore((s) => s.timelineZoom);
  const setZoom = useProjectStore((s) => s.setTimelineZoom);
  const duration = useProjectStore(projectDuration);

  const pps = BASE_PIXELS_PER_SECOND * zoom;
  const contentWidth = Math.max(800, Math.round((duration + 5) * pps));

  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);

  // Pinch-to-zoom + Cmd/Ctrl+wheel on the timeline. The trackpad pinch gesture
  // arrives as a wheel event with ctrlKey set on macOS. Anchor the zoom to
  // the cursor's time position so the moment under the pointer stays put.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorXContent = cursorX + container.scrollLeft;
    const timeAtCursor = cursorXContent / Math.max(1, pps);
    const factor = Math.exp(-e.deltaY * 0.01);
    const next = Math.max(0.25, Math.min(6, zoom * factor));
    if (next === zoom) return;
    setZoom(next);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const newPps = BASE_PIXELS_PER_SECOND * next;
      scrollRef.current.scrollLeft = Math.max(0, timeAtCursor * newPps - cursorX);
    });
  };

  // Global pointer-up + pointer-move for clip dragging. Listen at window
  // level so the drag survives the cursor leaving the clip rectangle.
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - drag.pointerStartX;
      const dt = dx / pps;
      moveClip(drag.clipId, drag.startTimeAtPointerDown + dt);
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, pps, moveClip]);

  /**
   * Marquee selection — click + drag in empty timeline space to box-select.
   * Standard editor behavior: drag replaces selection, shift-drag adds to it.
   * Coordinates are tracked in *content* space (relative to the scrollable
   * div's content), not viewport, so the box stays correct while scrolling.
   */
  useEffect(() => {
    if (!marquee) return;
    const onMove = (ev: PointerEvent) => {
      const container = scrollRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left + container.scrollLeft;
      const y = ev.clientY - rect.top + container.scrollTop;
      setMarquee((m) => (m ? { ...m, currentX: x, currentY: y } : null));
    };
    const onUp = () => {
      const x1 = Math.min(marquee.startX, marquee.currentX);
      const x2 = Math.max(marquee.startX, marquee.currentX);
      const y1 = Math.min(marquee.startY, marquee.currentY);
      const y2 = Math.max(marquee.startY, marquee.currentY);

      const intersected: string[] = [];
      // Treat zero-area drags as a deselect-by-click on empty.
      if (x2 - x1 > 2 || y2 - y1 > 2) {
        for (const clip of clips) {
          const trackIdx = tracks.findIndex((t) => t.id === clip.trackId);
          if (trackIdx < 0) continue;
          const cTop = RULER_H + trackIdx * TRACK_H + CLIP_INNER_PAD_Y;
          const cBottom = RULER_H + (trackIdx + 1) * TRACK_H - CLIP_INNER_PAD_Y;
          const cLeft = clip.startTime * pps;
          const cRight = cLeft + Math.max(20, clip.duration * pps);
          const overlaps = !(x2 < cLeft || x1 > cRight || y2 < cTop || y1 > cBottom);
          if (overlaps) intersected.push(clip.id);
        }
      }

      if (marquee.additive) {
        const merged = Array.from(new Set([...selectedClipIds, ...intersected]));
        selectClips(merged);
      } else {
        selectClips(intersected);
      }
      setMarquee(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [marquee, clips, tracks, pps, selectedClipIds, selectClips]);

  /** Pointer-down on the scrollable content. Starts a marquee unless the
   *  pointer landed on a clip (data-clip-id) — those bubble their own drag. */
  const onContentPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-clip-id]")) return;
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top + container.scrollTop;
    setMarquee({ startX: x, startY: y, currentX: x, currentY: y, additive: e.shiftKey || e.metaKey });
  };

  // Dismiss the right-click menu on any outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const total = duration + 5;
    const step = pps < 30 ? 10 : pps < 80 ? 5 : pps < 200 ? 1 : 0.5;
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  }, [duration, pps]);

  return (
    <section className="h-64 shrink-0 bg-surface-0 border-t border-border flex flex-col min-h-0">
      <div className="h-9 border-b border-border px-3 flex items-center gap-3 text-xs text-text-muted">
        <span className="font-medium text-text-primary">Timeline</span>
        <span>· {tracks.length} tracks · {clips.length} clips · {duration.toFixed(2)}s</span>
        <div className="flex-1" />
        <span className="text-[10px]">Cmd/Ctrl + scroll to zoom · {(zoom * 100).toFixed(0)}%</span>
        <button
          onClick={() => setZoom(Math.max(0.25, zoom / 1.25))}
          className="px-1.5 py-0.5 rounded hover:bg-surface-2 text-text-muted"
        >
          –
        </button>
        <button
          onClick={() => setZoom(Math.min(6, zoom * 1.25))}
          className="px-1.5 py-0.5 rounded hover:bg-surface-2 text-text-muted"
        >
          +
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-32 shrink-0 border-r border-border">
          <div className="h-7 border-b border-border" />
          {tracks.map((t) => (
            <div
              key={t.id}
              className="h-14 border-b border-border/60 px-3 flex items-center gap-2 text-xs text-text-muted"
            >
              {t.kind === "video" ? (
                <Film className="w-3.5 h-3.5" />
              ) : (
                <Music className="w-3.5 h-3.5 text-accent" />
              )}
              <span className="truncate">{t.name}</span>
            </div>
          ))}
          {tracks.length === 0 && (
            <p className="px-3 py-3 text-[11px] text-text-muted">No tracks yet</p>
          )}
        </div>

        <div
          ref={scrollRef}
          onWheel={onWheel}
          onPointerDown={onContentPointerDown}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
        >
          <div style={{ width: contentWidth, position: "relative" }}>
            <div className="h-7 border-b border-border relative">
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 border-l border-border/40"
                  style={{ left: t * pps }}
                >
                  <span className="text-[10px] text-text-muted ml-1 font-mono">
                    {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>

            {tracks.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                clips={clips.filter((c) => c.trackId === t.id)}
                pps={pps}
                selectedIds={selectedClipIds}
                onClipPointerDown={(clipId, ev) => {
                  selectClip(clipId, ev.shiftKey || ev.metaKey);
                  setDrag({
                    clipId,
                    pointerStartX: ev.clientX,
                    startTimeAtPointerDown: clips.find((c) => c.id === clipId)?.startTime ?? 0,
                  });
                }}
                onClipContextMenu={(clipId, ev) => {
                  if (!selectedClipIds.includes(clipId)) selectClip(clipId, false);
                  setMenu({ x: ev.clientX, y: ev.clientY, clipId });
                }}
                getAssetName={(id) => assets.find((a) => a.id === id)?.name ?? "Clip"}
              />
            ))}

            <div
              className="absolute top-0 bottom-0 w-px bg-accent z-20 pointer-events-none"
              style={{ left: currentTime * pps }}
            >
              <div className="w-2 h-2 -ml-[3px] bg-accent rounded-sm" />
            </div>

            {marquee && (
              <div
                className="absolute bg-accent/15 border border-accent/70 pointer-events-none z-30"
                style={{
                  left: Math.min(marquee.startX, marquee.currentX),
                  top: Math.min(marquee.startY, marquee.currentY),
                  width: Math.abs(marquee.currentX - marquee.startX),
                  height: Math.abs(marquee.currentY - marquee.startY),
                }}
              />
            )}
          </div>
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 bg-surface-1 border border-border rounded-md shadow-xl py-1 text-sm min-w-[200px]"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <MenuItem
            disabled={selectedClipIds.length < 2}
            onClick={() => {
              syncSelected();
              setMenu(null);
            }}
          >
            Sync selected clips
            {selectedClipIds.length < 2 && (
              <span className="ml-auto text-[10px] text-text-muted">select 2+</span>
            )}
          </MenuItem>
          <MenuItem
            onClick={() => {
              moveClip(menu.clipId, 0);
              setMenu(null);
            }}
          >
            Move to start
          </MenuItem>
        </div>
      )}
    </section>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className="w-full text-left px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent flex items-center gap-2"
    >
      {children}
    </button>
  );
}

function TrackRow({
  track,
  clips,
  pps,
  selectedIds,
  onClipPointerDown,
  onClipContextMenu,
  getAssetName,
}: {
  track: Track;
  clips: Clip[];
  pps: number;
  selectedIds: string[];
  onClipPointerDown: (clipId: string, ev: React.PointerEvent) => void;
  onClipContextMenu: (clipId: string, ev: React.MouseEvent) => void;
  getAssetName: (id: string) => string;
}) {
  return (
    <div className="h-14 border-b border-border/60 relative">
      {clips.map((c) => {
        const left = c.startTime * pps;
        const width = Math.max(20, c.duration * pps);
        const selected = selectedIds.includes(c.id);
        const isVideo = track.kind === "video";
        return (
          <div
            key={c.id}
            data-clip-id={c.id}
            onPointerDown={(e) => onClipPointerDown(c.id, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              onClipContextMenu(c.id, e);
            }}
            className={`absolute top-1.5 bottom-1.5 rounded text-[11px] text-left px-2 truncate cursor-grab select-none transition-colors ${
              isVideo
                ? "bg-cyan-900/60 border border-cyan-700/60 hover:bg-cyan-900/80"
                : "bg-emerald-900/60 border border-emerald-700/60 hover:bg-emerald-900/80"
            } ${selected ? "ring-2 ring-accent" : ""}`}
            style={{ left, width }}
            title={`${getAssetName(c.assetId)} — right-click for options · shift-click to multi-select`}
          >
            {getAssetName(c.assetId)}
          </div>
        );
      })}
    </div>
  );
}
