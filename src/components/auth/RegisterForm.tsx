"use client";

import { useActionState } from "react";
import { register, type AuthState } from "@/app/actions/auth";
import { Alert } from "@/components/ui/Alert";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  PASSWORD_MIN,
  SCHOOL_ID_MAX,
  SCHOOL_ID_MIN,
} from "@/lib/auth/validate";
import { PRIVACY_CONSENT_LABEL, PRIVACY_NOTICE_BODY, PRIVACY_NOTICE_TITLE } from "@/lib/auth/privacy";

export function RegisterForm({ disabled = false }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState(register, undefined as AuthState | undefined);
  const confirmed = state?.message?.startsWith("Check your email");
  const blocked = disabled || pending;

  return (
    <form action={action} className="space-y-5" noValidate>
        <Input
          id="fullName"
          name="fullName"
          label="Full name"
          autoComplete="name"
          required
          disabled={blocked}
          error={state?.errors?.fullName}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">I am a</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-4">
              <input type="radio" name="role" value="student" defaultChecked disabled={blocked} />
              Student
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-4">
              <input type="radio" name="role" value="teacher" disabled={blocked} />
              Teacher
            </label>
          </div>
          {state?.errors?.role && <p className="text-sm font-medium text-error">{state.errors.role}</p>}
        </fieldset>
        <Input
          id="schoolId"
          name="schoolId"
          label="School ID"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          disabled={blocked}
          maxLength={SCHOOL_ID_MAX}
          hint={`${SCHOOL_ID_MIN}–${SCHOOL_ID_MAX} letters, numbers, or hyphens.`}
          error={state?.errors?.schoolId}
        />
        <Input
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          disabled={blocked}
          error={state?.errors?.email}
        />
        <Input
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          required
          disabled={blocked}
          hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`}
          error={state?.errors?.password}
        />
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          required
          disabled={blocked}
          error={state?.errors?.confirmPassword}
        />

        <div className="space-y-3 rounded-md border border-border bg-background p-4">
          <p className="text-sm font-semibold text-ink">{PRIVACY_NOTICE_TITLE}</p>
          <p className="type-helper">{PRIVACY_NOTICE_BODY}</p>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              id="privacyConsent"
              name="privacyConsent"
              type="checkbox"
              required
              disabled={blocked}
              aria-invalid={state?.errors?.privacyConsent ? true : undefined}
              aria-describedby={state?.errors?.privacyConsent ? "privacyConsent-error" : undefined}
              className="mt-1 size-5 shrink-0 rounded border-border-strong"
            />
            <span className="text-sm text-ink">{PRIVACY_CONSENT_LABEL}</span>
          </label>
          {state?.errors?.privacyConsent && (
            <p id="privacyConsent-error" className="text-sm font-medium text-error">
              {state.errors.privacyConsent}
            </p>
          )}
        </div>

        {state?.message && (
          <Alert title={confirmed ? "Confirm your email" : "Could not create your account"} tone={confirmed ? "success" : "error"}>
            {state.message}
          </Alert>
        )}

        <Button
          type="submit"
          className="w-full"
          loading={pending}
          loadingText="Creating your account…"
          disabled={disabled}
        >
          Create account
        </Button>
        <p className="type-helper text-center">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
    </form>
  );
}
