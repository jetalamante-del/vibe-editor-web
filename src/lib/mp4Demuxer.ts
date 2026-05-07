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

/** Demux an entire MP4 file into the encoded chunks for the first video track. */
export async function demuxMp4(file: File): Promise<DemuxResult> {
  return new Promise<DemuxResult>((resolve, reject) => {
    const mp4box = createFile();
    let videoTrack: any = null;
    const chunks: DemuxedChunk[] = [];
    let expectedSamples = 0;

    mp4box.onError = (e: string) => reject(new Error(`mp4box: ${e}`));

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
      if (chunks.length >= expectedSamples) {
        const track: DemuxedTrack = {
          codec: videoTrack.codec,
          description: extractDescription(mp4box.getTrackById(videoTrack.id)),
          width: videoTrack.video.width,
          height: videoTrack.video.height,
          durationSec: videoTrack.duration / videoTrack.timescale,
          timescale: videoTrack.timescale,
          nbSamples: videoTrack.nb_samples,
          fps:
            videoTrack.nb_samples /
            (videoTrack.duration / videoTrack.timescale || 1),
        };
        chunks.sort((a, b) => a.timestamp - b.timestamp);
        resolve({ track, chunks });
      }
    };

    // mp4box reads the file as ArrayBuffers in order, with an explicit fileStart
    file.arrayBuffer().then((buf) => {
      const ab = buf as ArrayBuffer & { fileStart?: number };
      ab.fileStart = 0;
      mp4box.appendBuffer(ab);
      mp4box.flush();
    });
  });
}
