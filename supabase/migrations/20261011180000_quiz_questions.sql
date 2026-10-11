-- AutoFlash: one question at a time, a timer on each question, and going
-- back to change answers.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this file only, after 20261011160000_quiz_settings.sql.
--
-- Students now get one question at a time from quiz_current_question. The
-- server records when each question was shown, and answers are taken only for
-- the question the student was given. Each attempt stores its own order seed
-- so the order stays the same when the student comes back.

alter table public.quizzes
  drop constraint if exists quizzes_settings_check;

alter table public.quizzes
  add constraint quizzes_settings_check check (
    late_policy in ('block', 'accept')
    and timer_mode in ('none', 'quiz', 'question')
    and (
      (timer_mode = 'none' and time_limit_seconds is null)
      or (timer_mode = 'quiz' and time_limit_seconds between 60 and 14400)
      or (timer_mode = 'question' and time_limit_seconds between 10 and 600)
    )
    and not (timer_mode = 'question' and allow_back)
    and max_attempts between 1 and 10
    and (opens_at is null or due_at is null or opens_at < due_at)
  );

alter table public.quiz_attempts
  add column if not exists order_seed text;

-- Attempts already under way keep the order they were shown.
update public.quiz_attempts
set order_seed = student_id::text || ':' || quiz_id::text || ':' || attempt_number::text
where order_seed is null;

alter table public.quiz_attempts
  alter column order_seed set default md5(gen_random_uuid()::text),
  alter column order_seed set not null;

alter table public.quiz_answers
  add column if not exists timed_out boolean not null default false;

create table if not exists public.quiz_attempt_questions (
  attempt_id  uuid not null references public.quiz_attempts (id) on delete cascade,
  card_id     uuid not null,
  position    integer not null check (position >= 1),
  issued_at   timestamptz not null default now(),
  deadline    timestamptz,
  primary key (attempt_id, card_id),
  unique (attempt_id, position)
);

alter table public.quiz_attempt_questions enable row level security;
alter table public.quiz_attempt_questions force row level security;

revoke all on public.quiz_attempt_questions from public, anon, authenticated;
grant select on public.quiz_attempt_questions to authenticated;

drop policy if exists "quiz_attempt_questions: teacher" on public.quiz_attempt_questions;
create policy "quiz_attempt_questions: teacher"
  on public.quiz_attempt_questions for select to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempts t
      join public.quizzes q on q.id = t.quiz_id
      where t.id = quiz_attempt_questions.attempt_id
        and public.is_class_teacher(q.class_id)
    )
  );

-- Multiple choice needs three different wrong answers for every card.
create or replace function public.quiz_uses_choices(p_cards jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_card record;
  v_other record;
  v_seen text[];
  v_key text;
  v_count integer;
begin
  if p_cards is null or jsonb_array_length(p_cards) = 0 then
    return false;
  end if;

  for v_card in select elem from jsonb_array_elements(p_cards) as listed(elem)
  loop
    v_seen := array[lower(regexp_replace(btrim(v_card.elem->>'answer'), '\s+', ' ', 'g'))];
    v_count := 0;
    for v_other in select elem from jsonb_array_elements(p_cards) as listed(elem)
    loop
      if (v_other.elem->>'id') = (v_card.elem->>'id') then
        continue;
      end if;
      v_key := lower(regexp_replace(btrim(v_other.elem->>'answer'), '\s+', ' ', 'g'));
      if v_key = '' or v_key = any (v_seen) then
        continue;
      end if;
      v_seen := array_append(v_seen, v_key);
      v_count := v_count + 1;
      exit when v_count >= 3;
    end loop;
    if v_count < 3 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- The four choices for one card. Without a seed every student sees the same order.
create or replace function public.quiz_choice_options(p_cards jsonb, p_card_id text, p_seed text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_card jsonb;
  v_other record;
  v_correct text;
  v_text text;
  v_key text;
  v_seen text[];
  v_options text[];
  v_result jsonb;
begin
  select elem
    into v_card
  from jsonb_array_elements(p_cards) as listed(elem)
  where elem->>'id' = p_card_id
  limit 1;

  if v_card is null then
    return null;
  end if;

  v_correct := btrim(v_card->>'answer');
  v_seen := array[lower(regexp_replace(v_correct, '\s+', ' ', 'g'))];
  v_options := array[v_correct];

  for v_other in select elem from jsonb_array_elements(p_cards) as listed(elem)
  loop
    if (v_other.elem->>'id') = p_card_id then
      continue;
    end if;
    v_text := btrim(v_other.elem->>'answer');
    v_key := lower(regexp_replace(v_text, '\s+', ' ', 'g'));
    if v_key = '' or v_key = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_key);
    v_options := array_append(v_options, v_text);
    exit when coalesce(array_length(v_options, 1), 0) >= 4;
  end loop;

  select coalesce(jsonb_agg(opt order by md5(coalesce(p_seed, '') || p_card_id || opt)), '[]'::jsonb)
    into v_result
  from unnest(v_options) as opt;

  return v_result;
end;
$$;

-- Card ids in the order this attempt shows them.
create or replace function public.quiz_attempt_order(p_attempt_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           array_agg(
             listed.elem->>'id'
             order by case
                        when q.shuffle_questions then md5(t.order_seed || (listed.elem->>'id'))
                        else lpad(listed.ord::text, 8, '0')
                      end
           ),
           '{}'::text[]
         )
  from public.quiz_attempts t
  join public.quizzes q on q.id = t.quiz_id
  cross join lateral jsonb_array_elements(q.cards) with ordinality as listed(elem, ord)
  where t.id = p_attempt_id;
$$;

-- Records that a question was shown. With a timer on each question, its
-- deadline starts now and does not pause.
create or replace function public.quiz_issue_question(p_attempt_id uuid, p_card_id text, p_position integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.quiz_attempt_questions (attempt_id, card_id, position, deadline)
  select t.id,
         p_card_id::uuid,
         p_position,
         case
           when q.timer_mode = 'question' then
             now() + make_interval(secs => q.time_limit_seconds + coalesce(a.extra_seconds, 0))
         end
  from public.quiz_attempts t
  join public.quizzes q on q.id = t.quiz_id
  left join public.quiz_accommodations a
    on a.quiz_id = t.quiz_id
   and a.student_id = t.student_id
  where t.id = p_attempt_id
  on conflict (attempt_id, card_id) do nothing;
$$;

-- Saves a blank answer for each shown question whose time ran out, then
-- finishes the attempt when every card has an answer.
create or replace function public.expire_quiz_questions(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cards jsonb;
  v_quiz uuid;
  v_student uuid;
  v_late boolean;
  v_row record;
  v_card jsonb;
  v_answered integer;
begin
  select q.cards, t.quiz_id, t.student_id
    into v_cards, v_quiz, v_student
  from public.quiz_attempts t
  join public.quizzes q on q.id = t.quiz_id
  where t.id = p_attempt_id
    and t.finished_at is null
    and q.timer_mode = 'question';

  if not found then
    return;
  end if;

  v_late := public.quiz_answer_window(v_quiz, v_student) = 'late';

  for v_row in
    select i.card_id, i.deadline
    from public.quiz_attempt_questions i
    where i.attempt_id = p_attempt_id
      and i.deadline is not null
      and i.deadline + public.quiz_grace() < now()
      and not exists (
        select 1
        from public.quiz_answers a
        where a.attempt_id = p_attempt_id
          and a.card_id = i.card_id
      )
  loop
    select elem
      into v_card
    from jsonb_array_elements(v_cards) as listed(elem)
    where elem->>'id' = v_row.card_id::text
    limit 1;

    insert into public.quiz_answers (
      attempt_id, card_id, question, expected, given, correct, late, timed_out, answered_at
    )
    values (
      p_attempt_id, v_row.card_id, coalesce(v_card->>'question', ''), coalesce(v_card->>'answer', ''),
      '', false, v_late, true, v_row.deadline
    )
    on conflict (attempt_id, card_id) do nothing;
  end loop;

  select count(*)::integer
    into v_answered
  from public.quiz_answers
  where attempt_id = p_attempt_id;

  if v_answered >= jsonb_array_length(v_cards) then
    perform public.finish_quiz_attempt(p_attempt_id, false);
  end if;
end;
$$;

-- Finishes attempts whose quiz timer ran out, saves blanks for questions whose
-- own timer ran out, and finishes attempts that can no longer take answers.
create or replace function public.finalize_expired_attempts(p_quiz_id uuid, p_student uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt uuid;
  v_timed boolean;
  v_count integer := 0;
begin
  for v_attempt in
    select t.id
    from public.quiz_attempts t
    join public.quizzes q on q.id = t.quiz_id
    where t.quiz_id = p_quiz_id
      and t.finished_at is null
      and q.timer_mode = 'question'
      and (p_student is null or t.student_id = p_student)
    for update of t
  loop
    perform public.expire_quiz_questions(v_attempt);
  end loop;

  for v_attempt, v_timed in
    select t.id,
           coalesce(public.quiz_attempt_deadline(t.id) + public.quiz_grace() < now(), false)
    from public.quiz_attempts t
    where t.quiz_id = p_quiz_id
      and t.finished_at is null
      and (p_student is null or t.student_id = p_student)
      and (
        public.quiz_attempt_deadline(t.id) + public.quiz_grace() < now()
        or public.quiz_answer_window(t.quiz_id, t.student_id) = 'closed'
      )
    for update of t
  loop
    perform public.finish_quiz_attempt(v_attempt, v_timed);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- The question this student should see now. Without going back, that is the
-- first card in their order with no answer. With going back, the student may
-- ask for any position up to one past the last question they were shown.
create or replace function public.quiz_current_question(p_quiz_id uuid, p_position integer default null)
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
  v_back boolean;
  v_hidden boolean;
  v_shuffle_c boolean;
  v_window text;
  v_attempt uuid;
  v_number integer;
  v_seed text;
  v_used integer;
  v_order text[];
  v_total integer;
  v_issued integer;
  v_position integer;
  v_card_id text;
  v_card jsonb;
  v_deadline timestamptz;
  v_answered integer;
  v_given text;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, cards, timer_mode, allow_back, results_after_due, shuffle_choices
    into v_class, v_cards, v_timer, v_back, v_hidden, v_shuffle_c
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

  select id, attempt_number, order_seed
    into v_attempt, v_number, v_seed
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is null;

  if not found then
    select count(*)::integer
      into v_used
    from public.quiz_attempts
    where quiz_id = p_quiz_id
      and student_id = v_uid;

    if v_used > 0 then
      return jsonb_build_object('finished', true);
    end if;

    v_window := public.quiz_answer_window(p_quiz_id, v_uid);
    if v_window = 'not_open' then
      raise exception 'This quiz is not open yet.' using errcode = '42501';
    end if;
    if v_window = 'closed' then
      raise exception 'This quiz is closed.' using errcode = '42501';
    end if;
    if v_timer <> 'none' then
      raise exception 'Start the quiz first.' using errcode = '22023';
    end if;

    insert into public.quiz_attempts (quiz_id, student_id, attempt_number)
    values (p_quiz_id, v_uid, 1)
    returning id, attempt_number, order_seed into v_attempt, v_number, v_seed;
  end if;

  v_window := public.quiz_answer_window(p_quiz_id, v_uid);
  v_order := public.quiz_attempt_order(v_attempt);
  v_total := coalesce(array_length(v_order, 1), 0);

  if v_back then
    select coalesce(max(position), 0)
      into v_issued
    from public.quiz_attempt_questions
    where attempt_id = v_attempt;

    if p_position is null then
      select min(o.ord)::integer
        into v_position
      from unnest(v_order) with ordinality as o(card_id, ord)
      where not exists (
        select 1
        from public.quiz_answers a
        where a.attempt_id = v_attempt
          and a.card_id::text = o.card_id
      );
    else
      v_position := p_position;
    end if;
    v_position := greatest(1, least(coalesce(v_position, v_total), v_total, v_issued + 1));
  else
    select min(o.ord)::integer
      into v_position
    from unnest(v_order) with ordinality as o(card_id, ord)
    where not exists (
      select 1
      from public.quiz_answers a
      where a.attempt_id = v_attempt
        and a.card_id::text = o.card_id
    );

    if v_position is null then
      perform public.finish_quiz_attempt(v_attempt, false);
      return jsonb_build_object('finished', true);
    end if;
  end if;

  v_card_id := v_order[v_position];
  perform public.quiz_issue_question(v_attempt, v_card_id, v_position);

  select deadline
    into v_deadline
  from public.quiz_attempt_questions
  where attempt_id = v_attempt
    and card_id = v_card_id::uuid;

  select elem
    into v_card
  from jsonb_array_elements(v_cards) as listed(elem)
  where elem->>'id' = v_card_id
  limit 1;

  select count(*)::integer
    into v_answered
  from public.quiz_answers
  where attempt_id = v_attempt;

  if v_back then
    select given
      into v_given
    from public.quiz_answers
    where attempt_id = v_attempt
      and card_id = v_card_id::uuid;
  end if;

  return jsonb_build_object(
    'finished', false,
    'attemptNumber', v_number,
    'position', v_position,
    'total', v_total,
    'answeredCount', v_answered,
    'cardId', v_card_id,
    'question', v_card->>'question',
    'options', case
      when public.quiz_uses_choices(v_cards) then
        public.quiz_choice_options(v_cards, v_card_id, case when v_shuffle_c then v_seed end)
    end,
    'given', v_given,
    'deadline', coalesce(v_deadline, public.quiz_attempt_deadline(v_attempt)),
    'questionTimer', v_timer = 'question',
    'allowBack', v_back,
    'feedback', not v_hidden and not v_back,
    'late', v_window = 'late',
    'now', now()
  );
end;
$$;

-- Saves an answer for a question the student was shown. p_timeout says the
-- question's own timer ran out: a blank is then accepted, but only once the
-- server agrees the time is up.
create or replace function public.submit_quiz_answer(
  p_quiz_id uuid,
  p_card_id uuid,
  p_given text,
  p_timeout boolean
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
  v_back boolean;
  v_hidden boolean;
  v_feedback boolean;
  v_window text;
  v_attempt uuid;
  v_deadline timestamptz;
  v_used integer;
  v_card jsonb;
  v_question text;
  v_expected text;
  v_given text := left(btrim(coalesce(p_given, '')), 500);
  v_blank boolean;
  v_correct boolean;
  v_total integer;
  v_answered integer;
  v_correct_count integer;
  v_done boolean := false;
  v_late boolean;
  v_finished timestamptz;
  v_order text[];
  v_position integer;
  v_current integer;
  v_issued boolean;
  v_issued_deadline timestamptz;
  v_saved_timed_out boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  v_blank := v_given = '';
  if v_blank and not coalesce(p_timeout, false) then
    raise exception 'Enter an answer.' using errcode = '22023';
  end if;

  select class_id, cards, timer_mode, max_attempts, allow_back, results_after_due
    into v_class, v_cards, v_timer, v_max, v_back, v_hidden
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
  v_feedback := not v_hidden and not v_back;

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
    if v_timer <> 'none' or v_used > 0 then
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
      'questionTimedOut', false,
      'late', false,
      'correctCount', case when v_hidden then null else v_correct_count end,
      'total', case when v_hidden then null else v_total end
    );
  end if;

  perform public.expire_quiz_questions(v_attempt);

  select timed_out
    into v_saved_timed_out
  from public.quiz_answers
  where attempt_id = v_attempt
    and card_id = p_card_id;

  if v_timer = 'question' and v_saved_timed_out then
    select finished_at, correct_count
      into v_finished, v_correct_count
    from public.quiz_attempts
    where id = v_attempt;
    return jsonb_build_object(
      'correct', case when v_feedback then false end,
      'expected', case when v_feedback then v_expected end,
      'finished', v_finished is not null,
      'timedOut', false,
      'questionTimedOut', true,
      'late', v_window = 'late',
      'correctCount', case when v_finished is not null and not v_hidden then v_correct_count end,
      'total', case when v_finished is not null and not v_hidden then v_total end
    );
  end if;

  v_order := public.quiz_attempt_order(v_attempt);
  v_position := array_position(v_order, p_card_id::text);

  select true, deadline
    into v_issued, v_issued_deadline
  from public.quiz_attempt_questions
  where attempt_id = v_attempt
    and card_id = p_card_id;
  v_issued := coalesce(v_issued, false);

  if v_back then
    if not v_issued then
      raise exception 'This question is no longer open. Reload the quiz to continue.' using errcode = '22023';
    end if;
  else
    select min(o.ord)::integer
      into v_current
    from unnest(v_order) with ordinality as o(card_id, ord)
    where not exists (
      select 1
      from public.quiz_answers a
      where a.attempt_id = v_attempt
        and a.card_id::text = o.card_id
    );

    if v_current is distinct from v_position or (v_timer = 'question' and not v_issued) then
      raise exception 'This question is no longer open. Reload the quiz to continue.' using errcode = '22023';
    end if;
    if not v_issued then
      perform public.quiz_issue_question(v_attempt, p_card_id::text, v_position);
    end if;
  end if;

  if v_blank and (
    v_timer <> 'question'
    or v_issued_deadline is null
    or now() < v_issued_deadline - interval '3 seconds'
  ) then
    raise exception 'Enter an answer.' using errcode = '22023';
  end if;

  v_late := v_window = 'late';
  v_correct := not v_blank and public.quiz_answer_matches(v_given, v_expected);

  insert into public.quiz_answers (attempt_id, card_id, question, expected, given, correct, late, timed_out)
  values (v_attempt, p_card_id, v_question, v_expected, v_given, v_correct, v_late, v_blank)
  on conflict (attempt_id, card_id) do update
    set given = excluded.given,
        correct = excluded.correct,
        late = excluded.late,
        answered_at = now()
    where v_back;

  select count(*)::integer,
         count(*) filter (where correct)::integer
    into v_answered, v_correct_count
  from public.quiz_answers
  where attempt_id = v_attempt;

  if not v_back and v_answered >= v_total then
    perform public.finish_quiz_attempt(v_attempt, false);
    v_done := true;
  end if;

  return jsonb_build_object(
    'correct', case when v_feedback then v_correct end,
    'expected', case when v_feedback then v_expected end,
    'finished', v_done,
    'timedOut', false,
    'questionTimedOut', v_blank,
    'late', v_late,
    'correctCount', case when v_done and not v_hidden then v_correct_count end,
    'total', case when v_done and not v_hidden then v_total end
  );
end;
$$;

-- Older pages call this. It now follows the same one-question rules.
create or replace function public.record_quiz_answer(
  p_quiz_id uuid,
  p_card_id uuid,
  p_given text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.submit_quiz_answer(p_quiz_id, p_card_id, p_given, false);
$$;

-- Hands in an attempt where the student could go back. Cards with no answer count as missed.
create or replace function public.submit_quiz_attempt(p_quiz_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class uuid;
  v_hidden boolean;
  v_attempt uuid;
  v_timed_out boolean;
  v_correct integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, results_after_due
    into v_class, v_hidden
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

  select id
    into v_attempt
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is null
  for update;

  if found then
    perform public.finish_quiz_attempt(v_attempt, false);
  else
    select id
      into v_attempt
    from public.quiz_attempts
    where quiz_id = p_quiz_id
      and student_id = v_uid
    order by attempt_number desc
    limit 1;
    if v_attempt is null then
      raise exception 'Start the quiz first.' using errcode = '22023';
    end if;
  end if;

  select timed_out, correct_count, total_count
    into v_timed_out, v_correct, v_total
  from public.quiz_attempts
  where id = v_attempt;

  return jsonb_build_object(
    'finished', true,
    'timedOut', v_timed_out,
    'correctCount', case when v_hidden then null else v_correct end,
    'total', case when v_hidden then null else v_total end
  );
end;
$$;

-- Every question, for the teacher. Students get one at a time from quiz_current_question.
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
  v_choice boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, cards
    into v_class, v_cards
  from public.quizzes
  where id = p_quiz_id;

  if not found or not public.is_class_teacher(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  v_choice := public.quiz_uses_choices(v_cards);

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', listed.elem->>'id',
               'question', listed.elem->>'question',
               'options', case when v_choice then public.quiz_choice_options(v_cards, listed.elem->>'id', null) end
             )
             order by listed.ord
           )
    from jsonb_array_elements(v_cards) with ordinality as listed(elem, ord)
  ), '[]'::jsonb);
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
  v_back boolean;
  v_late_policy text;
  v_extra integer;
  v_window text;
  v_released boolean;
  v_used integer;
  v_current uuid;
  v_current_number integer;
  v_current_started timestamptz;
  v_answered integer;
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

  select class_id, opens_at, max_attempts, timer_mode, time_limit_seconds, results_after_due, allow_back, late_policy
    into v_class, v_opens, v_max, v_timer, v_limit, v_hidden, v_back, v_late_policy
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
    select count(*)::integer
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
    'timerMode', v_timer,
    'timeLimitSeconds', case when v_timer = 'quiz' then v_limit + coalesce(v_extra, 0) end,
    'questionSeconds', case when v_timer = 'question' then v_limit + coalesce(v_extra, 0) end,
    'allowBack', v_back,
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
        'answeredCount', v_answered
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
  if v_extra > 0 and v_timer = 'none' then
    raise exception 'This quiz has no time limit.' using errcode = '22023';
  end if;
  if v_timer = 'question' and v_extra > 600 then
    raise exception 'Choose up to 600 extra seconds for each question.' using errcode = '22023';
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

-- New settings keys: timerMode ('none', 'quiz', 'question'), questionSeconds,
-- and allowBack. Without timerMode, a time limit in minutes means one timer
-- for the whole quiz, as before.
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
  v_timer text;
  v_minutes integer;
  v_seconds integer;
  v_attempts integer;
  v_shuffle_q boolean;
  v_shuffle_c boolean;
  v_results boolean;
  v_back boolean;
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
    v_seconds := nullif(v_settings->>'questionSeconds', '')::integer;
    v_timer := nullif(v_settings->>'timerMode', '');
    v_attempts := coalesce(nullif(v_settings->>'maxAttempts', '')::integer, 1);
    v_shuffle_q := coalesce((v_settings->>'shuffleQuestions')::boolean, false);
    v_shuffle_c := coalesce((v_settings->>'shuffleChoices')::boolean, false);
    v_results := coalesce((v_settings->>'resultsAfterDue')::boolean, false);
    v_back := coalesce((v_settings->>'allowBack')::boolean, false);
  exception
    when others then
      raise exception 'Check the quiz settings.' using errcode = '22023';
  end;

  if v_timer is null then
    v_timer := case when v_minutes is null then 'none' else 'quiz' end;
  end if;

  if v_late not in ('block', 'accept') or v_timer not in ('none', 'quiz', 'question') then
    raise exception 'Check the quiz settings.' using errcode = '22023';
  end if;
  if v_timer = 'quiz' and (v_minutes is null or v_minutes < 1 or v_minutes > 240) then
    raise exception 'Choose a time limit from 1 to 240 minutes.' using errcode = '22023';
  end if;
  if v_timer = 'question' and (v_seconds is null or v_seconds < 10 or v_seconds > 600) then
    raise exception 'Choose from 10 to 600 seconds for each question.' using errcode = '22023';
  end if;
  if v_timer = 'question' and v_back then
    raise exception 'Going back is not available with a timer on each question.' using errcode = '22023';
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
      shuffle_questions, shuffle_choices, allow_back, max_attempts, results_after_due
    )
    values (
      v_class, p_deck_id, v_title, v_cards, p_due_at, auth.uid(),
      v_opens, v_late, v_timer,
      case v_timer when 'quiz' then v_minutes * 60 when 'question' then v_seconds end,
      v_shuffle_q, v_shuffle_c, v_back, v_attempts, v_results
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'This deck already has an open quiz.' using errcode = '23505';
  end;

  return v_id;
end;
$$;

revoke all on function public.quiz_uses_choices(jsonb) from public, anon, authenticated;
revoke all on function public.quiz_choice_options(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.quiz_attempt_order(uuid) from public, anon, authenticated;
revoke all on function public.quiz_issue_question(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.expire_quiz_questions(uuid) from public, anon, authenticated;
revoke all on function public.finalize_expired_attempts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quiz_current_question(uuid, integer) from public, anon;
revoke all on function public.submit_quiz_answer(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.submit_quiz_attempt(uuid) from public, anon;
revoke all on function public.record_quiz_answer(uuid, uuid, text) from public, anon;

grant execute on function public.quiz_current_question(uuid, integer) to authenticated;
grant execute on function public.submit_quiz_answer(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated;
grant execute on function public.record_quiz_answer(uuid, uuid, text) to authenticated;
