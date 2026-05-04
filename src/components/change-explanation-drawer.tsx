"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PaperHighlight } from "@/components/highlight-overlay";
import { SpanDiagnosticsPanel } from "@/components/span-diagnostics-panel";
import type { SpanDiagnosticInfo } from "@/lib/span-diagnostics";

const typeLabel: Record<PaperHighlight["change_type"], string> = {
  unchanged: "Unchanged",
  modified: "Modified",
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  formatting_only: "Formatting only",
};

function typeVariant(changeType: PaperHighlight["change_type"]) {
  if (changeType === "added") return "success";
  if (changeType === "removed") return "destructive";
  if (changeType === "modified") return "warning";
  if (changeType === "formatting_only") return "info";
  if (changeType === "moved") return "moved";
  return "secondary";
}

export function ChangeExplanationDrawer({
  selected,
  diagnostic,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  selected: PaperHighlight | null;
  diagnostic?: SpanDiagnosticInfo | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="h-full border-slate-200 bg-white/95">
      <CardHeader className="border-b border-slate-200">
        <CardTitle>Change Details</CardTitle>
        <CardDescription>Old text, new text, and AI explanation for this highlighted change.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 text-sm text-slate-700">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={typeVariant(selected.change_type)}>{typeLabel[selected.change_type]}</Badge>
              <span className="text-xs uppercase tracking-wide text-slate-500">
                Page {selected.page_number} • Line {selected.line_number ?? "-"}
              </span>
            </div>

            <div className="grid gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Highlighted span</p>
                <p className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3">{selected.span_text ?? selected.text}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Section</p>
                <p>{selected.section_title ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Old text</p>
                <p className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3">{selected.old_text ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">New text</p>
                <p className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3">{selected.new_text ?? "-"}</p>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">AI Explanation</p>
                <Badge
                  variant={
                    selected.risk_level === "high"
                      ? "destructive"
                      : selected.risk_level === "medium"
                        ? "warning"
                        : "secondary"
                  }
                >
                  {selected.risk_level ?? "unknown"} risk
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Short summary</p>
                <p>{selected.short_summary ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Old meaning</p>
                <p>{selected.old_meaning ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">New meaning</p>
                <p>{selected.new_meaning ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Practical impact</p>
                <p>{selected.practical_impact ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Confidence</p>
                <p>{typeof selected.confidence === "number" ? selected.confidence.toFixed(2) : "-"}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onPrevious} disabled={!hasPrevious}>
                Previous change
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onNext} disabled={!hasNext}>
                Next change
              </Button>
            </div>
            {diagnostic ? <div className="mt-3"> <SpanDiagnosticsPanel diagnostic={diagnostic} /> </div> : null}
          </>
        ) : (
          <p className="text-slate-500">Select a highlighted area to inspect its change details.</p>
        )}
      </CardContent>
    </Card>
  );
}
