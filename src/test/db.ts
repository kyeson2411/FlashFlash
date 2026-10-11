import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

const BOOT = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;
`;

/** In-memory Postgres with the app migrations applied, including auth.uid(). */
export async function migrateTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOT);
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }
  return db;
}

export async function signIn(db: PGlite, userId: string): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
}

/** Run as the signed-in authenticated role, then return to the migration owner. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await signIn(db, userId);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
