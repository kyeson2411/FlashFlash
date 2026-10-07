"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type AuthState } from "@/app/actions/auth";
import { Alert } from "@/components/ui/Alert";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { safeNextPath } from "@/lib/auth/validate";

export function LoginForm({ disabled = false }: { disabled?: boolean }) {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const confirmed = searchParams.get("confirmed") === "1";
  const confirmError = searchParams.get("error") === "confirm";
  const [state, action, pending] = useActionState(login, undefined as AuthState | undefined);
  const blocked = disabled || pending;

  return (
    <form action={action} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />
        {confirmed && (
          <Alert title="Email confirmed" tone="success">
            Your account is ready. Sign in with the email and password you registered with.
          </Alert>
        )}
        {confirmError && (
          <Alert title="Could not confirm your email">
            That confirmation link is invalid or has expired. Try signing in, or create the account again.
          </Alert>
        )}
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
          autoComplete="current-password"
          required
          disabled={blocked}
          error={state?.errors?.password}
        />
        {state?.message && <Alert title="Could not sign in">{state.message}</Alert>}
        <Button type="submit" className="w-full" loading={pending} loadingText="Signing in…" disabled={disabled}>
          Sign in
        </Button>
        <p className="type-helper text-center">
          New here?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
    </form>
  );
}
