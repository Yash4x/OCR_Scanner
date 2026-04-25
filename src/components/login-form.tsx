"use client";

import { useActionState } from "react";
import { loginAction, type AuthFormState } from "@/app/auth/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthFormState = { error: null };

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in to DocumentDiff AI</CardTitle>
        <CardDescription>Access your comparison dashboard and upload history.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {state.error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {state.error}
            </p>
          ) : null}
          <FormSubmitButton className="w-full" loadingText="Logging in...">
            Log in
          </FormSubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
