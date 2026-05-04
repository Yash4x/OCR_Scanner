"use client";

import { cn } from "@/lib/utils";
import type { ComparisonLineChangeType } from "@/lib/types";

export interface PaperHighlight {
  id: string;
  comparison_span_id: string;
  comparison_line_id: string;
  linked_span_group: string | null;
  side: "old" | "new";
  page_number: number;
  line_id: string | null;
  line_number: number | null;
  section_title: string | null;
  change_type: ComparisonLineChangeType;
  span_text: string;
  text: string;
  old_text: string | null;
  new_text: string | null;
  source_type: "word_diff" | "line_fallback" | "ai_aligned_span" | "estimated_line_fallback";
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  short_summary: string | null;
  old_meaning: string | null;
  new_meaning: string | null;
  practical_impact: string | null;
  risk_level: "low" | "medium" | "high" | null;
  confidence: number | null;
  word_ids: string[] | null;
  is_word_box: boolean;
}

const labelByType: Record<ComparisonLineChangeType, string> = {
  unchanged: "Unchanged",
  modified: "Modified",
  added: "Added",
  removed: "Removed",
  formatting_only: "Formatting only",
  moved: "Moved",
};

function isUsableHighlightBox(highlight: PaperHighlight): boolean {
  return normalizeHighlightBox(highlight) !== null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHighlightBox(highlight: PaperHighlight) {
  const bbox = highlight.bbox;

  if (!Number.isFinite(bbox.left) || !Number.isFinite(bbox.top) || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
    return null;
  }

  if (bbox.width <= 0 || bbox.height <= 0) return null;

  const left = clamp(bbox.left, 0, 0.995);
  const top = clamp(bbox.top, 0, 0.995);
  const right = clamp(bbox.left + bbox.width, left + 0.005, 1);
  const bottom = clamp(bbox.top + bbox.height, top + 0.005, 1);
  const width = clamp(right - left, 0.005, 1 - left);
  const height = clamp(bottom - top, 0.005, 1 - top);

  if (width <= 0 || height <= 0) return null;

  const area = width * height;
  if (area > 0.35) return null;

  return { left, top, width, height };
}

function previewText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "(empty)";
  }

  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export function HighlightOverlay({
  highlights,
  selectedHighlightId,
  selectedLinkedSpanGroup,
  pulseHighlightId,
  pulseLinkedSpanGroup,
  onHighlightClick,
}: {
  highlights: PaperHighlight[];
  selectedHighlightId: string | null;
  selectedLinkedSpanGroup?: string | null;
  pulseHighlightId: string | null;
  pulseLinkedSpanGroup?: string | null;
  onHighlightClick: (highlight: PaperHighlight) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {highlights.map((highlight) => {
        if (!isUsableHighlightBox(highlight)) {
          return null;
        }
        const box = normalizeHighlightBox(highlight);

        if (!box) {
          return null;
        }

        const isSelected = selectedHighlightId === highlight.id || (selectedLinkedSpanGroup && highlight.linked_span_group === selectedLinkedSpanGroup);
        const shouldPulse = pulseHighlightId === highlight.id || (pulseLinkedSpanGroup && highlight.linked_span_group === pulseLinkedSpanGroup);

        return (
          <button
            key={highlight.id}
            type="button"
            data-highlight-id={highlight.id}
            onClick={() => onHighlightClick(highlight)}
            title={`${labelByType[highlight.change_type]}: ${previewText(highlight.text)}`}
            className={cn(
              "comparison-highlight",
              highlight.change_type,
              isSelected && "selected",
              shouldPulse && "pulse",
            )}
            style={{
              left: `${box.left * 100}%`,
              top: `${box.top * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
