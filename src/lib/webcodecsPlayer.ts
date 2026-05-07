/**
 * Hardware-accelerated video player built on the WebCodecs API.
 *
 * - Uses `VideoDecoder` to push encoded chunks through the OS hardware decoder
 *   (VideoToolbox on macOS, Media Foundation on Windows, VAAPI on Linux).
 * - Renders decoded `VideoFrame`s to a 2D canvas.
 * - Maintains a small ring buffer so playback survives natural decode jitter.
 *
 * This intentionally keeps the API small: configure once, then `play`, `pause`,
 * `seek` against the timeline. Effects, compositing and audio sit at higher
 * layers and consume the same `VideoFrame` stream.
 */
import type { DemuxedChunk, DemuxedTrack } from "./mp4Demuxer";

export interface PlayerCallbacks {
  onTime?: (sec: number) => void;
  onState?: (state: "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error") => void;
  onError?: (err: Error) => void;
  onConfigured?: (config: { codec: string; hardwareAcceleration: string }) => void;
}

/** Frames decoded ahead of the playhead; trade-off between latency and smoothness. */
const TARGET_BUFFER = 30;

export class WebCodecsPlayer {
  private decoder: VideoDecoder | null = null;
  private track: DemuxedTrack | null = null;
  private chunks: DemuxedChunk[] = [];
  private nextChunkIdx = 0;
  private frameQueue: VideoFrame[] = [];
  private playing = false;
  private rafId: number | null = null;
  private playStartWallTime = 0;
  private playStartMediaSec = 0;
  private currentSec = 0;
  private hardwareAcceleration = "unknown";

  constructor(
    private canvas: HTMLCanvasElement,
    private cbs: PlayerCallbacks = {},
  ) {}

  async load(track: DemuxedTrack, chunks: DemuxedChunk[]) {
    this.cbs.onState?.("loading");
    this.dispose();
    this.track = track;
    this.chunks = chunks;
    this.canvas.width = track.width;
    this.canvas.height = track.height;

    this.decoder = new VideoDecoder({
      output: (frame) => this.onDecodedFrame(frame),
      error: (e) => {
        this.cbs.onError?.(e);
        this.cbs.onState?.("error");
      },
    });

    // Probe what the browser is willing to give us, prefer hardware.
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

    this.cbs.onConfigured?.({
      codec: track.codec,
      hardwareAcceleration: this.hardwareAcceleration,
    });

    // Pre-decode a few frames so play() starts smooth.
    this.pumpDecoder();
    this.cbs.onState?.("ready");
  }

  private pumpDecoder() {
    if (!this.decoder || this.decoder.state !== "configured") return;
    while (
      this.frameQueue.length + this.decoder.decodeQueueSize < TARGET_BUFFER &&
      this.nextChunkIdx < this.chunks.length
    ) {
      const c = this.chunks[this.nextChunkIdx++];
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
    // If we're paused at t=0 (just loaded), draw the first frame so the canvas isn't blank.
    if (!this.playing && this.frameQueue.length === 1) {
      this.drawFrame(this.frameQueue[0], false);
    }
  }

  private drawFrame(frame: VideoFrame, dropAfter: boolean) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    if (dropAfter) frame.close();
  }

  play() {
    if (!this.track || this.playing) return;
    this.playing = true;
    this.playStartWallTime = performance.now() / 1000;
    this.playStartMediaSec = this.currentSec;
    this.cbs.onState?.("playing");
    const tick = () => {
      if (!this.playing) return;
      const elapsed = performance.now() / 1000 - this.playStartWallTime;
      const targetMediaSec = this.playStartMediaSec + elapsed;
      this.currentSec = targetMediaSec;
      // Drop frames whose timestamp is well behind the target; render the closest one.
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
        this.nextChunkIdx >= this.chunks.length &&
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
   * Coarse seek: drops everything in flight, finds the keyframe at or before
   * the target, and re-decodes from there. Frame-accurate scrub will land in
   * the next iteration.
   */
  seek(sec: number) {
    if (!this.track || this.chunks.length === 0) return;
    this.pause();
    for (const f of this.frameQueue) f.close();
    this.frameQueue = [];
    this.decoder?.flush().catch(() => undefined);

    const targetUs = sec * 1_000_000;
    let keyIdx = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this.chunks[i].type === "key" && this.chunks[i].timestamp <= targetUs) {
        keyIdx = i;
        break;
      }
    }
    this.nextChunkIdx = keyIdx;
    this.currentSec = sec;
    this.pumpDecoder();
    this.cbs.onTime?.(this.currentSec);
  }

  dispose() {
    this.pause();
    for (const f of this.frameQueue) f.close();
    this.frameQueue = [];
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.nextChunkIdx = 0;
    this.currentSec = 0;
  }

  get duration(): number {
    return this.track?.durationSec ?? 0;
  }
  get hardware(): string {
    return this.hardwareAcceleration;
  }
}
