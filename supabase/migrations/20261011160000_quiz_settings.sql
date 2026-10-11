-- AutoFlash: quiz settings, more than one attempt, late work, and
-- per-student extensions.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this file only, after 20261011140000_deck_workflow.sql.
--
-- Existing quizzes keep today's behavior: open now, late work blocked, no
-- timer, one attempt, results right away. Every answer asks
-- quiz_answer_window whether this student may answer right now, including
-- attempts that already started.

alter table public.quizzes
  add column if not exists opens_at timestamptz,
  add column if not exists late_policy text not null default 'block',
  add column if not exists timer_mode text not null default 'none',
  add column if not exists time_limit_seconds integer,
  add column if not exists shuffle_questions boolean not null default false,
  add column if not exists shuffle_choices boolean not null default false,
  add column if not exists allow_back boolean not null default false,
  add column if not exists max_attempts integer not null default 1,
  add column if not exists results_after_due boolean not null default false;

alter table public.quizzes
  drop constraint if exists quizzes_settings_check;

alter table public.quizzes
  add constraint quizzes_settings_check check (
    late_policy in ('block', 'accept')
    and timer_mode in ('none', 'quiz')
    and (
      (timer_mode = 'none' and time_limit_seconds is null)
      or (timer_mode = 'quiz' and time_limit_seconds between 60 and 14400)
    )
    and max_attempts between 1 and 10
    and (opens_at is null or due_at is null or opens_at < due_at)
  );

grant select (
  opens_at, late_policy, timer_mode, time_limit_seconds, shuffle_questions,
  shuffle_choices, allow_back, max_attempts, results_after_due
) on public.quizzes to authenticated;

alter table public.quiz_attempts
  add column if not exists attempt_number integer not null default 1,
  add column if not exists late boolean not null default false,
  add column if not exists timed_out boolean not null default false;

alter table public.quiz_attempts
  drop constraint if exists quiz_attempts_attempt_number_check;

alter table public.quiz_attempts
  add constraint quiz_attempts_attempt_number_check check (attempt_number between 1 and 10);

alter table public.quiz_attempts
  drop constraint if exists quiz_attempts_quiz_id_student_id_key;

create unique index if not exists quiz_attempts_number_idx
  on public.quiz_attempts (quiz_id, student_id, attempt_number);

-- One unfinished attempt per student per quiz.
create unique index if not exists quiz_attempts_one_open_idx
  on public.quiz_attempts (quiz_id, student_id)
  where finished_at is null;

alter table public.quiz_answers
  add column if not exists answered_at timestamptz not null default now(),
  add column if not exists late boolean not null default false;

create table if not exists public.quiz_accommodations (
  quiz_id        uuid not null references public.quizzes (id) on delete cascade,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  due_at         timestamptz,
  extra_seconds  integer not null default 0 check (extra_seconds between 0 and 14400),
  updated_at     timestamptz not null default now(),
  primary key (quiz_id, student_id)
);

alter table public.quiz_accommodations enable row level security;
alter table public.quiz_accommodations force row level security;

revoke all on public.quiz_accommodations from public, anon, authenticated;
grant select on public.quiz_accommodations to authenticated;

drop policy if exists "quiz_accommodations: teacher or own" on public.quiz_accommodations;
create policy "quiz_accommodations: teacher or own"
  on public.quiz_accommodations for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.quizzes q
      where q.id = quiz_accommodations.quiz_id
        and public.is_class_teacher(q.class_id)
    )
  );

create or replace function public.quiz_grace()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '5 seconds';
$$;

-- A student's due time: the quiz due time, or their later extension.
create or replace function public.quiz_effective_due(p_quiz_id uuid, p_student uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when q.due_at is null then null
           else greatest(q.due_at, coalesce(a.due_at, q.due_at))
         end
  from public.quizzes q
  left join public.quiz_accommodations a
    on a.quiz_id = q.id
   and a.student_id = p_student
  where q.id = p_quiz_id;
$$;

-- not_open, open, late (accepted and marked), or closed.
create or replace function public.quiz_answer_window(p_quiz_id uuid, p_student uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_closed timestamptz;
  v_opens timestamptz;
  v_late text;
  v_due timestamptz;
begin
  select closed_at, opens_at, late_policy
    into v_closed, v_opens, v_late
  from public.quizzes
  where id = p_quiz_id;

  if not found or v_closed is not null then
    return 'closed';
  end if;

  if v_opens is not null and now() < v_opens then
    return 'not_open';
  end if;

  v_due := public.quiz_effective_due(p_quiz_id, p_student);
  if v_due is null or now() < v_due then
    return 'open';
  end if;

  if v_late = 'accept' then
    return 'late';
  end if;

  return 'closed';
end;
$$;

create or replace function public.quiz_answers_accepted(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.quiz_answer_window(p_quiz_id, auth.uid()) in ('open', 'late');
$$;

-- Scores and saved answers are visible to students once this is true. With
-- late work accepted, results wait until the teacher closes the quiz.
create or replace function public.quiz_results_released(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not q.results_after_due
        or q.closed_at is not null
        or (
          q.late_policy = 'block'
          and q.due_at is not null
          and now() >= greatest(
            q.due_at,
            coalesce(
              (select max(a.due_at) from public.quiz_accommodations a where a.quiz_id = q.id),
              q.due_at
            )
          )
        )
    from public.quizzes q
    where q.id = p_quiz_id
  ), false);
$$;

create or replace function public.quiz_attempt_deadline(p_attempt_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when q.timer_mode = 'quiz' then
             t.started_at + make_interval(secs => q.time_limit_seconds + coalesce(a.extra_seconds, 0))
         end
  from public.quiz_attempts t
  join public.quizzes q on q.id = t.quiz_id
  left join public.quiz_accommodations a
    on a.quiz_id = t.quiz_id
   and a.student_id = t.student_id
  where t.id = p_attempt_id;
$$;

create or replace function public.finish_quiz_attempt(p_attempt_id uuid, p_timed_out boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_correct integer;
  v_late boolean;
  v_deadline timestamptz;
begin
  select jsonb_array_length(q.cards)
    into v_total
  from public.quiz_attempts t
  join public.quizzes q on q.id = t.quiz_id
  where t.id = p_attempt_id;

  select count(*) filter (where correct)::integer,
         coalesce(bool_or(late), false)
    into v_correct, v_late
  from public.quiz_answers
  where attempt_id = p_attempt_id;

  v_deadline := public.quiz_attempt_deadline(p_attempt_id);

  update public.quiz_attempts
  set finished_at = case when p_timed_out then least(coalesce(v_deadline, now()), now()) else now() end,
      correct_count = v_correct,
      total_count = v_total,
      late = v_late,
      timed_out = p_timed_out
  where id = p_attempt_id
    and finished_at is null;
end;
$$;

-- Finishes timed attempts whose time ran out. Unanswered cards count as wrong.
create or replace function public.finalize_expired_attempts(p_quiz_id uuid, p_student uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt uuid;
  v_count integer := 0;
begin
  for v_attempt in
    select t.id
    from public.quiz_attempts t
    where t.quiz_id = p_quiz_id
      and t.finished_at is null
      and (p_student is null or t.student_id = p_student)
      and public.quiz_attempt_deadline(t.id) + public.quiz_grace() < now()
    for update of t
  loop
    perform public.finish_quiz_attempt(v_attempt, true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.finalize_quiz_attempts(p_quiz_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id into v_class from public.quizzes where id = p_quiz_id;

  if found and public.is_class_teacher(v_class) then
    return public.finalize_expired_attempts(p_quiz_id, null);
  end if;
  if found and public.is_class_member(v_class) then
    return public.finalize_expired_attempts(p_quiz_id, auth.uid());
  end if;

  raise exception 'That quiz is not available.' using errcode = '42501';
end;
$$;

create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class uuid;
  v_max integer;
  v_window text;
  v_attempt uuid;
  v_number integer;
  v_started timestamptz;
  v_used integer;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, max_attempts
    into v_class, v_max
  from public.quizzes
  where id = p_quiz_id;

  if not found or not public.is_class_member(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('quiz-attempt'),
    pg_catalog.hashtext(p_quiz_id::text || v_uid::text)
  );
  perform public.finalize_expired_attempts(p_quiz_id, v_uid);

  select id, attempt_number, started_at
    into v_attempt, v_number, v_started
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is null;

  if not found then
    v_window := public.quiz_answer_window(p_quiz_id, v_uid);
    if v_window = 'not_open' then
      raise exception 'This quiz is not open yet.' using errcode = '42501';
    end if;
    if v_window = 'closed' then
      raise exception 'This quiz is closed.' using errcode = '42501';
    end if;

    select count(*)::integer
      into v_used
    from public.quiz_attempts
    where quiz_id = p_quiz_id
      and student_id = v_uid;

    if v_used >= v_max then
      raise exception 'You have used every attempt for this quiz.' using errcode = '22023';
    end if;

    insert into public.quiz_attempts (quiz_id, student_id, attempt_number)
    values (p_quiz_id, v_uid, v_used + 1)
    returning id, attempt_number, started_at into v_attempt, v_number, v_started;
  end if;

  return jsonb_build_object(
    'attemptNumber', v_number,
    'startedAt', v_started,
    'deadline', public.quiz_attempt_deadline(v_attempt)
  );
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
  v_timer text;
  v_max integer;
  v_hidden boolean;
  v_window text;
  v_attempt uuid;
  v_deadline timestamptz;
  v_used integer;
  v_card jsonb;
  v_question text;
  v_expected text;
  v_given text := left(btrim(coalesce(p_given, '')), 500);
  v_correct boolean;
  v_total integer;
  v_answered integer;
  v_correct_count integer;
  v_done boolean := false;
  v_late boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if v_given = '' then
    raise exception 'Enter an answer.' using errcode = '22023';
  end if;

  select class_id, cards, timer_mode, max_attempts, results_after_due
    into v_class, v_cards, v_timer, v_max, v_hidden
  from public.quizzes
  where id = p_quiz_id;

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('quiz-attempt'),
    pg_catalog.hashtext(p_quiz_id::text || v_uid::text)
  );

  v_window := public.quiz_answer_window(p_quiz_id, v_uid);
  if v_window = 'not_open' then
    raise exception 'This quiz is not open yet.' using errcode = '42501';
  end if;
  if v_window = 'closed' then
    raise exception 'This quiz is closed.' using errcode = '42501';
  end if;

  select id
    into v_attempt
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is null
  for update;

  if not found then
    select count(*)::integer
      into v_used
    from public.quiz_attempts
    where quiz_id = p_quiz_id
      and student_id = v_uid;

    if v_used >= v_max then
      raise exception 'This quiz is already finished.' using errcode = '22023';
    end if;
    if v_timer = 'quiz' or v_used > 0 then
      raise exception 'Start the quiz first.' using errcode = '22023';
    end if;

    insert into public.quiz_attempts (quiz_id, student_id, attempt_number)
    values (p_quiz_id, v_uid, 1)
    returning id into v_attempt;
  end if;

  v_deadline := public.quiz_attempt_deadline(v_attempt);
  if v_deadline is not null and now() > v_deadline + public.quiz_grace() then
    perform public.finish_quiz_attempt(v_attempt, true);
    select correct_count, total_count
      into v_correct_count, v_total
    from public.quiz_attempts
    where id = v_attempt;
    return jsonb_build_object(
      'correct', null,
      'expected', null,
      'finished', true,
      'timedOut', true,
      'late', false,
      'correctCount', case when v_hidden then null else v_correct_count end,
      'total', case when v_hidden then null else v_total end
    );
  end if;

  v_late := v_window = 'late';
  v_correct := public.quiz_answer_matches(v_given, v_expected);

  insert into public.quiz_answers (attempt_id, card_id, question, expected, given, correct, late)
  values (v_attempt, p_card_id, v_question, v_expected, v_given, v_correct, v_late)
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
    perform public.finish_quiz_attempt(v_attempt, false);
    v_done := true;
  end if;

  return jsonb_build_object(
    'correct', case when v_hidden then null else v_correct end,
    'expected', case when v_hidden then null else v_expected end,
    'finished', v_done,
    'timedOut', false,
    'late', v_late,
    'correctCount', case when v_done and not v_hidden then v_correct_count end,
    'total', case when v_done and not v_hidden then v_total end
  );
end;
$$;

-- Questions for the quiz page. Students get them only while they may answer.
-- With shuffling on, each student and attempt gets its own stable order.
create or replace function public.quiz_play_cards(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class uuid;
  v_cards jsonb;
  v_timer text;
  v_max integer;
  v_shuffle_q boolean;
  v_shuffle_c boolean;
  v_teacher boolean;
  v_window text;
  v_number integer;
  v_seed text;
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
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, cards, timer_mode, max_attempts, shuffle_questions, shuffle_choices
    into v_class, v_cards, v_timer, v_max, v_shuffle_q, v_shuffle_c
  from public.quizzes
  where id = p_quiz_id;

  if not found then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  v_teacher := public.is_class_teacher(v_class);
  if not v_teacher and not public.is_class_member(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  if not v_teacher then
    v_window := public.quiz_answer_window(p_quiz_id, v_uid);
    if v_window = 'not_open' then
      raise exception 'This quiz is not open yet.' using errcode = '42501';
    end if;
    if v_window = 'closed' then
      raise exception 'This quiz is closed.' using errcode = '42501';
    end if;

    select attempt_number
      into v_number
    from public.quiz_attempts
    where quiz_id = p_quiz_id
      and student_id = v_uid
      and finished_at is null;

    if not found then
      select count(*)::integer + 1
        into v_number
      from public.quiz_attempts
      where quiz_id = p_quiz_id
        and student_id = v_uid;
      if v_number > v_max then
        raise exception 'This quiz is already finished.' using errcode = '22023';
      end if;
      if v_timer = 'quiz' then
        raise exception 'Start the quiz first.' using errcode = '22023';
      end if;
    end if;

    v_seed := v_uid::text || ':' || p_quiz_id::text || ':' || v_number::text;
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

  for v_card in
    select elem
    from jsonb_array_elements(v_cards) with ordinality as listed(elem, ord)
    order by case
               when v_shuffle_q and v_seed is not null then md5(v_seed || (elem->>'id'))
               else lpad(ord::text, 8, '0')
             end
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
      select coalesce(
               jsonb_agg(
                 opt
                 order by md5(
                   case
                     when v_shuffle_c and v_seed is not null then v_seed || (v_card.elem->>'id') || opt
                     else (v_card.elem->>'id') || opt
                   end
                 )
               ),
               '[]'::jsonb
             )
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

-- Everything the quiz page needs for the signed-in student. Scores and saved
-- answers are included only once results are released.
create or replace function public.quiz_student_state(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class uuid;
  v_opens timestamptz;
  v_max integer;
  v_timer text;
  v_limit integer;
  v_hidden boolean;
  v_late_policy text;
  v_extra integer;
  v_window text;
  v_released boolean;
  v_used integer;
  v_current uuid;
  v_current_number integer;
  v_current_started timestamptz;
  v_answered jsonb;
  v_latest uuid;
  v_latest_number integer;
  v_latest_finished timestamptz;
  v_latest_correct integer;
  v_latest_total integer;
  v_latest_late boolean;
  v_latest_timed_out boolean;
  v_missed jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, opens_at, max_attempts, timer_mode, time_limit_seconds, results_after_due, late_policy
    into v_class, v_opens, v_max, v_timer, v_limit, v_hidden, v_late_policy
  from public.quizzes
  where id = p_quiz_id;

  if not found or not public.is_class_member(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  perform public.finalize_expired_attempts(p_quiz_id, v_uid);

  v_window := public.quiz_answer_window(p_quiz_id, v_uid);
  v_released := public.quiz_results_released(p_quiz_id);

  select extra_seconds
    into v_extra
  from public.quiz_accommodations
  where quiz_id = p_quiz_id
    and student_id = v_uid;

  select count(*)::integer
    into v_used
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid;

  select id, attempt_number, started_at
    into v_current, v_current_number, v_current_started
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is null;

  if v_current is not null then
    select coalesce(jsonb_agg(card_id::text), '[]'::jsonb)
      into v_answered
    from public.quiz_answers
    where attempt_id = v_current;
  end if;

  select id, attempt_number, finished_at, correct_count, total_count, late, timed_out
    into v_latest, v_latest_number, v_latest_finished, v_latest_correct, v_latest_total, v_latest_late, v_latest_timed_out
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is not null
  order by attempt_number desc
  limit 1;

  if v_latest is not null and v_released then
    select coalesce(
             jsonb_agg(jsonb_build_object('question', question, 'expected', expected) order by answered_at),
             '[]'::jsonb
           )
      into v_missed
    from public.quiz_answers
    where attempt_id = v_latest
      and not correct;
  end if;

  return jsonb_build_object(
    'window', v_window,
    'now', now(),
    'opensAt', v_opens,
    'dueAt', public.quiz_effective_due(p_quiz_id, v_uid),
    'latePolicy', v_late_policy,
    'timeLimitSeconds', case when v_timer = 'quiz' then v_limit + coalesce(v_extra, 0) end,
    'maxAttempts', v_max,
    'attemptsUsed', v_used,
    'resultsAfterDue', v_hidden,
    'released', v_released,
    'current', case
      when v_current is null then null
      else jsonb_build_object(
        'attemptNumber', v_current_number,
        'startedAt', v_current_started,
        'deadline', public.quiz_attempt_deadline(v_current),
        'answeredCardIds', v_answered
      )
    end,
    'latest', case
      when v_latest is null then null
      else jsonb_build_object(
        'attemptNumber', v_latest_number,
        'finishedAt', v_latest_finished,
        'late', v_latest_late,
        'timedOut', v_latest_timed_out,
        'correct', case when v_released then v_latest_correct end,
        'total', case when v_released then v_latest_total end,
        'missed', case when v_released then v_missed end
      )
    end
  );
end;
$$;

-- One row per quiz for the signed-in student's class lists.
create or replace function public.my_quiz_summaries(p_quiz_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'quizId', q.id,
    'window', public.quiz_answer_window(q.id, auth.uid()),
    'dueAt', public.quiz_effective_due(q.id, auth.uid()),
    'maxAttempts', q.max_attempts,
    'attemptsUsed', (
      select count(*) from public.quiz_attempts t
      where t.quiz_id = q.id and t.student_id = auth.uid()
    ),
    'finishedCount', (
      select count(*) from public.quiz_attempts t
      where t.quiz_id = q.id and t.student_id = auth.uid() and t.finished_at is not null
    ),
    'inProgress', exists (
      select 1 from public.quiz_attempts t
      where t.quiz_id = q.id and t.student_id = auth.uid() and t.finished_at is null
    ),
    'released', public.quiz_results_released(q.id),
    'correct', case when public.quiz_results_released(q.id) then latest.correct_count end,
    'total', case when public.quiz_results_released(q.id) then latest.total_count end,
    'late', coalesce(latest.late, false)
  )), '[]'::jsonb)
  from public.quizzes q
  left join lateral (
    select t.correct_count, t.total_count, t.late
    from public.quiz_attempts t
    where t.quiz_id = q.id
      and t.student_id = auth.uid()
      and t.finished_at is not null
    order by t.attempt_number desc
    limit 1
  ) latest on true
  where auth.uid() is not null
    and q.id = any (p_quiz_ids)
    and public.is_class_member(q.class_id);
$$;

create or replace function public.set_quiz_accommodation(
  p_quiz_id uuid,
  p_student_id uuid,
  p_due_at timestamptz,
  p_extra_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_due timestamptz;
  v_timer text;
  v_extra integer := coalesce(p_extra_seconds, 0);
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, due_at, timer_mode
    into v_class, v_due, v_timer
  from public.quizzes
  where id = p_quiz_id;

  if not found or not public.is_class_teacher(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.class_members m
    where m.class_id = v_class
      and m.student_id = p_student_id
      and m.status = 'active'
  ) then
    raise exception 'That student is no longer in this class.' using errcode = '22023';
  end if;

  if v_extra < 0 or v_extra > 14400 then
    raise exception 'Choose up to 240 extra minutes.' using errcode = '22023';
  end if;
  if v_extra > 0 and v_timer <> 'quiz' then
    raise exception 'This quiz has no time limit.' using errcode = '22023';
  end if;
  if p_due_at is not null and (v_due is null or p_due_at <= v_due) then
    raise exception 'Choose a day after the quiz due date.' using errcode = '22023';
  end if;

  if p_due_at is null and v_extra = 0 then
    delete from public.quiz_accommodations
    where quiz_id = p_quiz_id
      and student_id = p_student_id;
    return;
  end if;

  insert into public.quiz_accommodations (quiz_id, student_id, due_at, extra_seconds)
  values (p_quiz_id, p_student_id, p_due_at, v_extra)
  on conflict (quiz_id, student_id) do update
    set due_at = excluded.due_at,
        extra_seconds = excluded.extra_seconds,
        updated_at = now();
end;
$$;

create or replace function public.give_class_quiz(
  p_deck_id uuid,
  p_due_at timestamptz,
  p_settings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_class uuid;
  v_title text;
  v_status text;
  v_teacher uuid;
  v_cards jsonb;
  v_id uuid;
  v_opens timestamptz;
  v_late text;
  v_minutes integer;
  v_attempts integer;
  v_shuffle_q boolean;
  v_shuffle_c boolean;
  v_results boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_due_at is not null and p_due_at <= now() then
    raise exception 'Choose today or a later day.' using errcode = '22023';
  end if;

  begin
    v_opens := nullif(v_settings->>'opensAt', '')::timestamptz;
    v_late := coalesce(nullif(v_settings->>'latePolicy', ''), 'block');
    v_minutes := nullif(v_settings->>'timeLimitMinutes', '')::integer;
    v_attempts := coalesce(nullif(v_settings->>'maxAttempts', '')::integer, 1);
    v_shuffle_q := coalesce((v_settings->>'shuffleQuestions')::boolean, false);
    v_shuffle_c := coalesce((v_settings->>'shuffleChoices')::boolean, false);
    v_results := coalesce((v_settings->>'resultsAfterDue')::boolean, false);
  exception
    when others then
      raise exception 'Check the quiz settings.' using errcode = '22023';
  end;

  if v_late not in ('block', 'accept') then
    raise exception 'Check the quiz settings.' using errcode = '22023';
  end if;
  if v_minutes is not null and (v_minutes < 1 or v_minutes > 240) then
    raise exception 'Choose a time limit from 1 to 240 minutes.' using errcode = '22023';
  end if;
  if v_attempts < 1 or v_attempts > 10 then
    raise exception 'Choose from 1 to 10 attempts.' using errcode = '22023';
  end if;
  if v_opens is not null and v_opens <= now() then
    v_opens := null;
  end if;
  if v_opens is not null and v_opens > now() + interval '366 days' then
    raise exception 'Choose an open time within a year.' using errcode = '22023';
  end if;
  if v_opens is not null and p_due_at is not null and v_opens >= p_due_at then
    raise exception 'Choose an open time before the due date.' using errcode = '22023';
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

  -- A past-due quiz that no longer takes answers from anyone is stamped closed.
  update public.quizzes q
  set closed_at = greatest(
        q.due_at,
        coalesce((select max(a.due_at) from public.quiz_accommodations a where a.quiz_id = q.id), q.due_at)
      )
  where q.deck_id = p_deck_id
    and q.closed_at is null
    and q.due_at is not null
    and q.late_policy = 'block'
    and now() >= greatest(
      q.due_at,
      coalesce((select max(a.due_at) from public.quiz_accommodations a where a.quiz_id = q.id), q.due_at)
    );

  begin
    insert into public.quizzes (
      class_id, deck_id, title, cards, due_at, created_by,
      opens_at, late_policy, timer_mode, time_limit_seconds,
      shuffle_questions, shuffle_choices, max_attempts, results_after_due
    )
    values (
      v_class, p_deck_id, v_title, v_cards, p_due_at, auth.uid(),
      v_opens, v_late,
      case when v_minutes is null then 'none' else 'quiz' end,
      case when v_minutes is null then null else v_minutes * 60 end,
      v_shuffle_q, v_shuffle_c, v_attempts, v_results
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'This deck already has an open quiz.' using errcode = '23505';
  end;

  return v_id;
end;
$$;

create or replace function public.give_class_quiz(p_deck_id uuid, p_due_at timestamptz)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.give_class_quiz(p_deck_id, p_due_at, '{}'::jsonb);
$$;

drop policy if exists "quiz_attempts: own or teacher" on public.quiz_attempts;
drop policy if exists "quiz_attempts: teacher or own released" on public.quiz_attempts;
create policy "quiz_attempts: teacher or own released"
  on public.quiz_attempts for select to authenticated
  using (
    exists (
      select 1
      from public.quizzes q
      where q.id = quiz_attempts.quiz_id
        and public.is_class_teacher(q.class_id)
    )
    or (
      student_id = (select auth.uid())
      and public.quiz_results_released(quiz_id)
    )
  );

drop policy if exists "quiz_answers: own or teacher" on public.quiz_answers;
drop policy if exists "quiz_answers: teacher or own released" on public.quiz_answers;
create policy "quiz_answers: teacher or own released"
  on public.quiz_answers for select to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.id = quiz_answers.attempt_id
        and (
          public.is_class_teacher(q.class_id)
          or (a.student_id = (select auth.uid()) and public.quiz_results_released(q.id))
        )
    )
  );

revoke all on function public.quiz_grace() from public, anon, authenticated;
revoke all on function public.quiz_effective_due(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quiz_answer_window(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quiz_attempt_deadline(uuid) from public, anon, authenticated;
revoke all on function public.finish_quiz_attempt(uuid, boolean) from public, anon, authenticated;
revoke all on function public.finalize_expired_attempts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quiz_results_released(uuid) from public, anon;
revoke all on function public.finalize_quiz_attempts(uuid) from public, anon;
revoke all on function public.start_quiz_attempt(uuid) from public, anon;
revoke all on function public.quiz_student_state(uuid) from public, anon;
revoke all on function public.my_quiz_summaries(uuid[]) from public, anon;
revoke all on function public.set_quiz_accommodation(uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function public.give_class_quiz(uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.give_class_quiz(uuid, timestamptz) from public, anon;

grant execute on function public.quiz_results_released(uuid) to authenticated;
grant execute on function public.finalize_quiz_attempts(uuid) to authenticated;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;
grant execute on function public.quiz_student_state(uuid) to authenticated;
grant execute on function public.my_quiz_summaries(uuid[]) to authenticated;
grant execute on function public.set_quiz_accommodation(uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.give_class_quiz(uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.give_class_quiz(uuid, timestamptz) to authenticated;
