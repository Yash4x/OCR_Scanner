"use client";

import { useActionState } from "react";
import { regenerateFullComparisonAction } from "@/app/compare/actions";
import { initialRegenerateFullComparisonState } from "@/app/compare/state";
import { FormSubmitButton } from "@/components/form-submit-button";

export function RegenerateFullComparisonForm({ comparisonId }: { comparisonId: string }) {
  const [state, formAction] = useActionState(
    regenerateFullComparisonAction,
    initialRegenerateFullComparisonState,
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
      <FormSubmitButton loadingText="Rebuilding...">Regenerate Full Comparison</FormSubmitButton>
    </form>
  );
}
