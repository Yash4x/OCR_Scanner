"use client";

import { useActionState } from "react";
import { regeneratePaperHighlightsAction } from "@/app/compare/actions";
import { initialRegeneratePaperHighlightsState } from "@/app/compare/state";
import { FormSubmitButton } from "@/components/form-submit-button";

export function RegeneratePaperHighlightsForm({ comparisonId }: { comparisonId: string }) {
  const [state, formAction] = useActionState(
    regeneratePaperHighlightsAction,
    initialRegeneratePaperHighlightsState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="comparisonId" value={comparisonId} />
      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {state.message}
        </p>
      ) : null}
      {state.stats ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
          <div>spans attempted: {state.stats.spansAttempted}</div>
          <div>spans inserted: {state.stats.spansInserted}</div>
          <div>skipped: {state.stats.skippedCount}</div>
          <div>insert error: {state.stats.insertError ?? "none"}</div>
          <div>
            skipped reasons: {Object.keys(state.stats.skippedReasons).length > 0
              ? Object.entries(state.stats.skippedReasons).map(([k, v]) => `${k}:${v}`).join(" | ")
              : "none"}
          </div>
          {state.stats.skippedDetails.length > 0 ? (
            <ul className="list-disc pl-4 space-y-1">
              {state.stats.skippedDetails.slice(0, 10).map((item, index) => (
                <li key={`${item.comparison_line_id}-${item.side}-${item.reason_code}-${index}`}>
                  {item.comparison_line_id} [{item.side}] {item.reason_code}: {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <FormSubmitButton loadingText="Regenerating...">Regenerate Paper Highlights</FormSubmitButton>
    </form>
  );
}
