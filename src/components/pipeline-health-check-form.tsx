"use client";

import { useActionState } from "react";
import { getComparisonPipelineHealthAction } from "@/app/compare/actions";
import { initialPipelineHealthCheckState } from "@/app/compare/state";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PipelineHealthCheckForm({ comparisonId }: { comparisonId: string }) {
  const [state, formAction] = useActionState(getComparisonPipelineHealthAction, initialPipelineHealthCheckState);

  return (
    <Card className="border-slate-200 bg-white/80">
      <CardHeader>
        <CardTitle className="text-lg">Pipeline Health Check</CardTitle>
        <CardDescription>Inspect OCR, comparison, and span generation counts.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="comparisonId" value={comparisonId} />
          <FormSubmitButton loadingText="Checking...">Run Health Check</FormSubmitButton>
        </form>

        {state.error ? (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>
        ) : null}

        {state.health ? (
          <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4" open>
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-900">
              Pipeline Health Check results
            </summary>
            <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
              <div>Old document: {state.health.oldDocumentId ?? "-"}</div>
              <div>New document: {state.health.newDocumentId ?? "-"}</div>
              <div>Old pages: {state.health.oldPagesCount}</div>
              <div>New pages: {state.health.newPagesCount}</div>
              <div>Old lines: {state.health.oldLinesCount}</div>
              <div>New lines: {state.health.newLinesCount}</div>
              <div>Old words: {state.health.oldWordsCount}</div>
              <div>New words: {state.health.newWordsCount}</div>
              <div>Comparison lines: {state.health.comparisonLinesCount}</div>
              <div>Changed comparison lines: {state.health.changedComparisonLinesCount}</div>
              <div>Comparison spans: {state.health.comparisonSpansCount}</div>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div>
                <p className="font-medium text-slate-900">Missing old line IDs</p>
                <p className="text-slate-600">{state.health.missingOldLineIds.length > 0 ? state.health.missingOldLineIds.join(", ") : "None"}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">Missing new line IDs</p>
                <p className="text-slate-600">{state.health.missingNewLineIds.length > 0 ? state.health.missingNewLineIds.join(", ") : "None"}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">Lines without words</p>
                <p className="text-slate-600">{state.health.linesWithoutWords.length > 0 ? state.health.linesWithoutWords.join(", ") : "None"}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">Lines without bboxes</p>
                <p className="text-slate-600">{state.health.linesWithoutBboxes.length > 0 ? state.health.linesWithoutBboxes.join(", ") : "None"}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">Skipped reasons</p>
                <p className="text-slate-600">{state.health.skippedReasons.length > 0 ? state.health.skippedReasons.join(" | ") : "None"}</p>
              </div>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
