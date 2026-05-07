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

  constructor(
    private canvas: HTMLCanvasElement,
    private cbs: PlayerCallbacks = {},
  ) {}

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
    this.frameQueue.push(frame);
    if (!this.playing && this.frameQueue.length === 1) {
      // Show the first decoded frame so the canvas isn't blank while paused.
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
      this.pumpDecoder();
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
   * Streaming demuxer doesn't preserve random access; this seek only works
   * within the currently-buffered range. Seeking back/forward beyond the
   * buffer needs the random-access demuxer (next iteration).
   */
  seek(sec: number) {
    this.currentSec = sec;
    this.cbs.onTime?.(this.currentSec);
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
  }

  get duration(): number {
    return this.track?.durationSec ?? 0;
  }
  get hardware(): string {
    return this.hardwareAcceleration;
  }
}
