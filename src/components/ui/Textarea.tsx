import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Field, controlClasses, describedBy, type FieldProps } from "./Field";

type TextareaProps = Omit<ComponentProps<"textarea">, "id"> & FieldProps;

export function Textarea({ id, label, hint, error, className, ...props }: TextareaProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, hint, error })}
        className={cn(controlClasses(!!error), "resize-y", className)}
        {...props}
      />
    </Field>
  );
}
