import { Download, Home, PanelLeft, PanelRight } from "lucide-react";
import { useProjectStore } from "../store/projectStore";

export function TopBar({ webcodecsAvailable }: { webcodecsAvailable: boolean }) {
  const mediaPanelOpen = useProjectStore((s) => s.mediaPanelOpen);
  const propertiesPanelOpen = useProjectStore((s) => s.propertiesPanelOpen);
  const toggleMediaPanel = useProjectStore((s) => s.toggleMediaPanel);
  const toggleProperties = useProjectStore((s) => s.toggleProperties);

  return (
    <header
      role="banner"
      className="h-14 border-b border-border flex items-center px-3 sm:px-4 gap-2 sm:gap-3 bg-surface-0 shrink-0"
    >
      <button
        type="button"
        aria-label="Home"
        className="text-text-muted hover:text-text-primary p-2 rounded-md min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
      >
        <Home className="w-4 h-4" />
      </button>
      <div className="hidden sm:block h-5 w-px bg-border" />
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-semibold text-text-primary truncate">Vibe Editor</span>
        <span className="text-xs text-text-muted truncate hidden sm:inline">Untitled Project</span>
      </div>
      <div className="flex-1" />

      {/* Panel toggles — let the user reclaim center stage on smaller screens. */}
      <button
        type="button"
        onClick={toggleMediaPanel}
        aria-label={mediaPanelOpen ? "Hide media library" : "Show media library"}
        aria-pressed={mediaPanelOpen}
        className={`p-2 rounded-md min-w-[36px] min-h-[36px] inline-flex items-center justify-center ${
          mediaPanelOpen ? "text-text-primary bg-surface-2" : "text-text-muted hover:text-text-primary hover:bg-surface-2"
        }`}
      >
        <PanelLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={toggleProperties}
        aria-label={propertiesPanelOpen ? "Hide properties" : "Show properties"}
        aria-pressed={propertiesPanelOpen}
        className={`p-2 rounded-md min-w-[36px] min-h-[36px] inline-flex items-center justify-center ${
          propertiesPanelOpen ? "text-text-primary bg-surface-2" : "text-text-muted hover:text-text-primary hover:bg-surface-2"
        }`}
      >
        <PanelRight className="w-4 h-4" />
      </button>

      <div className="text-xs text-text-muted hidden lg:block ml-2" aria-live="polite">
        WebCodecs:{" "}
        <span className={webcodecsAvailable ? "text-emerald-400" : "text-red-400"}>
          {webcodecsAvailable ? "available" : "unavailable"}
        </span>
      </div>
      <button
        type="button"
        aria-label="Export project"
        className="ml-1 sm:ml-2 inline-flex items-center gap-1.5 rounded-md bg-accent/20 hover:bg-accent/30 border border-accent/40 px-3 py-2 text-sm text-text-primary min-h-[36px]"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Export</span>
      </button>
    </header>
  );
}
