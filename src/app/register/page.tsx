import { Suspense } from "react";
import { connection } from "next/server";
import { ConfigBanner } from "@/components/auth/ConfigBanner";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { PageContainer, PageHeader } from "@/components/layout/PageContainer";
import { LoadingState } from "@/components/ui/LoadingState";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Create account | AutoFlash" };

export default function RegisterPage() {
  return (
    <PageContainer size="narrow" className="space-y-6">
      <PageHeader
        title="Create your account"
        description="Create a student or teacher account. A student account keeps personal decks private. A teacher account is for classes."
      />
      <Suspense fallback={<LoadingState title="Loading registration…" />}>
        <RegisterSection />
      </Suspense>
    </PageContainer>
  );
}

async function RegisterSection() {
  await connection();
  return (
    <>
      <ConfigBanner action="create an account" />
      <RegisterForm disabled={!isSupabaseConfigured()} />
    </>
  );
}
