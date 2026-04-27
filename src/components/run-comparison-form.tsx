"use client";

import { useActionState } from "react";
import { runComparisonAction } from "@/app/compare/actions";
import { initialRunComparisonState } from "@/app/compare/state";
import { FormSubmitButton } from "@/components/form-submit-button";

export function RunComparisonForm({ comparisonId }: { comparisonId: string }) {
  const [state, formAction] = useActionState(runComparisonAction, initialRunComparisonState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="comparisonId" value={comparisonId} />
      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      <FormSubmitButton loadingText="Comparing...">Run Comparison</FormSubmitButton>
    </form>
  );
}