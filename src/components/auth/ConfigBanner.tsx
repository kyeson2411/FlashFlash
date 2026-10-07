import { connection } from "next/server";
import { Alert } from "@/components/ui/Alert";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Request-time check so a production build without keys does not bake the warning in. */
export async function ConfigBanner({ action }: { action: "sign in" | "create an account" }) {
  await connection();
  if (isSupabaseConfigured()) return null;

  return (
    <Alert title="Study database is not connected">
      Add SUPABASE_URL and SUPABASE_ANON_KEY to the server environment, then apply the Phase 6 SQL
      migration. Until then, students cannot {action}.
    </Alert>
  );
}
