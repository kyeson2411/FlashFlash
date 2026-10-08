import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Field, controlClasses, describedBy, type FieldProps } from "./Field";

type InputProps = Omit<ComponentProps<"input">, "id"> & FieldProps;

export function Input({ id, label, hint, error, className, ...props }: InputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, hint, error })}
        className={cn(controlClasses(!!error), "h-10", className)}
        {...props}
      />
    </Field>
  );
}
