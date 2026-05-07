/**
 * Hardware-accelerated audio player via Web Audio API.
 *
 * Unlike the `<audio>` element, `decodeAudioData` handles 24-bit/32-bit PCM
 * WAV, FLAC, Opus, and high-sample-rate files reliably across browsers. The
 * decoded buffer plays through `AudioBufferSourceNode` connected to the
 * default output destination.
 */
export interface AudioInfo {
  durationSec: number;
  sampleRate: number;
  channels: number;
}

export interface AudioPlayerCallbacks {
  onTime?: (sec: number) => void;
  onState?: (state: "idle" | "loading" | "ready" | "playing" | "paused" | "ended") => void;
  onError?: (err: Error) => void;
  onLoaded?: (info: AudioInfo) => void;
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playStartContextTime = 0;
  private playStartMediaSec = 0;
  private currentSec = 0;
  private playing = false;
  private rafId: number | null = null;

  constructor(private cbs: AudioPlayerCallbacks = {}) {}

  async load(file: File) {
    this.cbs.onState?.("loading");
    this.dispose();
    this.ctx = new AudioContext();
    const buf = await file.arrayBuffer();
    try {
      this.buffer = await this.ctx.decodeAudioData(buf);
    } catch (e) {
      this.cbs.onError?.(new Error(`decodeAudioData failed: ${e}`));
      return;
    }
    this.cbs.onLoaded?.({
      durationSec: this.buffer.duration,
      sampleRate: this.buffer.sampleRate,
      channels: this.buffer.numberOfChannels,
    });
    this.cbs.onState?.("ready");
  }

  play() {
    if (!this.ctx || !this.buffer || this.playing) return;
    // AudioContext starts in suspended state until a user gesture; resume()
    // is required for sound output in modern browsers.
    void this.ctx.resume();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.ctx.destination);
    this.source.start(0, this.currentSec);
    this.playStartContextTime = this.ctx.currentTime;
    this.playStartMediaSec = this.currentSec;
    this.playing = true;
    this.cbs.onState?.("playing");
    this.source.onended = () => {
      if (this.playing && this.currentSec >= this.buffer!.duration - 0.05) {
        this.playing = false;
        this.cbs.onState?.("ended");
      }
    };
    const tick = () => {
      if (!this.playing || !this.ctx || !this.buffer) return;
      const elapsed = this.ctx.currentTime - this.playStartContextTime;
      this.currentSec = this.playStartMediaSec + elapsed;
      this.cbs.onTime?.(this.currentSec);
      if (this.currentSec < this.buffer.duration) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing || !this.ctx) return;
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.cbs.onState?.("paused");
  }

  seek(sec: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.currentSec = Math.max(0, Math.min(this.buffer?.duration ?? 0, sec));
    this.cbs.onTime?.(this.currentSec);
    if (wasPlaying) this.play();
  }

  dispose() {
    this.pause();
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    this.buffer = null;
    this.currentSec = 0;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }
}
