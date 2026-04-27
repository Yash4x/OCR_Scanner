"use client";

import { useActionState } from "react";
import { processComparisonAction } from "@/app/compare/actions";
import { initialProcessComparisonState } from "@/app/compare/state";
import { FormSubmitButton } from "@/components/form-submit-button";

export function ProcessDocumentsForm({ comparisonId }: { comparisonId: string }) {
  const [state, formAction] = useActionState(
    processComparisonAction,
    initialProcessComparisonState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="comparisonId" value={comparisonId} />
      {state.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      <FormSubmitButton loadingText="Processing...">Process Documents</FormSubmitButton>
    </form>
  );
}