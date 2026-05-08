/**
 * Project state for the editor — imported media assets, timeline tracks,
 * clips placed on those tracks, and current playhead/transport status.
 *
 * Kept deliberately small for now (single project, video+audio only). When
 * we wire up real multi-track editing this is where Track and Clip arrays
 * grow into a fuller model.
 */
import { create } from "zustand";

export type MediaKind = "video" | "audio";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  /** Source File object — preserved so we can re-stream samples on demand. */
  file: File;
  durationSec: number;
  /** Video-only. */
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  /** Audio-only. */
  sampleRate?: number;
  channels?: number;
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  /** Timeline start, seconds. */
  startTime: number;
  /** Clip duration on the timeline, seconds. */
  duration: number;
  /** Source-time offset where the clip starts inside its asset, seconds. */
  trimIn: number;
}

export interface Track {
  id: string;
  kind: MediaKind;
  name: string;
}

interface ProjectState {
  assets: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  /** Active selection — supports multi-select for sync / batch ops. */
  selectedClipIds: string[];
  currentTime: number;
  isPlaying: boolean;
  /** Timeline zoom level (1 = 40 px/s baseline, 0.25..6 range). */
  timelineZoom: number;

  addAsset: (asset: MediaAsset) => void;
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void;
  addClipForAsset: (assetId: string) => void;
  selectClip: (id: string | null, additive?: boolean) => void;
  selectClips: (ids: string[]) => void;
  moveClip: (clipId: string, startTime: number) => void;
  nudgeSelectedClips: (deltaSec: number) => void;
  removeSelectedClips: () => void;
  selectAllClips: () => void;
  syncSelectedClips: () => void;
  setTimelineZoom: (z: number) => void;
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  reset: () => void;

  /** Layout: per-panel collapse state, persisted across reloads via localStorage. */
  mediaPanelOpen: boolean;
  propertiesPanelOpen: boolean;
  toggleMediaPanel: () => void;
  toggleProperties: () => void;
}

const ensureTrack = (state: ProjectState, kind: MediaKind): { tracks: Track[]; track: Track } => {
  const existing = state.tracks.find((t) => t.kind === kind);
  if (existing) return { tracks: state.tracks, track: existing };
  const track: Track = {
    id: `track-${kind}-${Date.now()}`,
    kind,
    name: kind === "video" ? "Video 1" : "Audio 1",
  };
  return { tracks: [...state.tracks, track], track };
};

const readPanelPref = (key: string, fallback: boolean): boolean => {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v === null) {
    // Below ~1024px the layout is too cramped to start with both panels open;
    // collapse the right panel by default on small screens.
    return window.innerWidth >= 1280 ? fallback : false;
  }
  return v === "1";
};

const writePanelPref = (key: string, value: boolean) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value ? "1" : "0");
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  assets: [],
  tracks: [],
  clips: [],
  selectedClipIds: [],
  currentTime: 0,
  isPlaying: false,
  timelineZoom: 1,
  mediaPanelOpen: readPanelPref("vibe.mediaPanelOpen", true),
  propertiesPanelOpen: readPanelPref("vibe.propertiesPanelOpen", true),

  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),

  updateAsset: (id, patch) =>
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

  addClipForAsset: (assetId) =>
    set((s) => {
      const asset = s.assets.find((a) => a.id === assetId);
      if (!asset) return s;
      const { tracks, track } = ensureTrack(s, asset.kind);
      const trackClips = s.clips.filter((c) => c.trackId === track.id);
      const startTime = trackClips.length === 0
        ? 0
        : Math.max(...trackClips.map((c) => c.startTime + c.duration));
      const clip: Clip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        assetId,
        trackId: track.id,
        startTime,
        duration: asset.durationSec,
        trimIn: 0,
      };
      return { tracks, clips: [...s.clips, clip], selectedClipIds: [clip.id] };
    }),

  selectClip: (id, additive) =>
    set((s) => {
      if (id === null) return { selectedClipIds: [] };
      if (additive) {
        return s.selectedClipIds.includes(id)
          ? { selectedClipIds: s.selectedClipIds.filter((x) => x !== id) }
          : { selectedClipIds: [...s.selectedClipIds, id] };
      }
      return { selectedClipIds: [id] };
    }),
  selectClips: (ids) => set({ selectedClipIds: ids }),

  moveClip: (clipId, startTime) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === clipId ? { ...c, startTime: Math.max(0, startTime) } : c,
      ),
    })),

  nudgeSelectedClips: (deltaSec) =>
    set((s) => ({
      clips: s.clips.map((c) =>
        s.selectedClipIds.includes(c.id)
          ? { ...c, startTime: Math.max(0, c.startTime + deltaSec) }
          : c,
      ),
    })),

  removeSelectedClips: () =>
    set((s) => ({
      clips: s.clips.filter((c) => !s.selectedClipIds.includes(c.id)),
      selectedClipIds: [],
    })),

  selectAllClips: () => set((s) => ({ selectedClipIds: s.clips.map((c) => c.id) })),

  /**
   * Align the start times of every selected clip to the earliest one. Same
   * "sync clips" workflow CapCut exposes via right-click — useful when you've
   * imported camera video + a separate audio recording and need them lined
   * up at zero (or anywhere else they were both rolling).
   */
  syncSelectedClips: () =>
    set((s) => {
      const selected = s.clips.filter((c) => s.selectedClipIds.includes(c.id));
      if (selected.length < 2) return s;
      const earliest = Math.min(...selected.map((c) => c.startTime));
      return {
        clips: s.clips.map((c) =>
          s.selectedClipIds.includes(c.id) ? { ...c, startTime: earliest } : c,
        ),
      };
    }),

  setTimelineZoom: (z) => set({ timelineZoom: Math.max(0.25, Math.min(6, z)) }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (p) => set({ isPlaying: p }),

  toggleMediaPanel: () =>
    set((s) => {
      const next = !s.mediaPanelOpen;
      writePanelPref("vibe.mediaPanelOpen", next);
      return { mediaPanelOpen: next };
    }),
  toggleProperties: () =>
    set((s) => {
      const next = !s.propertiesPanelOpen;
      writePanelPref("vibe.propertiesPanelOpen", next);
      return { propertiesPanelOpen: next };
    }),

  reset: () =>
    set({
      assets: [],
      tracks: [],
      clips: [],
      selectedClipIds: [],
      currentTime: 0,
      isPlaying: false,
      timelineZoom: 1,
    }),
}));

export const projectDuration = (s: { clips: Clip[] }) =>
  s.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
