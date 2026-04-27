"use client";

import { useActionState } from "react";
import {
  createComparisonAction,
} from "@/app/compare/actions";
import { initialCreateComparisonState } from "@/app/compare/state";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateComparisonForm() {
  const [state, formAction] = useActionState(
    createComparisonAction,
    initialCreateComparisonState,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Comparison</CardTitle>
        <CardDescription>
          Upload an old and new version of your scanned document.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Comparison title</Label>
            <Input id="title" name="title" placeholder="Employment contract v1 vs v2" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="oldDocument">Old document</Label>
            <Input
              id="oldDocument"
              name="oldDocument"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newDocument">New document</Label>
            <Input
              id="newDocument"
              name="newDocument"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              required
            />
          </div>

          {state.error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-3">
            <FormSubmitButton loadingText="Uploading...">Create Comparison</FormSubmitButton>
            <Button type="button" variant="secondary" onClick={() => window.history.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
