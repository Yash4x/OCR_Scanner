"use client";

import type { PaperHighlight } from "@/components/highlight-overlay";

const labels: Record<PaperHighlight["change_type"], string> = {
  unchanged: "Unchanged",
  modified: "Modified",
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  formatting_only: "Formatting only",
};

export function JumpToChangeDropdown({
  highlights,
  onJump,
}: {
  highlights: PaperHighlight[];
  onJump: (highlightId: string) => void;
}) {
  const groupedHighlights = Array.from(
    highlights.reduce<Map<string, PaperHighlight>>((groups, highlight) => {
      const key = highlight.linked_span_group ?? highlight.id;
      if (!groups.has(key)) {
        groups.set(key, highlight);
      }
      return groups;
    }, new Map()).values(),
  );

  return (
    <select
      onChange={(event) => {
        const value = event.target.value;
        if (value) {
          onJump(value);
          event.currentTarget.value = "";
        }
      }}
      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
      defaultValue=""
    >
      <option value="" disabled>
        Jump to change
      </option>
      {groupedHighlights.map((highlight) => (
        <option key={highlight.id} value={highlight.id}>
          {`Page ${highlight.page_number} • ${labels[highlight.change_type]} • ${highlight.section_title ?? "No section"} • ${highlight.span_text || highlight.text}`}
        </option>
      ))}
    </select>
  );
}
