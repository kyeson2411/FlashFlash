-- AutoFlash: join codes, approval, and a limit on join guesses.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261011000000_reject_quiz_answers_when_closed.sql.
--
-- Existing members stay active. Joining stays immediate unless the teacher
-- turns on require_approval. A regenerated code replaces the old one. Turning
-- a code off stops new joins and leaves current members in the class.

alter table public.classes
  add column if not exists require_approval boolean not null default false;

alter table public.classes
  add column if not exists code_revoked_at timestamptz;

alter table public.class_members
  add column if not exists status text not null default 'active';

alter table public.class_members
  drop constraint if exists class_members_status_check;

alter table public.class_members
  add constraint class_members_status_check check (status in ('pending', 'active'));

-- Teachers can rename a class. Code, approval, and revocation change only
-- through the functions below.
revoke update on public.classes from authenticated;
grant update (name) on public.classes to authenticated;

create table public.class_join_attempts (
  student_id   uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index class_join_attempts_student_idx
  on public.class_join_attempts (student_id, attempted_at desc);

alter table public.class_join_attempts enable row level security;
alter table public.class_join_attempts force row level security;
revoke all on public.class_join_attempts from public, anon, authenticated;

-- Active members can study and take quizzes. Pending members cannot.
create or replace function public.is_class_member(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members
    where class_id = p_class_id
      and student_id = (select auth.uid())
      and status = 'active'
  );
$$;

-- Any membership, including waiting for approval, can see the class name.
create or replace function public.has_class_membership(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members
    where class_id = p_class_id
      and student_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_class_member(uuid) from public, anon;
revoke execute on function public.has_class_membership(uuid) from public, anon;
grant execute on function public.is_class_member(uuid) to authenticated;
grant execute on function public.has_class_membership(uuid) to authenticated;

drop policy if exists "classes: members read" on public.classes;
create policy "classes: members read"
  on public.classes for select to authenticated
  using (public.has_class_membership(id));

-- Same 32-character alphabet as the app, without look-alike letters.
create or replace function public.generate_class_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i integer;
begin
  for i in 1..6 loop
    v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.generate_class_code() from public, anon, authenticated;

-- join_class used to return uuid. Failed guesses must be stored even though
-- the caller sees an error, so the function now returns jsonb and does not raise
-- for a wrong code. Raising would roll the guess back.
drop function if exists public.join_class(text);

create or replace function public.join_class(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_class uuid;
  v_approval boolean;
  v_status text;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_uid::text));

  delete from public.class_join_attempts
  where student_id = v_uid
    and attempted_at <= now() - interval '15 minutes';

  select count(*)::integer
    into v_recent
  from public.class_join_attempts
  where student_id = v_uid;

  if v_recent >= 8 then
    return jsonb_build_object('error', 'Too many attempts. Please wait a few minutes and try again.');
  end if;

  select role into v_role from public.profiles where id = v_uid;

  if v_role is distinct from 'student' or v_code !~ '^[A-Z0-9]{6}$' then
    insert into public.class_join_attempts (student_id) values (v_uid);
    return jsonb_build_object('error', 'That class code was not found.');
  end if;

  select id, require_approval
    into v_class, v_approval
  from public.classes
  where code = v_code
    and code_revoked_at is null;

  if not found then
    insert into public.class_join_attempts (student_id) values (v_uid);
    return jsonb_build_object('error', 'That class code was not found.');
  end if;

  select status
    into v_status
  from public.class_members
  where class_id = v_class
    and student_id = v_uid;

  if found then
    return jsonb_build_object('classId', v_class, 'status', v_status);
  end if;

  v_status := case when v_approval then 'pending' else 'active' end;

  insert into public.class_members (class_id, student_id, status)
  values (v_class, v_uid, v_status);

  return jsonb_build_object('classId', v_class, 'status', v_status);
exception
  when unique_violation then
    select status
      into v_status
    from public.class_members
    where class_id = v_class
      and student_id = v_uid;
    if v_status is not null then
      return jsonb_build_object('classId', v_class, 'status', v_status);
    end if;
    return jsonb_build_object('error', 'That class code was not found.');
end;
$$;

revoke execute on function public.join_class(text) from public, anon;
grant execute on function public.join_class(text) to authenticated;

create or replace function public.regenerate_class_code(p_class_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.is_class_teacher(p_class_id) then
    raise exception 'That class is no longer available.' using errcode = '42501';
  end if;

  for i in 1..8 loop
    v_code := public.generate_class_code();
    begin
      update public.classes
      set code = v_code,
          code_revoked_at = null
      where id = p_class_id
        and teacher_id = auth.uid();
      if found then
        return v_code;
      end if;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'Could not create a class code. Please try again.' using errcode = '23505';
end;
$$;

create or replace function public.revoke_class_code(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  update public.classes
  set code_revoked_at = coalesce(code_revoked_at, now())
  where id = p_class_id
    and teacher_id = auth.uid()
  returning id into v_id;

  if v_id is null then
    raise exception 'That class is no longer available.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.set_class_approval(p_class_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_required is null then
    raise exception 'That class is no longer available.' using errcode = '22023';
  end if;

  update public.classes
  set require_approval = p_required
  where id = p_class_id
    and teacher_id = auth.uid()
  returning id into v_id;

  if v_id is null then
    raise exception 'That class is no longer available.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.approve_class_member(p_class_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.is_class_teacher(p_class_id) then
    raise exception 'That class is no longer available.' using errcode = '42501';
  end if;

  update public.class_members
  set status = 'active'
  where class_id = p_class_id
    and student_id = p_student_id
    and status = 'pending'
  returning student_id into v_id;

  if v_id is null then
    raise exception 'That student is not waiting for approval.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.remove_class_member(p_class_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.is_class_teacher(p_class_id) then
    raise exception 'That class is no longer available.' using errcode = '42501';
  end if;

  delete from public.class_members
  where class_id = p_class_id
    and student_id = p_student_id
  returning student_id into v_id;

  if v_id is null then
    raise exception 'That student is no longer in this class.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.regenerate_class_code(uuid) from public, anon;
revoke execute on function public.revoke_class_code(uuid) from public, anon;
revoke execute on function public.set_class_approval(uuid, boolean) from public, anon;
revoke execute on function public.approve_class_member(uuid, uuid) from public, anon;
revoke execute on function public.remove_class_member(uuid, uuid) from public, anon;
grant execute on function public.regenerate_class_code(uuid) to authenticated;
grant execute on function public.revoke_class_code(uuid) to authenticated;
grant execute on function public.set_class_approval(uuid, boolean) to authenticated;
grant execute on function public.approve_class_member(uuid, uuid) to authenticated;
grant execute on function public.remove_class_member(uuid, uuid) to authenticated;

-- Studying a class card required any membership row. Pending students must not
-- write progress. The schedule math is unchanged.
create or replace function public.review_flashcard(
  p_card_id uuid,
  p_outcome text,
  p_mode    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner          uuid;
  v_deck_id        uuid;
  v_class_id       uuid;
  v_n              int;
  v_i              int;
  v_ef             numeric;
  v_q              int;
  v_state          text;
  v_due            timestamptz;
  v_had            boolean;
  v_prev_state     text;
  v_prev_reps      int;
  v_prev_interval  int;
  v_prev_ease      numeric;
  v_prev_due       timestamptz;
  v_prev_reviewed  timestamptz;
  v_event_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_outcome not in ('known', 'learning') then
    raise exception 'Invalid outcome.' using errcode = '22023';
  end if;

  if p_mode not in ('flip', 'choice', 'typing') then
    raise exception 'Invalid study mode.' using errcode = '22023';
  end if;

  select d.owner_id, d.id, d.class_id
    into v_owner, v_deck_id, v_class_id
  from public.flashcards f
  join public.decks d on d.id = f.deck_id
  where f.id = p_card_id;

  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;

  if v_class_id is not null then
    if not public.is_class_member(v_class_id) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;

    select p.repetitions, p.interval_days, p.ease_factor, p.state, p.due_at, p.last_reviewed_at
      into v_n, v_i, v_ef, v_prev_state, v_prev_due, v_prev_reviewed
    from public.student_card_progress p
    where p.student_id = auth.uid()
      and p.card_id = p_card_id
    for update;

    if not found then
      v_n := 0;
      v_i := 0;
      v_ef := 2.50;
      v_had := false;
      v_prev_state := null;
      v_prev_due := null;
      v_prev_reviewed := null;
    else
      v_had := true;
    end if;
  else
    if v_owner is distinct from auth.uid() then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;

    select f.repetitions, f.interval_days, f.ease_factor, f.state, f.due_at, f.last_reviewed_at
      into v_n, v_i, v_ef, v_prev_state, v_prev_due, v_prev_reviewed
    from public.flashcards f
    where f.id = p_card_id
    for update;

    v_had := true;
  end if;

  v_prev_reps := v_n;
  v_prev_interval := v_i;
  v_prev_ease := v_ef;

  v_q := case p_outcome when 'known' then 5 else 2 end;

  if v_q >= 3 then
    if v_n = 0 then
      v_i := 1;
    elsif v_n = 1 then
      v_i := 6;
    else
      v_i := greatest(1, round(v_i * v_ef)::int);
    end if;
    v_n := v_n + 1;
  else
    v_n := 0;
    v_i := 0;
  end if;

  v_ef := v_ef + (0.1 - (5 - v_q) * (0.08 + (5 - v_q) * 0.02));
  if v_ef < 1.3 then
    v_ef := 1.3;
  end if;

  v_state := case when v_q >= 3 then 'known' else 'learning' end;
  v_due := case
    when p_outcome = 'learning' then now()
    else now() + make_interval(days => v_i)
  end;

  if v_class_id is not null then
    insert into public.student_card_progress (
      student_id, card_id, state, repetitions, interval_days, ease_factor, due_at, last_reviewed_at
    )
    values (auth.uid(), p_card_id, v_state, v_n, v_i, v_ef, v_due, now())
    on conflict (student_id, card_id) do update
      set state = excluded.state,
          repetitions = excluded.repetitions,
          interval_days = excluded.interval_days,
          ease_factor = excluded.ease_factor,
          due_at = excluded.due_at,
          last_reviewed_at = excluded.last_reviewed_at;
  else
    update public.flashcards
    set state = v_state,
        repetitions = v_n,
        interval_days = v_i,
        ease_factor = v_ef,
        due_at = v_due,
        last_reviewed_at = now()
    where id = p_card_id;
  end if;

  insert into public.review_events (owner_id, deck_id, card_id, outcome, mode)
  values (auth.uid(), v_deck_id, p_card_id, p_outcome, p_mode)
  returning id into v_event_id;

  insert into public.review_undo (
    owner_id, card_id, deck_id, class_card, had_progress,
    prev_state, prev_repetitions, prev_interval_days, prev_ease_factor,
    prev_due_at, prev_last_reviewed_at, event_id
  )
  values (
    auth.uid(), p_card_id, v_deck_id, v_class_id is not null, v_had,
    v_prev_state, v_prev_reps, v_prev_interval, v_prev_ease,
    v_prev_due, v_prev_reviewed, v_event_id
  )
  on conflict (owner_id) do update
    set card_id = excluded.card_id,
        deck_id = excluded.deck_id,
        class_card = excluded.class_card,
        had_progress = excluded.had_progress,
        prev_state = excluded.prev_state,
        prev_repetitions = excluded.prev_repetitions,
        prev_interval_days = excluded.prev_interval_days,
        prev_ease_factor = excluded.prev_ease_factor,
        prev_due_at = excluded.prev_due_at,
        prev_last_reviewed_at = excluded.prev_last_reviewed_at,
        event_id = excluded.event_id,
        created_at = now();
end;
$$;

create or replace function public.undo_last_review(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_class_id uuid;
  v_row      public.review_undo%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select * into v_row
  from public.review_undo
  where owner_id = auth.uid()
  for update;

  if not found or v_row.card_id is distinct from p_card_id then
    raise exception 'That answer can no longer be undone.' using errcode = 'P0001';
  end if;

  select d.owner_id, d.class_id
    into v_owner, v_class_id
  from public.flashcards f
  join public.decks d on d.id = f.deck_id
  where f.id = p_card_id;

  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;

  if v_class_id is not null then
    if not public.is_class_member(v_class_id) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;

    if v_row.had_progress then
      update public.student_card_progress
      set state = v_row.prev_state,
          repetitions = v_row.prev_repetitions,
          interval_days = v_row.prev_interval_days,
          ease_factor = v_row.prev_ease_factor,
          due_at = v_row.prev_due_at,
          last_reviewed_at = v_row.prev_last_reviewed_at
      where student_id = auth.uid()
        and card_id = p_card_id;
    else
      delete from public.student_card_progress
      where student_id = auth.uid()
        and card_id = p_card_id;
    end if;
  else
    if v_owner is distinct from auth.uid() then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;

    update public.flashcards
    set state = v_row.prev_state,
        repetitions = v_row.prev_repetitions,
        interval_days = v_row.prev_interval_days,
        ease_factor = v_row.prev_ease_factor,
        due_at = v_row.prev_due_at,
        last_reviewed_at = v_row.prev_last_reviewed_at
    where id = p_card_id;
  end if;

  delete from public.review_events
  where id = v_row.event_id
    and owner_id = auth.uid()
    and card_id = p_card_id;

  delete from public.review_undo
  where owner_id = auth.uid();
end;
$$;

revoke execute on function public.review_flashcard(uuid, text, text) from public, anon;
revoke execute on function public.undo_last_review(uuid) from public, anon;
grant execute on function public.review_flashcard(uuid, text, text) to authenticated;
grant execute on function public.undo_last_review(uuid) to authenticated;
