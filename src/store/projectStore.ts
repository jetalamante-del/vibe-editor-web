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
  selectedClipId: string | null;
  currentTime: number;
  isPlaying: boolean;

  addAsset: (asset: MediaAsset) => void;
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void;
  addClipForAsset: (assetId: string) => void;
  selectClip: (id: string | null) => void;
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  reset: () => void;
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

export const useProjectStore = create<ProjectState>((set, get) => ({
  assets: [],
  tracks: [],
  clips: [],
  selectedClipId: null,
  currentTime: 0,
  isPlaying: false,

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
      return { tracks, clips: [...s.clips, clip], selectedClipId: clip.id };
    }),

  selectClip: (id) => set({ selectedClipId: id }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (p) => set({ isPlaying: p }),

  reset: () => set({ assets: [], tracks: [], clips: [], selectedClipId: null, currentTime: 0, isPlaying: false }),
}));

export const projectDuration = (s: { clips: Clip[] }) =>
  s.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
