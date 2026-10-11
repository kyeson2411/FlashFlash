-- AutoFlash: a closed or past-due quiz rejects every answer.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261009020000_class_quizzes.sql.
--
-- record_quiz_answer used to check the due time only when creating an attempt.
-- A student who had already answered one card could keep submitting after
-- due_at or closed_at. That decision now lives in quiz_answers_accepted and
-- runs for every answer. A later migration can teach that function a late policy.

create or replace function public.quiz_answers_accepted(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Closed by the teacher, or past due. A later migration can accept past-due
  -- answers when a late policy says so, and flag them. This is the only place
  -- that decision lives.
  select exists (
    select 1
    from public.quizzes q
    where q.id = p_quiz_id
      and q.closed_at is null
      and (q.due_at is null or q.due_at > now())
  );
$$;

revoke execute on function public.quiz_answers_accepted(uuid) from public, anon, authenticated;

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

  select class_id, cards
    into v_class, v_cards
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

  if not public.quiz_answers_accepted(p_quiz_id) then
    raise exception 'This quiz is closed.' using errcode = '42501';
  end if;

  select id, finished_at
    into v_attempt, v_finished
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
  for update;

  if not found then
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

revoke execute on function public.record_quiz_answer(uuid, uuid, text) from public, anon;
grant execute on function public.record_quiz_answer(uuid, uuid, text) to authenticated;
