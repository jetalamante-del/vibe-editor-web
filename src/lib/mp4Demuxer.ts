/**
 * Thin wrapper around mp4box.js for parsing MP4/MOV containers and extracting
 * encoded video chunks suitable for WebCodecs VideoDecoder.
 *
 * Why we need this: a `<video>` element handles container parsing internally
 * but doesn't expose the encoded samples. WebCodecs VideoDecoder works on
 * encoded chunks directly, so we have to demux the container ourselves to
 * pull (and order) the access units before feeding them to the decoder.
 */
// mp4box exposes named exports — `createFile` to create the parser and
// `DataStream` for serializing avcC/hvcC boxes back into bytes.
import { createFile, DataStream } from "mp4box";

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
  timestamp: number; // microseconds
  duration: number; // microseconds
  data: Uint8Array;
}

export interface DemuxResult {
  track: DemuxedTrack;
  chunks: DemuxedChunk[];
}

/** Build a WebCodecs-compatible avcC/hvcC description from a track. */
function extractDescription(track: any): Uint8Array | undefined {
  for (const entry of track.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // skip the 8-byte box header
    }
  }
  return undefined;
}

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB

/**
 * Demux an MP4 file into encoded chunks for the first video track.
 *
 * Streams the file in 16 MB slices instead of `file.arrayBuffer()`, so a
 * multi-GB source doesn't blow up the heap. mp4box parses incrementally;
 * `onReady` fires as soon as the moov is available, and `onSamples` arrives
 * in batches as more bytes are appended.
 */
export async function demuxMp4(file: File, onProgress?: (loaded: number, total: number) => void): Promise<DemuxResult> {
  return new Promise<DemuxResult>((resolve, reject) => {
    const mp4box = createFile();
    let videoTrack: any = null;
    const chunks: DemuxedChunk[] = [];
    let expectedSamples = 0;
    let resolved = false;

    const tryFinish = () => {
      if (resolved) return;
      if (videoTrack && chunks.length >= expectedSamples) {
        resolved = true;
        const track: DemuxedTrack = {
          codec: videoTrack.codec,
          description: extractDescription(mp4box.getTrackById(videoTrack.id)),
          width: videoTrack.video.width,
          height: videoTrack.video.height,
          durationSec: videoTrack.duration / videoTrack.timescale,
          timescale: videoTrack.timescale,
          nbSamples: videoTrack.nb_samples,
          fps: videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale || 1),
        };
        chunks.sort((a, b) => a.timestamp - b.timestamp);
        resolve({ track, chunks });
      }
    };

    mp4box.onError = (e: string) => {
      if (!resolved) reject(new Error(`mp4box: ${e}`));
    };

    mp4box.onReady = (info: any) => {
      videoTrack = info.videoTracks?.[0];
      if (!videoTrack) {
        reject(new Error("No video track in file"));
        return;
      }
      expectedSamples = videoTrack.nb_samples;
      mp4box.setExtractionOptions(videoTrack.id, null, { nbSamples: 1000 });
      mp4box.start();
    };

    mp4box.onSamples = (_id: number, _user: unknown, samples: any[]) => {
      for (const s of samples) {
        chunks.push({
          type: s.is_sync ? "key" : "delta",
          timestamp: (s.cts * 1_000_000) / s.timescale,
          duration: (s.duration * 1_000_000) / s.timescale,
          data: s.data,
        });
      }
      tryFinish();
    };

    // Stream the file in slices. Each appendBuffer can synchronously fire
    // onReady/onSamples, so progress is reported between slices.
    (async () => {
      try {
        let offset = 0;
        while (offset < file.size && !resolved) {
          const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
          const ab = (await slice.arrayBuffer()) as ArrayBuffer & { fileStart?: number };
          ab.fileStart = offset;
          mp4box.appendBuffer(ab);
          offset += ab.byteLength;
          onProgress?.(offset, file.size);
          // Yield so React can paint progress between large slices.
          await new Promise<void>((r) => setTimeout(r, 0));
        }
        if (!resolved) {
          mp4box.flush();
          tryFinish();
          if (!resolved) {
            reject(new Error(`Demux finished but only got ${chunks.length}/${expectedSamples} samples`));
          }
        }
      } catch (e) {
        reject(e);
      }
    })();
  });
}
