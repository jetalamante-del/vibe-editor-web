import { useEffect } from "react";
import { useProjectStore } from "../store/projectStore";

interface Options {
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
}

const isEditableTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

/**
 * Editor keyboard shortcuts. Bound at window level so they fire from anywhere
 * except inside text inputs (we don't want Space to play/pause while the user
 * is typing in a future title field).
 */
export function useKeyboardShortcuts({ onTogglePlay, onSeek }: Options) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;

      // Space toggles playback.
      if (e.code === "Space" && !meta && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onTogglePlay();
        return;
      }
      // Esc clears selection / closes menus (menu close is handled in Timeline).
      if (e.key === "Escape") {
        useProjectStore.getState().selectClip(null);
        return;
      }
      // Cmd/Ctrl+A selects all clips.
      if (meta && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        useProjectStore.getState().selectAllClips();
        return;
      }
      // Cmd/Ctrl+G syncs selected clips (CapCut: align starts).
      if (meta && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        useProjectStore.getState().syncSelectedClips();
        return;
      }
      // Delete / Backspace removes selected clips.
      if ((e.key === "Delete" || e.key === "Backspace") && !meta) {
        if (useProjectStore.getState().selectedClipIds.length > 0) {
          e.preventDefault();
          useProjectStore.getState().removeSelectedClips();
        }
        return;
      }
      // Home / End: jump playhead.
      if (e.key === "Home") {
        e.preventDefault();
        onSeek(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        const { clips } = useProjectStore.getState();
        const end = clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
        onSeek(Math.max(0, end - 0.05));
        return;
      }
      // Arrow keys: nudge selected clips when present, otherwise scrub the playhead.
      const hasSelection = useProjectStore.getState().selectedClipIds.length > 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const big = e.shiftKey ? 1.0 : 1 / 30; // 1s with shift, otherwise ~one frame at 30fps
        if (hasSelection && !meta) {
          e.preventDefault();
          useProjectStore.getState().nudgeSelectedClips(dir * big);
        } else {
          e.preventDefault();
          const cur = useProjectStore.getState().currentTime;
          onSeek(Math.max(0, cur + dir * big));
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTogglePlay, onSeek]);
}
