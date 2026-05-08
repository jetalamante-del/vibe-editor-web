import { Film, Music, Plus, Upload } from "lucide-react";
import { useProjectStore, type MediaAsset } from "../store/projectStore";

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function MediaPanel({ onPick }: { onPick: () => void }) {
  const assets = useProjectStore((s) => s.assets);
  const addClip = useProjectStore((s) => s.addClipForAsset);

  return (
    <aside
      aria-label="Media library"
      className="w-72 shrink-0 border-r border-border bg-surface-0 flex flex-col min-h-0"
    >
      <div className="border-b border-border">
        <div role="tablist" aria-label="Media categories" className="flex">
          <TabButton active>Media</TabButton>
          <TabButton>Audio</TabButton>
          <TabButton>Text</TabButton>
        </div>
      </div>

      <div className="p-3">
        <button
          onClick={onPick}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-dashed border-border hover:border-accent/60 bg-surface-1/40 px-3 py-2.5 text-sm text-text-primary transition-colors"
        >
          <Upload className="w-4 h-4 text-text-muted" />
          Import Media
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 min-h-0">
        {assets.length === 0 ? (
          <p className="text-xs text-text-muted text-center pt-4">
            Drop video or audio anywhere, or click Import.
          </p>
        ) : (
          assets.map((a) => <AssetCard key={a.id} asset={a} onAdd={() => addClip(a.id)} />)
        )}
      </div>
    </aside>
  );
}

function TabButton({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`px-3 py-2 text-sm transition-colors min-h-[36px] ${
        active
          ? "text-text-primary border-b-2 border-accent"
          : "text-text-muted hover:text-text-primary border-b-2 border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function AssetCard({ asset, onAdd }: { asset: MediaAsset; onAdd: () => void }) {
  return (
    <div className="group relative rounded-md border border-border bg-surface-1 overflow-hidden">
      <div className="aspect-video bg-black flex items-center justify-center">
        {asset.kind === "video" ? (
          <Film className="w-8 h-8 text-text-muted" />
        ) : (
          <Music className="w-8 h-8 text-accent" />
        )}
        {asset.durationSec > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-white font-mono">
            {fmt(asset.durationSec)}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 flex items-center gap-2">
        <p className="text-xs text-text-primary truncate flex-1">{asset.name}</p>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add ${asset.name} to timeline`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-2 rounded bg-accent/20 hover:bg-accent/30 border border-accent/40 min-w-[28px] min-h-[28px] inline-flex items-center justify-center"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
