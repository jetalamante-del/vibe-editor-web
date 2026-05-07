/**
 * Hardware-accelerated streaming video player.
 *
 * Designed to work with the streaming demuxer ({@link demuxMp4Streaming}) so
 * that arbitrarily large source files don't force the encoded data to live
 * in memory. The player keeps a small ring buffer of pending encoded chunks
 * and a small queue of decoded frames; everything earlier than the playhead
 * is closed and dropped.
 *
 * Memory profile: ~LOOKAHEAD_FRAMES decoded VideoFrames + a few hundred
 * encoded chunks waiting for the decoder. Total a few tens of MB regardless
 * of source duration.
 */
import type { DemuxedChunk, DemuxedTrack } from "./mp4Demuxer";
import { findSyncSampleAtOrBefore, type Sample } from "./mp4SampleTable";

export interface PlayerCallbacks {
  onTime?: (sec: number) => void;
  onState?: (state: PlayerState) => void;
  onError?: (err: Error) => void;
  onConfigured?: (config: { codec: string; hardwareAcceleration: string }) => void;
}

export type PlayerState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

const LOOKAHEAD_FRAMES = 30;
const PENDING_CHUNK_CAP = 600; // ~20 s at 30 fps; backpressure for the demuxer

export class WebCodecsPlayer {
  private decoder: VideoDecoder | null = null;
  private track: DemuxedTrack | null = null;
  /** Encoded chunks waiting to be fed to the decoder. */
  private pending: DemuxedChunk[] = [];
  /** Decoded frames waiting to be rendered. */
  private frameQueue: VideoFrame[] = [];
  private streamComplete = false;
  private playing = false;
  private rafId: number | null = null;
  private playStartWallTime = 0;
  private playStartMediaSec = 0;
  private currentSec = 0;
  private hardwareAcceleration = "unknown";
  /** Set after configure() succeeds. */
  private configured = false;
  /** Random-access source — set when the demuxer hands us a sample table. */
  private sourceFile: File | null = null;
  private sampleTable: Sample[] = [];
  /** Index of the next sample we'd serve for sequential playback after seek. */
  private seekFeedIdx = -1;
  /** Microsecond target for the most recent seek, used to skip-decode. */
  private seekTargetUs = -1;
  /** Generation counter so stale frames decoded before the latest seek are dropped. */
  private decodeGeneration = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private cbs: PlayerCallbacks = {},
  ) {}

  /** Tell the player which file + sample table to use for random-access seeks. */
  attachRandomAccess(file: File, samples: Sample[]) {
    this.sourceFile = file;
    this.sampleTable = samples;
  }

  async configure(track: DemuxedTrack) {
    this.dispose();
    this.track = track;
    this.canvas.width = track.width;
    this.canvas.height = track.height;

    this.decoder = new VideoDecoder({
      output: (frame) => this.onDecodedFrame(frame),
      error: (e) => {
        console.error("[player] decoder error", e);
        this.cbs.onError?.(e);
        this.cbs.onState?.("error");
      },
    });

    const support = await VideoDecoder.isConfigSupported({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
      description: track.description,
      hardwareAcceleration: "prefer-hardware",
    });
    if (!support.supported) {
      throw new Error(`Codec not supported by this browser: ${track.codec}`);
    }
    this.hardwareAcceleration = support.config?.hardwareAcceleration ?? "unknown";

    this.decoder.configure({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
      description: track.description,
      hardwareAcceleration: "prefer-hardware",
    });
    this.configured = true;
    this.cbs.onConfigured?.({ codec: track.codec, hardwareAcceleration: this.hardwareAcceleration });
    this.cbs.onState?.("loading");
  }

  /**
   * Push a batch of encoded chunks delivered by the demuxer. Returns true if
   * the player wants more right now, false if the consumer should pause —
   * implements backpressure when the decoder/buffer can't keep up.
   */
  pushChunks(chunks: DemuxedChunk[]): boolean {
    this.pending.push(...chunks);
    this.pumpDecoder();
    if (this.pending.length === 0 && this.frameQueue.length > 0 && !this.playing) {
      // First frames available; surface them.
      this.cbs.onState?.("ready");
    }
    return this.pending.length < PENDING_CHUNK_CAP;
  }

  /** Demuxer signals end-of-stream. */
  markComplete() {
    this.streamComplete = true;
  }

  private pumpDecoder() {
    if (!this.decoder || this.decoder.state !== "configured") return;
    while (
      this.pending.length > 0 &&
      this.frameQueue.length + this.decoder.decodeQueueSize < LOOKAHEAD_FRAMES
    ) {
      const c = this.pending.shift()!;
      this.decoder.decode(
        new EncodedVideoChunk({
          type: c.type,
          timestamp: c.timestamp,
          duration: c.duration,
          data: c.data,
        }),
      );
    }
  }

  private onDecodedFrame(frame: VideoFrame) {
    // After a seek, frames whose cts is before the seek target are decoded
    // only to satisfy reference dependencies — drop them silently.
    if (this.seekTargetUs >= 0) {
      const cts = frame.timestamp ?? 0;
      if (cts + 1000 < this.seekTargetUs) {
        frame.close();
        return;
      }
      // First frame at or after the target — render it and clear the marker.
      this.seekTargetUs = -1;
      this.drawFrame(frame, false);
      this.frameQueue.push(frame);
      this.cbs.onState?.("ready");
      return;
    }
    this.frameQueue.push(frame);
    if (!this.playing && this.frameQueue.length === 1) {
      this.drawFrame(this.frameQueue[0], false);
      this.cbs.onState?.("ready");
    }
  }

  private drawFrame(frame: VideoFrame, dropAfter: boolean) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    if (dropAfter) frame.close();
  }

  play() {
    if (!this.track || this.playing || !this.configured) return;
    this.playing = true;
    this.playStartWallTime = performance.now() / 1000;
    this.playStartMediaSec = this.currentSec;
    this.cbs.onState?.("playing");
    const tick = () => {
      if (!this.playing) return;
      const elapsed = performance.now() / 1000 - this.playStartWallTime;
      const targetMediaSec = this.playStartMediaSec + elapsed;
      this.currentSec = targetMediaSec;
      let chosen: VideoFrame | null = null;
      while (this.frameQueue.length > 0) {
        const head = this.frameQueue[0];
        const headSec = (head.timestamp ?? 0) / 1_000_000;
        if (headSec <= targetMediaSec + 1 / 60) {
          if (chosen) chosen.close();
          chosen = this.frameQueue.shift()!;
        } else break;
      }
      if (chosen) this.drawFrame(chosen, true);
      this.cbs.onTime?.(this.currentSec);
      // After a random-access seek we drive the decoder ourselves from the
      // sample table — fetch more samples ahead of the playhead.
      if (this.seekFeedIdx >= 0 && this.seekFeedIdx < this.sampleTable.length) {
        if (this.frameQueue.length + (this.decoder?.decodeQueueSize ?? 0) < LOOKAHEAD_FRAMES) {
          void this.feedNextRange(LOOKAHEAD_FRAMES);
        }
      } else {
        this.pumpDecoder();
      }
      if (
        this.streamComplete &&
        this.pending.length === 0 &&
        this.frameQueue.length === 0 &&
        this.decoder?.decodeQueueSize === 0
      ) {
        this.playing = false;
        this.cbs.onState?.("ended");
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.cbs.onState?.("paused");
  }

  /**
   * Random-access seek. Locates the latest keyframe at or before `sec` in
   * the sample table, slices the source file from that keyframe forward,
   * and feeds the resulting EncodedVideoChunks to the decoder. Frames whose
   * cts falls before the seek target are decoded but not displayed (they're
   * needed to satisfy reference dependencies before the target frame).
   *
   * Falls back to setting currentTime if no sample table is attached
   * (e.g. seek arrives before the moov has been parsed).
   */
  async seek(sec: number) {
    if (!this.sourceFile || this.sampleTable.length === 0 || !this.decoder) {
      // No random-access yet — record the time so playback resumes there once
      // streaming catches up. Slider still updates.
      this.currentSec = Math.max(0, sec);
      this.cbs.onTime?.(this.currentSec);
      return;
    }

    const wasPlaying = this.playing;
    this.pause();

    const targetUs = Math.max(0, sec) * 1_000_000;
    const keyIdx = findSyncSampleAtOrBefore(this.sampleTable, targetUs);
    this.seekTargetUs = targetUs;
    this.seekFeedIdx = keyIdx;
    this.currentSec = sec;
    this.cbs.onTime?.(this.currentSec);

    // Drop in-flight frames + reset decoder so we don't render past content
    // before the new keyframe lands.
    for (const f of this.frameQueue) f.close();
    this.frameQueue = [];
    this.pending = [];
    this.decodeGeneration++;
    try {
      await this.decoder.flush();
    } catch {
      /* flush after seek can throw; ignore */
    }

    // Pre-feed roughly LOOKAHEAD_FRAMES samples starting at the keyframe.
    await this.feedNextRange(LOOKAHEAD_FRAMES);

    if (wasPlaying) this.play();
  }

  /**
   * Slice `count` samples from the source file starting at seekFeedIdx and
   * push them through the decoder. Bytes are released as soon as the decode
   * call accepts them (the underlying ArrayBuffer is owned by EncodedVideoChunk).
   */
  private async feedNextRange(count: number) {
    if (!this.sourceFile || !this.decoder) return;
    const start = this.seekFeedIdx;
    const end = Math.min(start + count, this.sampleTable.length);
    if (start < 0 || start >= this.sampleTable.length) return;

    // Coalesce contiguous samples into a single file.slice call to amortize
    // the cost of slicing — most consecutive samples are stored back-to-back.
    let groupStart = start;
    while (groupStart < end) {
      let groupEnd = groupStart + 1;
      while (
        groupEnd < end &&
        this.sampleTable[groupEnd].offset ===
          this.sampleTable[groupEnd - 1].offset + this.sampleTable[groupEnd - 1].size
      ) {
        groupEnd++;
      }
      const fileStart = this.sampleTable[groupStart].offset;
      const last = this.sampleTable[groupEnd - 1];
      const fileEnd = last.offset + last.size;
      const ab = await this.sourceFile.slice(fileStart, fileEnd).arrayBuffer();
      let cursor = 0;
      for (let i = groupStart; i < groupEnd; i++) {
        const s = this.sampleTable[i];
        const slice = new Uint8Array(ab, cursor, s.size);
        cursor += s.size;
        if (this.decoder.state !== "configured") return;
        this.decoder.decode(
          new EncodedVideoChunk({
            type: s.isSync ? "key" : "delta",
            timestamp: s.cts,
            duration: s.duration,
            data: slice,
          }),
        );
      }
      groupStart = groupEnd;
    }
    this.seekFeedIdx = end;
  }

  dispose() {
    this.pause();
    for (const f of this.frameQueue) f.close();
    this.frameQueue = [];
    this.pending = [];
    this.streamComplete = false;
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.configured = false;
    this.currentSec = 0;
    this.sourceFile = null;
    this.sampleTable = [];
    this.seekFeedIdx = -1;
    this.seekTargetUs = -1;
  }

  get duration(): number {
    return this.track?.durationSec ?? 0;
  }
  get hardware(): string {
    return this.hardwareAcceleration;
  }
}
