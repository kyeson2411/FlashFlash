-- AutoFlash: teacher classes.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261008000000_edit_card_text.sql.
--
-- A class deck is owned by the teacher. Each student keeps their own progress
-- row, so studying a class card never changes the shared card or another student.

alter table public.profiles
  add column if not exists role text not null default 'student';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role in ('student', 'teacher'));

-- Clients can update their name fields, but not their role.
revoke update on public.profiles from authenticated;
grant update (full_name, school_id) on public.profiles to authenticated;

create or replace function public.handle_new_user()
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
  v_role      text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'role', 'student')));
begin
  if v_consent <> 'true' then
    raise exception 'Privacy consent is required to create an account.'
      using errcode = 'check_violation';
  end if;

  if v_role not in ('student', 'teacher') then
    v_role := 'student';
  end if;

  insert into public.profiles (id, school_id, full_name, privacy_consent_at, privacy_notice_version, role)
  values (new.id, v_school_id, v_full_name, now(), coalesce(nullif(v_version, ''), 'unspecified'), v_role);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  code        text not null check (code ~ '^[A-Z0-9]{6}$'),
  created_at  timestamptz not null default now(),
  constraint classes_code_unique unique (code)
);

create index classes_teacher_idx on public.classes (teacher_id);

create table public.class_members (
  class_id    uuid not null references public.classes (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (class_id, student_id)
);

create index class_members_student_idx on public.class_members (student_id);

alter table public.decks
  add column if not exists class_id uuid references public.classes (id) on delete cascade;

create index if not exists decks_class_idx on public.decks (class_id);

create or replace function public.assert_class_deck_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.class_id is not null and not exists (
    select 1
    from public.classes c
    where c.id = new.class_id
      and c.teacher_id = new.owner_id
  ) then
    raise exception 'Only the teacher of this class can own its deck.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists decks_class_owner on public.decks;
create trigger decks_class_owner
  before insert or update of class_id, owner_id on public.decks
  for each row execute function public.assert_class_deck_owner();

create table public.student_card_progress (
  student_id        uuid not null references public.profiles (id) on delete cascade,
  card_id           uuid not null references public.flashcards (id) on delete cascade,
  state             text not null default 'unreviewed' check (state in ('unreviewed', 'learning', 'known')),
  ease_factor       numeric(4, 2) not null default 2.50 check (ease_factor >= 1.30),
  repetitions       integer not null default 0 check (repetitions >= 0),
  interval_days     integer not null default 0 check (interval_days >= 0),
  due_at            timestamptz not null default now(),
  last_reviewed_at  timestamptz,
  primary key (student_id, card_id)
);

create index student_card_progress_card_idx on public.student_card_progress (card_id);

alter table public.classes                enable row level security;
alter table public.class_members          enable row level security;
alter table public.student_card_progress  enable row level security;
alter table public.classes                force row level security;
alter table public.class_members          force row level security;
alter table public.student_card_progress  force row level security;

grant select, insert, update, delete on public.classes to authenticated;
grant select on public.class_members to authenticated;
revoke all on public.student_card_progress from public, anon, authenticated;
grant select (student_id, card_id, state, due_at) on public.student_card_progress to authenticated;

-- These read past row security so a policy can check membership without
-- selecting the same tables again. A normal subquery here loops forever.
create or replace function public.is_class_teacher(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classes
    where id = p_class_id and teacher_id = (select auth.uid())
  );
$$;

create or replace function public.is_class_member(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_members
    where class_id = p_class_id and student_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_class_teacher(uuid) from public, anon;
revoke execute on function public.is_class_member(uuid) from public, anon;
grant execute on function public.is_class_teacher(uuid) to authenticated;
grant execute on function public.is_class_member(uuid) to authenticated;

create policy "classes: teacher manages own"
  on public.classes for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

create policy "classes: members read"
  on public.classes for select to authenticated
  using (public.is_class_member(id));

create policy "class_members: teacher reads roster"
  on public.class_members for select to authenticated
  using (public.is_class_teacher(class_id));

create policy "class_members: student reads own"
  on public.class_members for select to authenticated
  using (student_id = (select auth.uid()));

create policy "profiles: teacher reads class members"
  on public.profiles for select to authenticated
  using (exists (
    select 1
    from public.class_members m
    where m.student_id = profiles.id
      and public.is_class_teacher(m.class_id)
  ));

create policy "decks: class members read"
  on public.decks for select to authenticated
  using (class_id is not null and public.is_class_member(class_id));

create policy "flashcards: class members read"
  on public.flashcards for select to authenticated
  using (exists (
    select 1
    from public.decks d
    where d.id = flashcards.deck_id
      and d.class_id is not null
      and public.is_class_member(d.class_id)
  ));

create policy "progress: student reads own"
  on public.student_card_progress for select to authenticated
  using (student_id = (select auth.uid()));

create policy "progress: teacher reads class"
  on public.student_card_progress for select to authenticated
  using (exists (
    select 1
    from public.flashcards f
    join public.decks d on d.id = f.deck_id
    where f.id = student_card_progress.card_id
      and d.class_id is not null
      and public.is_class_teacher(d.class_id)
  ));

-- Membership is only created here, so a student cannot insert themselves into
-- a class they cannot see. Joining the same class again does nothing.
create or replace function public.join_class(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text;
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_class uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'student' then
    raise exception 'That class code was not found.' using errcode = 'P0002';
  end if;

  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'That class code was not found.' using errcode = 'P0002';
  end if;

  select id into v_class from public.classes where code = v_code;
  if not found then
    raise exception 'That class code was not found.' using errcode = 'P0002';
  end if;

  insert into public.class_members (class_id, student_id)
  values (v_class, auth.uid())
  on conflict (class_id, student_id) do nothing;

  return v_class;
end;
$$;

revoke execute on function public.join_class(text) from public, anon;
grant execute on function public.join_class(text) to authenticated;

create or replace function public.create_class(p_name text)
returns table (class_id uuid, class_name text, class_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'teacher' then
    raise exception 'Only a teacher can create a class.' using errcode = '42501';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Enter a class name between 1 and 80 characters.' using errcode = '22023';
  end if;

  for i in 1..8 loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.classes (teacher_id, name, code)
      values (auth.uid(), v_name, v_code)
      returning public.classes.id into v_id;

      class_id := v_id;
      class_name := v_name;
      class_code := v_code;
      return next;
      return;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  raise exception 'Could not create a class code. Please try again.' using errcode = '23505';
end;
$$;

revoke execute on function public.create_class(text) from public, anon;
grant execute on function public.create_class(text) to authenticated;

-- Personal decks still update the card when the owner studies it.
-- A class card writes this student's progress row and leaves the shared card alone.
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
  v_owner    uuid;
  v_deck_id  uuid;
  v_class_id uuid;
  v_n        int;
  v_i        int;
  v_ef       numeric;
  v_q        int;
  v_state    text;
  v_due      timestamptz;
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
    if not exists (
      select 1 from public.class_members m
      where m.class_id = v_class_id
        and m.student_id = auth.uid()
    ) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;

    select p.repetitions, p.interval_days, p.ease_factor
      into v_n, v_i, v_ef
    from public.student_card_progress p
    where p.student_id = auth.uid()
      and p.card_id = p_card_id
    for update;

    if not found then
      v_n := 0;
      v_i := 0;
      v_ef := 2.50;
    end if;
  else
    if v_owner is distinct from auth.uid() then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;

    select f.repetitions, f.interval_days, f.ease_factor
      into v_n, v_i, v_ef
    from public.flashcards f
    where f.id = p_card_id
    for update;
  end if;

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
  values (auth.uid(), v_deck_id, p_card_id, p_outcome, p_mode);
end;
$$;

revoke execute on function public.review_flashcard(uuid, text, text) from public, anon;
grant execute on function public.review_flashcard(uuid, text, text) to authenticated;
