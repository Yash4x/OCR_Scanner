"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

interface FormSubmitButtonProps extends Omit<ButtonProps, "disabled"> {
  loadingText?: string;
}

export function FormSubmitButton({
  children,
  loadingText = "Please wait...",
  ...props
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button {...props} disabled={pending}>
      {pending ? loadingText : children}
    </Button>
  );
}
