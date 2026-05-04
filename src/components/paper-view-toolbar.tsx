"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JumpToChangeDropdown } from "@/components/jump-to-change-dropdown";
import type { ComparisonLineChangeType } from "@/lib/types";
import type { PaperHighlight } from "@/components/highlight-overlay";

export type PaperFilter = "all" | Exclude<ComparisonLineChangeType, "unchanged">;

const changeFilterOptions: Array<{ value: PaperFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "modified", label: "Modified" },
  { value: "added", label: "Added" },
  { value: "removed", label: "Removed" },
  { value: "formatting_only", label: "Formatting only" },
  { value: "moved", label: "Moved" },
];

export function PaperViewToolbar({
  comparisonId,
  pageNumber,
  maxPage,
  zoom,
  filter,
  showChangedOnly,
  debugMode,
  jumpableHighlights,
  onPageChange,
  onZoomIn,
  onZoomOut,
  onFitToWidth,
  onToggleShowChangedOnly,
  onFilterChange,
  onToggleDebugMode,
  onJump,
}: {
  comparisonId: string;
  pageNumber: number;
  maxPage: number;
  zoom: number;
  filter: PaperFilter;
  showChangedOnly: boolean;
  debugMode: boolean;
  jumpableHighlights: PaperHighlight[];
  onPageChange: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToWidth: () => void;
  onToggleShowChangedOnly: () => void;
  onFilterChange: (nextFilter: PaperFilter) => void;
  onToggleDebugMode: () => void;
  onJump: (highlightId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href={`/compare/${comparisonId}`}>Back to comparison</Link>
        </Button>

        <label className="text-xs uppercase tracking-wide text-slate-500">Page</label>
        <select
          value={pageNumber}
          onChange={(event) => onPageChange(Number(event.target.value))}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {Array.from({ length: maxPage }, (_, index) => index + 1).map((page) => (
            <option key={page} value={page}>
              {page}
            </option>
          ))}
        </select>

        <Button type="button" size="sm" variant="outline" onClick={() => onPageChange(pageNumber - 1)} disabled={pageNumber <= 1}>
          Previous page
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPageChange(pageNumber + 1)}
          disabled={pageNumber >= maxPage}
        >
          Next page
        </Button>

        <Button type="button" size="sm" variant="outline" onClick={onZoomOut}>
          Zoom out
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onZoomIn}>
          Zoom in
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onFitToWidth}>
          Fit to width
        </Button>

        <Button type="button" size="sm" variant={showChangedOnly ? "default" : "outline"} onClick={onToggleShowChangedOnly}>
          Show changed only
        </Button>

        <Button type="button" size="sm" variant={debugMode ? "default" : "outline"} onClick={onToggleDebugMode}>
          Debug mode
        </Button>

        <label className="text-xs uppercase tracking-wide text-slate-500">Filter</label>
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as PaperFilter)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {changeFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <JumpToChangeDropdown highlights={jumpableHighlights} onJump={onJump} />

        <Button asChild size="sm" variant="secondary">
          <Link href={`/compare/${comparisonId}#text-diff`}>Open Text Diff</Link>
        </Button>

        <span className="ml-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
          Zoom {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
