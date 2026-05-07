import { Settings } from "lucide-react";
import { useProjectStore } from "../store/projectStore";

export function PropertiesPanel({ engineHardware }: { engineHardware: string | null }) {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const selectedClip = clips.find((c) => c.id === selectedClipId);
  const selectedAsset = selectedClip
    ? assets.find((a) => a.id === selectedClip.assetId)
    : null;

  return (
    <aside className="w-72 shrink-0 border-l border-border bg-surface-0 flex flex-col min-h-0">
      <div className="border-b border-border px-3 py-2.5 flex items-center gap-2">
        <Settings className="w-4 h-4 text-text-muted" />
        <span className="text-sm font-medium text-text-primary">Properties</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs min-h-0">
        {selectedAsset ? (
          <>
            <Section title="Source">
              <Field label="File" value={selectedAsset.name} />
              <Field label="Type" value={selectedAsset.kind} />
              {selectedAsset.codec && <Field label="Codec" value={selectedAsset.codec} />}
              {selectedAsset.width && (
                <Field label="Resolution" value={`${selectedAsset.width}×${selectedAsset.height}`} />
              )}
              {selectedAsset.fps && <Field label="FPS" value={selectedAsset.fps.toFixed(2)} />}
              {selectedAsset.sampleRate && (
                <Field label="Sample rate" value={`${selectedAsset.sampleRate} Hz`} />
              )}
              {selectedAsset.channels && (
                <Field label="Channels" value={String(selectedAsset.channels)} />
              )}
            </Section>
            <Section title="Clip">
              <Field label="Start" value={`${selectedClip!.startTime.toFixed(2)} s`} />
              <Field label="Duration" value={`${selectedClip!.duration.toFixed(2)} s`} />
              <Field label="Trim in" value={`${selectedClip!.trimIn.toFixed(2)} s`} />
            </Section>
          </>
        ) : (
          <p className="text-text-muted text-center pt-4">Select a clip to edit.</p>
        )}

        {engineHardware && (
          <Section title="Engine">
            <Field
              label="Hardware decode"
              value={engineHardware}
              highlight={engineHardware.includes("hardware") || engineHardware === "no-preference"}
            />
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">{title}</p>
      <div className="space-y-1.5 rounded-md bg-surface-1/60 border border-border/60 p-2.5">{children}</div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <span className={`font-mono truncate ${highlight ? "text-emerald-400" : "text-text-primary"}`}>{value}</span>
    </div>
  );
}
