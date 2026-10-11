-- AutoFlash: class decks stay hidden until a teacher publishes them.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this file only, after 20261011120000_class_access.sql.
--
-- Existing class decks are published, so current students keep studying them.
-- A new class deck starts as a draft. Students can read and study it only after
-- it is published. Personal decks are unchanged.

alter table public.decks
  add column if not exists workflow_status text;

update public.decks
set workflow_status = 'published'
where class_id is not null
  and workflow_status is null;

alter table public.decks
  drop constraint if exists decks_workflow_status_check;

alter table public.decks
  add constraint decks_workflow_status_check check (
    (class_id is null and workflow_status is null)
    or (
      class_id is not null
      and workflow_status in ('draft', 'teacher_reviewed', 'published')
    )
  );

-- A client insert cannot mark a class deck reviewed or published.
create or replace function public.set_class_deck_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.class_id is null then
    new.workflow_status := null;
  else
    new.workflow_status := 'draft';
  end if;
  return new;
end;
$$;

drop trigger if exists decks_default_workflow on public.decks;
create trigger decks_default_workflow
  before insert on public.decks
  for each row execute function public.set_class_deck_status();

drop policy if exists "decks: class members read" on public.decks;
create policy "decks: class members read"
  on public.decks for select to authenticated
  using (
    class_id is not null
    and workflow_status = 'published'
    and public.is_class_member(class_id)
  );

drop policy if exists "flashcards: class members read" on public.flashcards;
create policy "flashcards: class members read"
  on public.flashcards for select to authenticated
  using (exists (
    select 1
    from public.decks d
    where d.id = flashcards.deck_id
      and d.class_id is not null
      and d.workflow_status = 'published'
      and public.is_class_member(d.class_id)
  ));

create table if not exists public.deck_versions (
  id              uuid primary key default gen_random_uuid(),
  deck_id         uuid not null references public.decks (id) on delete cascade,
  version_number  integer not null check (version_number > 0),
  cards           jsonb not null check (jsonb_typeof(cards) = 'array'),
  edited_by       uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  unique (deck_id, version_number)
);

create index if not exists deck_versions_deck_idx
  on public.deck_versions (deck_id, version_number desc);

alter table public.deck_versions enable row level security;
alter table public.deck_versions force row level security;

revoke all on public.deck_versions from public, anon, authenticated;
grant select on public.deck_versions to authenticated;

drop policy if exists "deck_versions: owner reads" on public.deck_versions;
create policy "deck_versions: owner reads"
  on public.deck_versions for select to authenticated
  using (exists (
    select 1
    from public.decks d
    where d.id = deck_versions.deck_id
      and d.owner_id = (select auth.uid())
  ));

create or replace function public.write_deck_version(p_deck_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_owner uuid;
  v_next integer;
  v_cards jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('deck-version'),
    pg_catalog.hashtext(p_deck_id::text)
  );

  select workflow_status, owner_id
    into v_status, v_owner
  from public.decks
  where id = p_deck_id;

  if not found or v_status is distinct from 'published' or v_owner is null then
    return;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_next
  from public.deck_versions
  where deck_id = p_deck_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'position', f.position,
        'question', f.question,
        'answer', f.answer
      )
      order by f.position, f.id
    ),
    '[]'::jsonb
  )
    into v_cards
  from public.flashcards f
  where f.deck_id = p_deck_id;

  insert into public.deck_versions (deck_id, version_number, cards, edited_by)
  values (p_deck_id, v_next, v_cards, coalesce(auth.uid(), v_owner));
end;
$$;

create or replace function public.version_changed_decks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deck uuid;
begin
  for v_deck in
    select distinct deck_id from changed_cards
  loop
    perform public.write_deck_version(v_deck);
  end loop;
  return null;
end;
$$;

drop trigger if exists flashcards_version_insert on public.flashcards;
create trigger flashcards_version_insert
  after insert on public.flashcards
  referencing new table as changed_cards
  for each statement execute function public.version_changed_decks();

drop trigger if exists flashcards_version_update on public.flashcards;
create trigger flashcards_version_update
  after update on public.flashcards
  referencing new table as changed_cards
  for each statement execute function public.version_changed_decks();

drop trigger if exists flashcards_version_delete on public.flashcards;
create trigger flashcards_version_delete
  after delete on public.flashcards
  referencing old table as changed_cards
  for each statement execute function public.version_changed_decks();

do $$
declare
  v_deck uuid;
begin
  for v_deck in
    select d.id
    from public.decks d
    where d.workflow_status = 'published'
      and not exists (
        select 1 from public.deck_versions v where v.deck_id = d.id
      )
  loop
    perform public.write_deck_version(v_deck);
  end loop;
end;
$$;

create or replace function public.set_deck_workflow(p_deck_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_class uuid;
  v_status text;
  v_cards integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_status not in ('teacher_reviewed', 'published') then
    raise exception 'Choose reviewed or published.' using errcode = '22023';
  end if;

  select owner_id, class_id, workflow_status
    into v_owner, v_class, v_status
  from public.decks
  where id = p_deck_id
  for update;

  if not found or v_class is null or v_owner is distinct from auth.uid() then
    raise exception 'That deck is no longer available.' using errcode = '42501';
  end if;

  if p_status = 'teacher_reviewed' then
    if v_status = 'published' then
      raise exception 'This deck is already published.' using errcode = '22023';
    end if;
    if v_status = 'teacher_reviewed' then
      raise exception 'This deck is already reviewed.' using errcode = '22023';
    end if;
    update public.decks
    set workflow_status = 'teacher_reviewed'
    where id = p_deck_id;
    return 'teacher_reviewed';
  end if;

  if v_status = 'published' then
    raise exception 'This deck is already published.' using errcode = '22023';
  end if;
  if v_status is distinct from 'teacher_reviewed' then
    raise exception 'Mark this deck reviewed before publishing.' using errcode = '22023';
  end if;

  select count(*)::integer
    into v_cards
  from public.flashcards
  where deck_id = p_deck_id;

  if v_cards < 1 then
    raise exception 'This deck has no cards.' using errcode = '22023';
  end if;

  update public.decks
  set workflow_status = 'published'
  where id = p_deck_id;

  perform public.write_deck_version(p_deck_id);
  return 'published';
end;
$$;

create or replace function public.reject_unpublished_class_study()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_class uuid;
begin
  select d.workflow_status, d.class_id
    into v_status, v_class
  from public.flashcards f
  join public.decks d on d.id = f.deck_id
  where f.id = new.card_id;

  if v_class is not null and v_status is distinct from 'published' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists student_progress_requires_published_deck on public.student_card_progress;
create trigger student_progress_requires_published_deck
  before insert or update on public.student_card_progress
  for each row execute function public.reject_unpublished_class_study();

create or replace function public.give_class_quiz(p_deck_id uuid, p_due_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_title text;
  v_status text;
  v_teacher uuid;
  v_cards jsonb;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_due_at is not null and p_due_at <= now() then
    raise exception 'Choose today or a later day.' using errcode = '22023';
  end if;

  select d.class_id, d.title, d.workflow_status, c.teacher_id
    into v_class, v_title, v_status, v_teacher
  from public.decks d
  join public.classes c on c.id = d.class_id
  where d.id = p_deck_id
  for update of d;

  if not found or v_teacher is distinct from auth.uid() then
    raise exception 'Only the teacher of this class can give a quiz.' using errcode = '42501';
  end if;

  if v_status is distinct from 'published' then
    raise exception 'Publish this deck before giving it as a quiz.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(item order by position), '[]'::jsonb)
    into v_cards
  from (
    select f.position,
           jsonb_build_object(
             'id', f.id::text,
             'question', f.question,
             'answer', f.answer
           ) as item
    from public.flashcards f
    where f.deck_id = p_deck_id
  ) ordered;

  if jsonb_array_length(v_cards) < 1 then
    raise exception 'This deck has no cards.' using errcode = '22023';
  end if;

  update public.quizzes
  set closed_at = due_at
  where deck_id = p_deck_id
    and closed_at is null
    and due_at is not null
    and due_at <= now();

  begin
    insert into public.quizzes (class_id, deck_id, title, cards, due_at, created_by)
    values (v_class, p_deck_id, v_title, v_cards, p_due_at, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'This deck already has an open quiz.' using errcode = '23505';
  end;

  return v_id;
end;
$$;

revoke all on function public.set_class_deck_status() from public, anon, authenticated;
revoke all on function public.write_deck_version(uuid) from public, anon, authenticated;
revoke all on function public.version_changed_decks() from public, anon, authenticated;
revoke all on function public.reject_unpublished_class_study() from public, anon, authenticated;
revoke all on function public.set_deck_workflow(uuid, text) from public, anon;
grant execute on function public.set_deck_workflow(uuid, text) to authenticated;
