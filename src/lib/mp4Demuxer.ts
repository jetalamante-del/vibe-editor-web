/**
 * Streaming MP4/MOV demuxer with constant memory usage.
 *
 * Sony 4K captures put the moov box at the end of the file and routinely run
 * past 8 GB. The naive `mp4box.appendBuffer(file.arrayBuffer())` loads the
 * whole file into the heap; even chunked sequential streaming forces mp4box
 * to accumulate every byte until it sees the moov.
 *
 * This demuxer:
 *   1. Walks the file's top-level boxes via {@link findTopLevelBoxes} —
 *      header-only reads, O(N_boxes), works on multi-GB files.
 *   2. Feeds ftyp + moov to mp4box first so it can build the sample table
 *      regardless of where moov physically lives.
 *   3. Streams mdat to mp4box in 32 MB slices, calling
 *      `releaseUsedSamples` after each onSamples emit so mp4box discards
 *      bytes it has already handed off.
 *   4. Emits sample batches via the `onSamples` callback so the consumer
 *      can decode-and-drop instead of keeping every encoded chunk in JS.
 *
 * Total memory peak: ~32 MB scratch + the consumer's lookahead buffer.
 */
import { createFile, DataStream } from "mp4box";
import { findTopLevelBoxes } from "./mp4BoxScanner";

export interface DemuxedTrack {
  codec: string;
  description?: Uint8Array;
  width: number;
  height: number;
  durationSec: number;
  timescale: number;
  nbSamples: number;
  fps: number;
}

export interface DemuxedChunk {
  type: "key" | "delta";
  /** Composition timestamp, microseconds. */
  timestamp: number;
  /** Sample duration, microseconds. */
  duration: number;
  data: Uint8Array;
}

export interface StreamingCallbacks {
  /** Fires once after the moov is parsed and the codec info is known. */
  onTrack(track: DemuxedTrack): void;
  /** Fires every time mp4box hands off a batch of decoded samples. */
  onSamples(chunks: DemuxedChunk[]): void;
  /** 0..1 progress through the source file. */
  onProgress?(loaded: number, total: number): void;
  /** All samples have been emitted. */
  onComplete(): void;
  /** Demux failed. */
  onError(err: Error): void;
}

/** Build a WebCodecs-compatible avcC/hvcC description from a parsed trak. */
function extractDescription(trak: any): Uint8Array | undefined {
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // skip 8-byte box header
    }
  }
  return undefined;
}

/** Turn an mp4box Sample into our wire-friendly DemuxedChunk. */
function toChunk(s: any): DemuxedChunk {
  return {
    type: s.is_sync ? "key" : "delta",
    timestamp: (s.cts * 1_000_000) / s.timescale,
    duration: (s.duration * 1_000_000) / s.timescale,
    data: s.data,
  };
}

const MDAT_CHUNK = 32 * 1024 * 1024; // 32 MB

export interface DemuxHandle {
  /** Cancel the streaming demux. Idempotent. */
  abort(): void;
}

export function demuxMp4Streaming(file: File, cbs: StreamingCallbacks): DemuxHandle {
  let aborted = false;

  (async () => {
    try {
      console.log("[demux] scanning top-level boxes…");
      const boxes = await findTopLevelBoxes(file);
      console.log(
        "[demux] boxes:",
        boxes.map((b) => `${b.type}@${b.start}+${b.size}`).join(", "),
      );
      const ftyp = boxes.find((b) => b.type === "ftyp");
      const moov = boxes.find((b) => b.type === "moov");
      const mdats = boxes.filter((b) => b.type === "mdat");
      if (!moov) throw new Error(`MP4 has no moov box. Found: ${boxes.map((b) => b.type).join(", ") || "nothing"}`);
      if (mdats.length === 0) throw new Error("MP4 has no mdat box (no media data)");
      console.log(`[demux] moov @ ${moov.start} (${(moov.size / 1024).toFixed(1)} KB), mdats: ${mdats.length}, total mdat: ${(mdats.reduce((a, m) => a + m.size, 0) / 1024 / 1024).toFixed(1)} MB`);

      const mp4box = createFile();
      let videoTrack: any = null;
      let videoTrackId = -1;
      let lastEmittedSampleNumber = 0;
      let readyFired = false;

      mp4box.onError = (e: string) => {
        console.error("[demux] mp4box onError:", e);
        if (!aborted) cbs.onError(new Error(`mp4box: ${e}`));
      };

      mp4box.onReady = (info: any) => {
        readyFired = true;
        console.log("[demux] mp4box onReady — tracks:", info.tracks?.length, "video tracks:", info.videoTracks?.length);
        videoTrack = info.videoTracks?.[0];
        if (!videoTrack) {
          cbs.onError(new Error(`No video track in file. Tracks: ${info.tracks?.map((t: any) => `${t.codec}/${t.type}`).join(", ") || "none"}`));
          aborted = true;
          return;
        }
        console.log("[demux] selected video track:", videoTrack.codec, `${videoTrack.video?.width}×${videoTrack.video?.height}`, "samples:", videoTrack.nb_samples);
        videoTrackId = videoTrack.id;
        const trak = mp4box.getTrackById(videoTrackId);
        const track: DemuxedTrack = {
          codec: videoTrack.codec,
          description: extractDescription(trak),
          width: videoTrack.video.width,
          height: videoTrack.video.height,
          durationSec: videoTrack.duration / videoTrack.timescale,
          timescale: videoTrack.timescale,
          nbSamples: videoTrack.nb_samples,
          fps: videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale || 1),
        };
        cbs.onTrack(track);
        mp4box.setExtractionOptions(videoTrackId, null, { nbSamples: 200 });
        mp4box.start();
      };

      mp4box.onSamples = (_id: number, _user: unknown, samples: any[]) => {
        if (aborted || samples.length === 0) return;
        cbs.onSamples(samples.map(toChunk));
        // Tell mp4box we're done with these so it can drop the underlying bytes.
        const lastNum = samples[samples.length - 1].number;
        if (lastNum > lastEmittedSampleNumber) {
          lastEmittedSampleNumber = lastNum;
          mp4box.releaseUsedSamples(videoTrackId, lastNum);
        }
      };

      // 1) Feed ftyp (small, beginning) so mp4box knows what file it's looking at.
      if (ftyp) {
        const ab = (await file.slice(ftyp.start, ftyp.start + ftyp.size).arrayBuffer()) as ArrayBuffer & {
          fileStart?: number;
        };
        ab.fileStart = ftyp.start;
        mp4box.appendBuffer(ab);
        if (aborted) return;
      }

      // 2) Feed moov in one go — onReady fires here.
      console.log(`[demux] feeding moov to mp4box at fileStart=${moov.start} (${moov.size} bytes)`);
      const moovAb = (await file.slice(moov.start, moov.start + moov.size).arrayBuffer()) as ArrayBuffer & {
        fileStart?: number;
      };
      moovAb.fileStart = moov.start;
      mp4box.appendBuffer(moovAb);
      if (aborted) return;
      if (!readyFired) {
        console.warn(
          "[demux] mp4box did NOT fire onReady after receiving the moov box. This usually means mp4box couldn't find a recognizable trak inside moov, or expects boxes in a different order. Falling back to sequential append (entire file streamed in order).",
        );
        // Fall back: feed whole file in order. mp4box's release path still works.
        let pos = 0;
        const end = file.size;
        while (pos < end && !aborted) {
          const next = Math.min(pos + MDAT_CHUNK, end);
          const ab = (await file.slice(pos, next).arrayBuffer()) as ArrayBuffer & { fileStart?: number };
          ab.fileStart = pos;
          mp4box.appendBuffer(ab);
          pos = next;
          cbs.onProgress?.(pos, file.size);
          await new Promise<void>((r) => setTimeout(r, 0));
        }
        mp4box.flush();
        if (!aborted) cbs.onComplete();
        return;
      }

      // 3) Stream every mdat in 32 MB slices. mp4box parses samples in
      //    these ranges and fires onSamples. releaseUsedSamples lets it drop
      //    the bytes between iterations.
      const totalMdat = mdats.reduce((acc, m) => acc + m.size, 0);
      let mdatLoaded = 0;
      for (const mdat of mdats) {
        let pos = mdat.start;
        const end = mdat.start + mdat.size;
        while (pos < end) {
          if (aborted) return;
          const next = Math.min(pos + MDAT_CHUNK, end);
          const ab = (await file.slice(pos, next).arrayBuffer()) as ArrayBuffer & { fileStart?: number };
          ab.fileStart = pos;
          mp4box.appendBuffer(ab);
          mdatLoaded += ab.byteLength;
          pos = next;
          cbs.onProgress?.(mdatLoaded, totalMdat);
          // Yield so React can paint and the decoder can consume.
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
      mp4box.flush();
      if (!aborted) cbs.onComplete();
    } catch (e: any) {
      if (!aborted) cbs.onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    abort() {
      aborted = true;
    },
  };
}
