import { Suspense } from "react";
import { connection } from "next/server";
import { ConfigBanner } from "@/components/auth/ConfigBanner";
import { LoginForm } from "@/components/auth/LoginForm";
import { PageContainer, PageHeader } from "@/components/layout/PageContainer";
import { LoadingState } from "@/components/ui/LoadingState";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Sign in | AutoFlash" };

export default function LoginPage() {
  return (
    <PageContainer size="narrow" className="space-y-6">
      <PageHeader
        title="Sign in"
        description="Use the email and password you registered with. Your decks stay on your account."
      />
      <Suspense fallback={<LoadingState title="Loading sign-in…" />}>
        <LoginSection />
      </Suspense>
    </PageContainer>
  );
}

async function LoginSection() {
  await connection();
  return (
    <>
      <ConfigBanner action="sign in" />
      <LoginForm disabled={!isSupabaseConfigured()} />
    </>
  );
}
