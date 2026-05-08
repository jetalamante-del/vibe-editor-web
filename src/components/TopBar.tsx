import { Download, Home } from "lucide-react";

export function TopBar({ webcodecsAvailable }: { webcodecsAvailable: boolean }) {
  return (
    <header
      role="banner"
      className="h-14 border-b border-border flex items-center px-4 gap-3 bg-surface-0 shrink-0"
    >
      <button
        type="button"
        aria-label="Home"
        className="text-text-muted hover:text-text-primary p-2 rounded-md min-w-[36px] min-h-[36px] inline-flex items-center justify-center"
      >
        <Home className="w-4 h-4" />
      </button>
      <div className="h-5 w-px bg-border" />
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-text-primary">Vibe Editor</span>
        <span className="text-xs text-text-muted">Untitled Project</span>
      </div>
      <div className="flex-1" />
      <div className="text-xs text-text-muted hidden md:block" aria-live="polite">
        WebCodecs:{" "}
        <span className={webcodecsAvailable ? "text-emerald-400" : "text-red-400"}>
          {webcodecsAvailable ? "available" : "unavailable"}
        </span>
      </div>
      <button
        type="button"
        aria-label="Export project"
        className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-accent/20 hover:bg-accent/30 border border-accent/40 px-3 py-2 text-sm text-text-primary min-h-[36px]"
      >
        <Download className="w-4 h-4" />
        Export
      </button>
    </header>
  );
}
