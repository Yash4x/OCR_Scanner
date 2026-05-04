"use client";

import { useMemo, useState, useEffect } from "react";
import { ChangeExplanationDrawer } from "@/components/change-explanation-drawer";
import { DocumentPagePanel, type PaperPageImage } from "@/components/document-page-panel";
import { PaperViewToolbar, type PaperFilter } from "@/components/paper-view-toolbar";
import type { PaperHighlight } from "@/components/highlight-overlay";
import type { SpanDiagnosticInfo } from "@/lib/span-diagnostics";

function sortHighlights(highlights: PaperHighlight[]) {
  return highlights.slice().sort((left, right) => {
    if (left.page_number !== right.page_number) {
      return left.page_number - right.page_number;
    }

    const leftLine = left.line_number ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.line_number ?? Number.MAX_SAFE_INTEGER;

    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }

    return left.id.localeCompare(right.id);
  });
}

export function PaperComparisonView({
  comparisonId,
  oldPages,
  newPages,
  highlights,
  missingLocationItems,
  spanDiagnostics,
  diagnosticsMeta,
}: {
  comparisonId: string;
  oldPages: PaperPageImage[];
  newPages: PaperPageImage[];
  highlights: PaperHighlight[];
  missingLocationItems: Array<{ comparison_line_id: string; page_number: number | null; line_number: number | null; change_type: string; reason: string }>;
  spanDiagnostics?: Record<string, SpanDiagnosticInfo>;
  diagnosticsMeta?: {
    spansAttempted: number;
    spansInserted: number;
    insertError: string | null;
    skippedReasons: Record<string, number>;
  };
}) {
  const maxPage = useMemo(() => {
    const oldMax = oldPages.reduce((max, page) => Math.max(max, page.page_number), 1);
    const newMax = newPages.reduce((max, page) => Math.max(max, page.page_number), 1);
    return Math.max(oldMax, newMax, 1);
  }, [newPages, oldPages]);

  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitToWidth, setFitToWidth] = useState(true);
  const [showChangedOnly, setShowChangedOnly] = useState(true);
  const [filter, setFilter] = useState<PaperFilter>("all");
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [pulseHighlightId, setPulseHighlightId] = useState<string | null>(null);
  const [pulseLinkedSpanGroup, setPulseLinkedSpanGroup] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [showAllSpans, setShowAllSpans] = useState(false);
  const [showFallbackHighlights, setShowFallbackHighlights] = useState(true);

  const triggerPulse = (highlightId: string, linkedSpanGroup: string | null) => {
    setPulseHighlightId(highlightId);
    setPulseLinkedSpanGroup(linkedSpanGroup);
    setTimeout(() => {
      setPulseHighlightId((current) => (current === highlightId ? null : current));
      setPulseLinkedSpanGroup((current) => (current === linkedSpanGroup ? null : current));
    }, 1000);
  };

  const visibleHighlights = useMemo(() => {
    return sortHighlights(
      highlights.filter((item) => {
        const matchesFilter = filter === "all" ? true : item.change_type === filter;
        const changedPredicate = showChangedOnly ? item.change_type !== "unchanged" : true;
        return matchesFilter && changedPredicate;
      }),
    );
  }, [filter, highlights, showChangedOnly]);

  const pageHighlights = useMemo(() => visibleHighlights.filter((item) => item.page_number === pageNumber), [pageNumber, visibleHighlights]);

  const oldPage = useMemo(
    () => oldPages.find((page) => page.page_number === pageNumber) ?? null,
    [oldPages, pageNumber],
  );
  const newPage = useMemo(
    () => newPages.find((page) => page.page_number === pageNumber) ?? null,
    [newPages, pageNumber],
  );

  const oldHighlights = pageHighlights.filter((item) => item.side === "old");
  const newHighlights = pageHighlights.filter((item) => item.side === "new");

  const selected = useMemo(
    () => visibleHighlights.find((item) => item.id === selectedHighlightId) ?? null,
    [selectedHighlightId, visibleHighlights],
  );

  const selectedDiagnostic = useMemo(() => {
    if (!selected || !spanDiagnostics) return null;
    return spanDiagnostics[selected.id] ?? null;
  }, [selected, spanDiagnostics]);

  const selectedLinkedSpanGroup = selected?.linked_span_group ?? null;

  const selectedIndex = useMemo(
    () => (selected ? visibleHighlights.findIndex((item) => item.id === selected.id) : -1),
    [selected, visibleHighlights],
  );

  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < visibleHighlights.length - 1;

  const jumpToHighlight = (highlightId: string) => {
    const target = visibleHighlights.find((item) => item.id === highlightId);
    if (!target) {
      return;
    }

    setPageNumber(target.page_number);
    setSelectedHighlightId(target.id);
    triggerPulse(target.id, target.linked_span_group ?? null);
  };

  // debugging: log spans and counts for current page
  useEffect(() => {
    console.log("[paper-view] selected page", pageNumber);
    console.log("[paper-view] total spans loaded", highlights.length);
    console.log("[paper-view] page spans (old)", oldHighlights.length);
    console.log("[paper-view] page spans (new)", newHighlights.length);
  }, [pageNumber, highlights, oldHighlights.length, newHighlights.length]);

  const diagnostics = useMemo(() => {
    const groupedLineIds = new Set<string>();
    const sourceCounts = {
      word_diff: 0,
      line_fallback: 0,
      ai_aligned_span: 0,
      estimated_line_fallback: 0,
    } as Record<string, number>;

    for (const highlight of visibleHighlights) {
      if (highlight.comparison_line_id) {
        groupedLineIds.add(highlight.comparison_line_id);
      }

      sourceCounts[highlight.source_type] += 1;
    }

    return {
      changedLineCount: groupedLineIds.size + missingLocationItems.length,
      spanCount: visibleHighlights.length,
      spansAttempted: diagnosticsMeta?.spansAttempted ?? groupedLineIds.size + missingLocationItems.length,
      spansInserted: diagnosticsMeta?.spansInserted ?? visibleHighlights.length,
      insertError: diagnosticsMeta?.insertError ?? null,
      sourceCounts,
      skippedCount: missingLocationItems.length,
      skippedReasons: diagnosticsMeta?.skippedReasons ?? {},
    };
  }, [diagnosticsMeta, missingLocationItems.length, visibleHighlights]);

  return (
    <div className="space-y-4">
      <PaperViewToolbar
        comparisonId={comparisonId}
        pageNumber={pageNumber}
        maxPage={maxPage}
        zoom={zoom}
        filter={filter}
        showChangedOnly={showChangedOnly}
        debugMode={debugMode}
        jumpableHighlights={visibleHighlights.filter((item) => item.change_type !== "unchanged")}
        onPageChange={(page) => setPageNumber(Math.min(maxPage, Math.max(1, page)))}
        onZoomIn={() => {
          setFitToWidth(false);
          setZoom((current) => Math.min(3, Number((current + 0.1).toFixed(2))));
        }}
        onZoomOut={() => {
          setFitToWidth(false);
          setZoom((current) => Math.max(0.5, Number((current - 0.1).toFixed(2))));
        }}
        onFitToWidth={() => {
          setFitToWidth(true);
          setZoom(1);
        }}
        onToggleShowChangedOnly={() => setShowChangedOnly((current) => !current)}
        onFilterChange={setFilter}
        onToggleDebugMode={() => setDebugMode((current) => !current)}
        onJump={jumpToHighlight}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_360px]">
        <DocumentPagePanel
          title="Old Document"
          side="old"
          page={oldPage}
          highlights={oldHighlights}
          zoom={zoom}
          fitToWidth={fitToWidth}
          selectedHighlightId={selectedHighlightId}
          selectedLinkedSpanGroup={selectedLinkedSpanGroup}
          pulseHighlightId={pulseHighlightId}
          pulseLinkedSpanGroup={pulseLinkedSpanGroup}
          debugMode={debugMode}
          onHighlightClick={(highlight) => {
            setSelectedHighlightId(highlight.id);
            setPageNumber(highlight.page_number);
            triggerPulse(highlight.id, highlight.linked_span_group ?? null);
          }}
        />

        <DocumentPagePanel
          title="New Document"
          side="new"
          page={newPage}
          highlights={newHighlights}
          zoom={zoom}
          fitToWidth={fitToWidth}
          selectedHighlightId={selectedHighlightId}
          selectedLinkedSpanGroup={selectedLinkedSpanGroup}
          pulseHighlightId={pulseHighlightId}
          pulseLinkedSpanGroup={pulseLinkedSpanGroup}
          debugMode={debugMode}
          onHighlightClick={(highlight) => {
            setSelectedHighlightId(highlight.id);
            setPageNumber(highlight.page_number);
            triggerPulse(highlight.id, highlight.linked_span_group ?? null);
          }}
        />

        <ChangeExplanationDrawer
          selected={selected}
          diagnostic={selectedDiagnostic}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onPrevious={() => {
            if (!hasPrevious) return;
            jumpToHighlight(visibleHighlights[selectedIndex - 1].id);
          }}
          onNext={() => {
            if (!hasNext) return;
            jumpToHighlight(visibleHighlights[selectedIndex + 1].id);
          }}
        />
      </div>

      <details className="rounded-xl border border-slate-200 bg-white/95 shadow-sm" open={debugMode}>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
          Paper Highlight Diagnostics
        </summary>
        <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>Changed lines: {diagnostics.changedLineCount}</div>
            <div>Spans attempted: {diagnostics.spansAttempted}</div>
            <div>Spans inserted: {diagnostics.spansInserted}</div>
            <div>Spans generated: {diagnostics.spanCount}</div>
            <div>Skipped changes: {diagnostics.skippedCount}</div>
            <div>Word diff: {diagnostics.sourceCounts.word_diff}</div>
            <div>AI aligned: {diagnostics.sourceCounts.ai_aligned_span}</div>
            <div>Line fallback: {diagnostics.sourceCounts.line_fallback}</div>
            <div>Estimated fallback: {diagnostics.sourceCounts.estimated_line_fallback ?? 0}</div>
          </div>
          <div className="mt-2 text-sm">
            Insert error: {diagnostics.insertError ?? "none"}
          </div>
          <div className="mt-2 text-sm">
            Skipped reasons: {Object.keys(diagnostics.skippedReasons).length > 0
              ? Object.entries(diagnostics.skippedReasons).map(([k, v]) => `${k}:${v}`).join(" | ")
              : "none"}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAllSpans} onChange={() => setShowAllSpans((c) => !c)} />
              Show all generated spans
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showFallbackHighlights} onChange={() => setShowFallbackHighlights((c) => !c)} />
              Show fallback highlights
            </label>
          </div>
          {missingLocationItems.length > 0 ? (
            <div className="mt-4 max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3">
              <ul className="space-y-2">
                {missingLocationItems.map((item) => (
                  <li key={`${item.comparison_line_id}-${item.change_type}-${item.page_number ?? "x"}-${item.line_number ?? "y"}`}>
                    <div className="font-medium text-slate-900">
                      {`Comparison line ${item.comparison_line_id} • ${item.change_type} • Page ${item.page_number ?? "-"} • Line ${item.line_number ?? "-"}`}
                    </div>
                    <div className="text-slate-600">{item.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
