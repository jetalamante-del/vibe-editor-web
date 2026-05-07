/**
 * Build a flat sample table from an mp4box-parsed `trak` so that any sample
 * can be addressed (file offset + size + timestamp + sync flag) without
 * keeping mp4box's internal byte buffers around.
 *
 * This unlocks random-access playback: seek finds the latest keyframe at or
 * before the target timestamp, slices `file.slice(sample.offset, +size)` for
 * each sample we need, and pushes them straight into VideoDecoder. mp4box
 * only ever sees the moov bytes — never the gigabytes of mdat.
 *
 * Algorithm follows ISO/IEC 14496-12 §8.6 (sample table boxes):
 *   stco/co64 → chunk byte offsets
 *   stsc      → samples-per-chunk pattern
 *   stsz      → sample sizes
 *   stts      → decode-time deltas
 *   ctts      → composition-time offsets (optional)
 *   stss      → sync samples (optional; if absent every sample is a sync)
 */
export interface Sample {
  /** 1-based sample number, matching MP4 spec. */
  number: number;
  /** Absolute byte offset in the source file. */
  offset: number;
  /** Encoded byte size. */
  size: number;
  /** Decode time, microseconds. */
  dts: number;
  /** Composition time, microseconds. */
  cts: number;
  /** Sample duration, microseconds. */
  duration: number;
  /** Whether this sample can be decoded without earlier samples. */
  isSync: boolean;
}

interface StblLike {
  stbl: any;
  mdhd: { timescale: number };
}

/** Walk the boxes inside an mp4box trak object and produce a flat sample list. */
export function buildSampleTable(trak: any): Sample[] {
  const stbl: any = trak?.mdia?.minf?.stbl;
  const mdhd = trak?.mdia?.mdhd;
  if (!stbl || !mdhd) throw new Error("buildSampleTable: trak missing stbl or mdhd");

  const timescale: number = mdhd.timescale;

  // chunk_offsets is provided by either stco (32-bit) or co64 (64-bit).
  const chunkOffsets: number[] | undefined =
    stbl.stco?.chunk_offsets ?? stbl.co64?.chunk_offsets;
  if (!chunkOffsets) throw new Error("buildSampleTable: no stco/co64");

  const stsc: Array<{ first_chunk: number; samples_per_chunk: number }> = stbl.stsc?.entries ?? [];
  if (stsc.length === 0) throw new Error("buildSampleTable: no stsc entries");

  const sttsEntries: Array<{ sample_count: number; sample_delta: number }> = stbl.stts?.entries ?? [];
  if (sttsEntries.length === 0) throw new Error("buildSampleTable: no stts entries");

  const cttsEntries: Array<{ sample_count: number; sample_offset: number }> | null =
    stbl.ctts?.entries ?? null;

  const stss: number[] | null = stbl.stss?.sample_numbers ?? null;
  const syncSet = stss ? new Set<number>(stss) : null;
  const isSyncFn = syncSet ? (n: number) => syncSet.has(n) : () => true;

  // stsz: either uniform sample_size, or per-sample sample_sizes[].
  const sampleSize: number = stbl.stsz?.sample_size ?? 0;
  const sampleSizes: number[] = stbl.stsz?.sample_sizes ?? [];
  const totalSamples: number =
    stbl.stsz?.sample_count ?? (sampleSizes.length || 0);
  if (totalSamples === 0) throw new Error("buildSampleTable: zero samples");
  const sizeOf = sampleSize > 0 ? () => sampleSize : (idx0: number) => sampleSizes[idx0] ?? 0;

  // Expand stsc into a per-chunk samples_per_chunk lookup.
  const chunkCount = chunkOffsets.length;
  const samplesPerChunk = new Int32Array(chunkCount);
  for (let i = 0; i < stsc.length; i++) {
    const startC = stsc[i].first_chunk - 1;
    const endC = i + 1 < stsc.length ? stsc[i + 1].first_chunk - 1 : chunkCount;
    for (let c = startC; c < endC; c++) samplesPerChunk[c] = stsc[i].samples_per_chunk;
  }

  // Pre-compute per-sample dts/cts/duration in source timescale units.
  const dtsTs = new Float64Array(totalSamples);
  const cumDuration = new Float64Array(totalSamples);
  {
    let cum = 0;
    let s = 0;
    for (const e of sttsEntries) {
      const d = e.sample_delta;
      for (let i = 0; i < e.sample_count && s < totalSamples; i++, s++) {
        dtsTs[s] = cum;
        cumDuration[s] = d;
        cum += d;
      }
    }
    // Fill any tail (defensive).
    for (; s < totalSamples; s++) {
      dtsTs[s] = cum;
      cumDuration[s] = 0;
    }
  }

  const ctsTs = new Float64Array(totalSamples);
  if (cttsEntries) {
    let s = 0;
    for (const e of cttsEntries) {
      for (let i = 0; i < e.sample_count && s < totalSamples; i++, s++) {
        ctsTs[s] = dtsTs[s] + e.sample_offset;
      }
    }
    for (; s < totalSamples; s++) ctsTs[s] = dtsTs[s];
  } else {
    ctsTs.set(dtsTs);
  }

  const samples: Sample[] = new Array(totalSamples);
  let sampleIdx = 0;
  for (let c = 0; c < chunkCount && sampleIdx < totalSamples; c++) {
    let pos = chunkOffsets[c];
    const count = samplesPerChunk[c];
    for (let i = 0; i < count && sampleIdx < totalSamples; i++) {
      const size = sizeOf(sampleIdx);
      samples[sampleIdx] = {
        number: sampleIdx + 1,
        offset: pos,
        size,
        dts: (dtsTs[sampleIdx] * 1_000_000) / timescale,
        cts: (ctsTs[sampleIdx] * 1_000_000) / timescale,
        duration: (cumDuration[sampleIdx] * 1_000_000) / timescale,
        isSync: isSyncFn(sampleIdx + 1),
      };
      pos += size;
      sampleIdx++;
    }
  }

  return samples;
}

/** Index of the latest sync sample at or before `cts`. */
export function findSyncSampleAtOrBefore(samples: Sample[], cts: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].cts <= cts) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Walk backward to the nearest sync sample.
  while (idx > 0 && !samples[idx].isSync) idx--;
  return idx;
}

void undefined as unknown as StblLike;
