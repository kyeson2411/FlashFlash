-- AutoFlash: a class deck can be given as a one-time quiz.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261009010000_teacher_last_reviewed.sql.
--
-- A quiz copies the deck's cards at the moment it is given. Answers stay on
-- the quiz attempt. Studying a deck is unchanged.

create table public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  deck_id     uuid not null references public.decks (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  cards       jsonb not null check (jsonb_typeof(cards) = 'array'),
  due_at      timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid not null references public.profiles (id)
);

create index quizzes_class_idx on public.quizzes (class_id, created_at desc);
create index quizzes_deck_idx on public.quizzes (deck_id);

-- At most one quiz per deck still has a null closed_at. A past due date is
-- stamped closed before another quiz is given.
create unique index quizzes_one_open_deck_idx
  on public.quizzes (deck_id)
  where closed_at is null;

create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  correct_count integer,
  total_count   integer,
  unique (quiz_id, student_id)
);

create index quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id);

create table public.quiz_answers (
  attempt_id  uuid not null references public.quiz_attempts (id) on delete cascade,
  card_id     uuid not null,
  question    text not null,
  expected    text not null,
  given       text not null,
  correct     boolean not null,
  primary key (attempt_id, card_id)
);

alter table public.quizzes       enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers  enable row level security;
alter table public.quizzes       force row level security;
alter table public.quiz_attempts force row level security;
alter table public.quiz_answers  force row level security;

revoke all on public.quizzes from public, anon, authenticated;
revoke all on public.quiz_attempts from public, anon, authenticated;
revoke all on public.quiz_answers from public, anon, authenticated;
grant select (id, class_id, deck_id, title, due_at, closed_at, created_at, created_by) on public.quizzes to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select on public.quiz_answers to authenticated;

create policy "quizzes: class can read"
  on public.quizzes for select to authenticated
  using (
    public.is_class_teacher(class_id)
    or public.is_class_member(class_id)
  );

create policy "quiz_attempts: own or teacher"
  on public.quiz_attempts for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.quizzes q
      where q.id = quiz_attempts.quiz_id
        and public.is_class_teacher(q.class_id)
    )
  );

create policy "quiz_answers: own or teacher"
  on public.quiz_answers for select to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.id = quiz_answers.attempt_id
        and (
          a.student_id = (select auth.uid())
          or public.is_class_teacher(q.class_id)
        )
    )
  );

-- Same comparison as normalizeTypedAnswer: trim, lower case, collapse spaces.
create or replace function public.quiz_answer_matches(p_given text, p_expected text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_given, '')), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(coalesce(p_expected, '')), '\s+', ' ', 'g'));
$$;

revoke execute on function public.quiz_answer_matches(text, text) from public, anon, authenticated;

create or replace function public.give_class_quiz(p_deck_id uuid, p_due_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_title text;
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

  select d.class_id, d.title, c.teacher_id
    into v_class, v_title, v_teacher
  from public.decks d
  join public.classes c on c.id = d.class_id
  where d.id = p_deck_id
  for update of d;

  if not found or v_teacher is distinct from auth.uid() then
    raise exception 'Only the teacher of this class can give a quiz.' using errcode = '42501';
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

create or replace function public.close_class_quiz(p_quiz_id uuid)
returns uuid
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

  update public.quizzes
  set closed_at = now()
  where id = p_quiz_id
    and closed_at is null
    and public.is_class_teacher(class_id)
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  if exists (
    select 1
    from public.quizzes q
    where q.id = p_quiz_id
      and public.is_class_teacher(q.class_id)
  ) then
    raise exception 'This quiz is already closed.' using errcode = '22023';
  end if;

  raise exception 'That quiz is not available.' using errcode = '42501';
end;
$$;

create or replace function public.record_quiz_answer(
  p_quiz_id uuid,
  p_card_id uuid,
  p_given text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class uuid;
  v_cards jsonb;
  v_closed timestamptz;
  v_due timestamptz;
  v_attempt uuid;
  v_finished timestamptz;
  v_card jsonb;
  v_question text;
  v_expected text;
  v_given text := left(btrim(coalesce(p_given, '')), 500);
  v_correct boolean;
  v_total integer;
  v_answered integer;
  v_correct_count integer;
  v_done boolean := false;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if v_given = '' then
    raise exception 'Enter an answer.' using errcode = '22023';
  end if;

  select class_id, cards, closed_at, due_at
    into v_class, v_cards, v_closed, v_due
  from public.quizzes
  where id = p_quiz_id
  for update;

  if not found or not public.is_class_member(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  select elem
    into v_card
  from jsonb_array_elements(v_cards) as elem
  where elem->>'id' = p_card_id::text
  limit 1;

  if v_card is null then
    raise exception 'That card is not in this quiz.' using errcode = '22023';
  end if;

  v_question := v_card->>'question';
  v_expected := v_card->>'answer';
  v_total := jsonb_array_length(v_cards);

  select id, finished_at
    into v_attempt, v_finished
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
  for update;

  if not found then
    if v_closed is not null or (v_due is not null and v_due <= now()) then
      raise exception 'This quiz is closed.' using errcode = '42501';
    end if;

    begin
      insert into public.quiz_attempts (quiz_id, student_id)
      values (p_quiz_id, v_uid)
      returning id into v_attempt;
    exception
      when unique_violation then
        select id, finished_at
          into v_attempt, v_finished
        from public.quiz_attempts
        where quiz_id = p_quiz_id
          and student_id = v_uid
        for update;
    end;
  end if;

  if v_finished is not null then
    raise exception 'This quiz is already finished.' using errcode = '22023';
  end if;

  v_correct := public.quiz_answer_matches(v_given, v_expected);

  insert into public.quiz_answers (attempt_id, card_id, question, expected, given, correct)
  values (v_attempt, p_card_id, v_question, v_expected, v_given, v_correct)
  on conflict (attempt_id, card_id) do nothing;

  select a.correct, a.expected
    into v_correct, v_expected
  from public.quiz_answers a
  where a.attempt_id = v_attempt
    and a.card_id = p_card_id;

  select count(*)::integer,
         count(*) filter (where correct)::integer
    into v_answered, v_correct_count
  from public.quiz_answers
  where attempt_id = v_attempt;

  if v_answered >= v_total then
    update public.quiz_attempts
    set finished_at = coalesce(finished_at, now()),
        correct_count = v_correct_count,
        total_count = v_total
    where id = v_attempt;
    v_done := true;
  end if;

  return jsonb_build_object(
    'correct', v_correct,
    'expected', v_expected,
    'finished', v_done,
    'correctCount', case when v_done then v_correct_count else null end,
    'total', case when v_done then v_total else null end
  );
end;
$$;

-- Questions for the quiz page. Choice quizzes include the option text.
-- Typed quizzes do not include the saved answer.
create or replace function public.quiz_play_cards(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_cards jsonb;
  v_card record;
  v_other record;
  v_choice boolean := true;
  v_correct text;
  v_key text;
  v_text text;
  v_other_key text;
  v_seen text[];
  v_distractors text[];
  v_options jsonb;
  v_all jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, cards
    into v_class, v_cards
  from public.quizzes
  where id = p_quiz_id;

  if not found or not (
    public.is_class_member(v_class) or public.is_class_teacher(v_class)
  ) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  for v_card in select elem from jsonb_array_elements(v_cards) as listed(elem)
  loop
    v_seen := array[lower(regexp_replace(btrim(v_card.elem->>'answer'), '\s+', ' ', 'g'))];
    v_distractors := '{}';
    for v_other in select elem from jsonb_array_elements(v_cards) as listed(elem)
    loop
      if (v_other.elem->>'id') = (v_card.elem->>'id') then
        continue;
      end if;
      v_text := btrim(v_other.elem->>'answer');
      v_other_key := lower(regexp_replace(v_text, '\s+', ' ', 'g'));
      if v_other_key = '' or v_other_key = any (v_seen) then
        continue;
      end if;
      v_seen := array_append(v_seen, v_other_key);
      v_distractors := array_append(v_distractors, v_text);
      exit when coalesce(array_length(v_distractors, 1), 0) >= 3;
    end loop;
    if coalesce(array_length(v_distractors, 1), 0) < 3 then
      v_choice := false;
      exit;
    end if;
  end loop;

  for v_card in select elem from jsonb_array_elements(v_cards) as listed(elem)
  loop
    v_options := null;
    if v_choice then
      v_correct := btrim(v_card.elem->>'answer');
      v_key := lower(regexp_replace(v_correct, '\s+', ' ', 'g'));
      v_seen := array[v_key];
      v_distractors := array[v_correct];
      for v_other in select elem from jsonb_array_elements(v_cards) as listed(elem)
      loop
        if (v_other.elem->>'id') = (v_card.elem->>'id') then
          continue;
        end if;
        v_text := btrim(v_other.elem->>'answer');
        v_other_key := lower(regexp_replace(v_text, '\s+', ' ', 'g'));
        if v_other_key = '' or v_other_key = any (v_seen) then
          continue;
        end if;
        v_seen := array_append(v_seen, v_other_key);
        v_distractors := array_append(v_distractors, v_text);
        exit when coalesce(array_length(v_distractors, 1), 0) >= 4;
      end loop;
      select coalesce(jsonb_agg(opt order by md5((v_card.elem->>'id') || opt)), '[]'::jsonb)
        into v_options
      from unnest(v_distractors) as opt;
    end if;

    v_all := v_all || jsonb_build_array(
      jsonb_build_object(
        'id', v_card.elem->>'id',
        'question', v_card.elem->>'question',
        'options', v_options
      )
    );
  end loop;

  return v_all;
end;
$$;

revoke execute on function public.give_class_quiz(uuid, timestamptz) from public, anon;
revoke execute on function public.close_class_quiz(uuid) from public, anon;
revoke execute on function public.record_quiz_answer(uuid, uuid, text) from public, anon;
revoke execute on function public.quiz_play_cards(uuid) from public, anon;
grant execute on function public.give_class_quiz(uuid, timestamptz) to authenticated;
grant execute on function public.close_class_quiz(uuid) to authenticated;
grant execute on function public.record_quiz_answer(uuid, uuid, text) to authenticated;
grant execute on function public.quiz_play_cards(uuid) to authenticated;
