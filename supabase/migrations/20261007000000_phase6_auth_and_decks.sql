-- AutoFlash - Phase 6: student accounts, decks, flashcards, and Row Level Security.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Supabase CLI    : place the file in supabase/migrations and run `supabase db push`.
--
-- Design rules
--   * Every table lives in `public` and has RLS enabled.
--   * A student can only ever see or change rows they own. Ownership is decided by
--     auth.uid(), which comes from the signed session token, never from client input.
--   * `anon` (not signed in) has no access to any table or function in this file.
--   * No grades, scores, or teacher/admin access exist in this schema, by design.
--   * Spaced-repetition (Phase 7) columns are deliberately NOT part of this migration.

-- ---------------------------------------------------------------------------
-- 1. profiles: one row per student account (the school ID lives here)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  school_id              text not null,
  full_name              text not null,
  privacy_consent_at     timestamptz not null,
  privacy_notice_version text not null,
  created_at             timestamptz not null default now(),

  -- Letters, digits and hyphens, 3 to 32 characters. Stored upper-case, so
  -- uniqueness is case-insensitive for the student ("ab-123" and "AB-123" collide).
  constraint profiles_school_id_format check (school_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  constraint profiles_full_name_length check (char_length(full_name) between 2 and 100)
);

create unique index profiles_school_id_key on public.profiles (school_id);

-- ---------------------------------------------------------------------------
-- 2. decks and flashcards
-- ---------------------------------------------------------------------------
create table public.decks (
  id           uuid primary key default gen_random_uuid(),
  -- DEFAULT auth.uid() means an insert never has to name the owner, and RLS below
  -- rejects any attempt to name someone else.
  owner_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  source_topic text check (source_topic is null or char_length(source_topic) <= 6000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index decks_owner_created_idx on public.decks (owner_id, created_at desc);

create table public.flashcards (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks (id) on delete cascade,
  position   int  not null check (position between 1 and 200),
  question   text not null check (char_length(question) between 1 and 2000),
  answer     text not null check (char_length(answer) between 1 and 4000),
  -- The three states students already see in the interface.
  state      text not null default 'unreviewed' check (state in ('unreviewed', 'learning', 'known')),
  created_at timestamptz not null default now(),
  unique (deck_id, position)
);

create index flashcards_deck_idx on public.flashcards (deck_id);

-- ---------------------------------------------------------------------------
-- 3. generation_log: lets the server limit AI generations per student
-- ---------------------------------------------------------------------------
create table public.generation_log (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index generation_log_owner_created_idx on public.generation_log (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Housekeeping trigger: keep decks.updated_at honest
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Create the profile automatically when an account is created
--
-- The sign-up form sends school_id, full_name and the privacy consent as user
-- metadata. Doing this in the database (instead of in app code) means:
--   * account + profile are created together or not at all (atomic), and
--   * the rules below also apply to anyone who calls the public Auth API directly,
--     because the anon key is public by design.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school_id text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'school_id', '')));
  v_full_name text := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  v_consent   text := coalesce(new.raw_user_meta_data ->> 'privacy_consent', '');
  v_version   text := btrim(coalesce(new.raw_user_meta_data ->> 'privacy_notice_version', ''));
begin
  if v_consent <> 'true' then
    raise exception 'Privacy consent is required to create an account.'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, school_id, full_name, privacy_consent_at, privacy_notice_version)
  values (new.id, v_school_id, v_full_name, now(), coalesce(nullif(v_version, ''), 'unspecified'));

  return new;
end;
$$;

-- Only the auth system fires this trigger. It must not be callable by clients.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. Create a deck and its cards in ONE transaction
--
-- SECURITY INVOKER (the default) means Row Level Security still applies to the
-- caller, so the new deck can only ever be owned by the signed-in student.
-- ---------------------------------------------------------------------------
create function public.create_deck_with_cards(
  p_title        text,
  p_source_topic text,
  p_cards        jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deck_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_cards is null
     or jsonb_typeof(p_cards) <> 'array'
     or jsonb_array_length(p_cards) not between 1 and 50 then
    raise exception 'A deck needs between 1 and 50 cards.' using errcode = '22023';
  end if;

  insert into public.decks (title, source_topic)
  values (btrim(p_title), nullif(btrim(coalesce(p_source_topic, '')), ''))
  returning id into v_deck_id;

  insert into public.flashcards (deck_id, position, question, answer)
  select v_deck_id, t.ord::int, btrim(t.card ->> 'question'), btrim(t.card ->> 'answer')
  from jsonb_array_elements(p_cards) with ordinality as t (card, ord);

  return v_deck_id;
end;
$$;

revoke execute on function public.create_deck_with_cards(text, text, jsonb) from public, anon;
grant  execute on function public.create_deck_with_cards(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Table privileges (least privilege)
--
-- Supabase grants broad default privileges on new tables. Remove them, then
-- grant back only what the application needs. RLS then narrows it to the owner.
-- ---------------------------------------------------------------------------
revoke all on public.profiles       from public, anon, authenticated;
revoke all on public.decks          from public, anon, authenticated;
revoke all on public.flashcards     from public, anon, authenticated;
revoke all on public.generation_log from public, anon, authenticated;

-- A student can read their profile and change only their display name.
-- The school ID cannot be changed after registration.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Decks: read, create, rename, delete.
grant select, insert, delete on public.decks to authenticated;
grant update (title) on public.decks to authenticated;

-- Cards: read, create (through create_deck_with_cards), remove, and change study state only.
grant select, insert, delete on public.flashcards to authenticated;
grant update (state) on public.flashcards to authenticated;

-- Generation log: append and read your own entries. Never edited or deleted by clients.
grant select, insert on public.generation_log to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
--
-- `(select auth.uid())` is evaluated once per statement instead of once per row.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.decks          enable row level security;
alter table public.flashcards     enable row level security;
alter table public.generation_log enable row level security;

-- FORCE means even the table owner cannot skip these policies. The API roles
-- (anon / authenticated) are not owners, but this keeps the guarantee explicit.
alter table public.profiles       force row level security;
alter table public.decks          force row level security;
alter table public.flashcards     force row level security;
alter table public.generation_log force row level security;

-- profiles: only your own row. Rows are created by the trigger, never by clients.
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- decks: only decks you own.
create policy "decks: read own"
  on public.decks for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "decks: create own"
  on public.decks for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "decks: update own"
  on public.decks for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "decks: delete own"
  on public.decks for delete to authenticated
  using (owner_id = (select auth.uid()));

-- flashcards: only cards that belong to a deck you own.
create policy "flashcards: read own"
  on public.flashcards for select to authenticated
  using (exists (
    select 1 from public.decks d
    where d.id = flashcards.deck_id and d.owner_id = (select auth.uid())
  ));

create policy "flashcards: create in own deck"
  on public.flashcards for insert to authenticated
  with check (exists (
    select 1 from public.decks d
    where d.id = flashcards.deck_id and d.owner_id = (select auth.uid())
  ));

create policy "flashcards: update own"
  on public.flashcards for update to authenticated
  using (exists (
    select 1 from public.decks d
    where d.id = flashcards.deck_id and d.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.decks d
    where d.id = flashcards.deck_id and d.owner_id = (select auth.uid())
  ));

create policy "flashcards: delete own"
  on public.flashcards for delete to authenticated
  using (exists (
    select 1 from public.decks d
    where d.id = flashcards.deck_id and d.owner_id = (select auth.uid())
  ));

-- generation_log: your own entries only.
create policy "generation_log: read own"
  on public.generation_log for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "generation_log: append own"
  on public.generation_log for insert to authenticated
  with check (owner_id = (select auth.uid()));
