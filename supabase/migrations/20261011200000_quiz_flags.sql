-- AutoFlash: notes when a student leaves the quiz page, and the teacher's
-- results summary.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this file only, after 20261011180000_quiz_questions.sql.
--
-- Leaving the page is a note for the teacher only. It never changes a score.
-- Times come from the server clock.

create table if not exists public.quiz_focus_events (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.quiz_attempts (id) on delete cascade,
  card_id      uuid,
  left_at      timestamptz not null default now(),
  returned_at  timestamptz,
  check (returned_at is null or returned_at >= left_at)
);

create index if not exists quiz_focus_events_attempt_idx
  on public.quiz_focus_events (attempt_id);

-- At most one "still away" row per attempt.
create unique index if not exists quiz_focus_events_one_away_idx
  on public.quiz_focus_events (attempt_id)
  where returned_at is null;

alter table public.quiz_focus_events enable row level security;
alter table public.quiz_focus_events force row level security;

revoke all on public.quiz_focus_events from public, anon, authenticated;
grant select on public.quiz_focus_events to authenticated;

drop policy if exists "quiz_focus_events: teacher" on public.quiz_focus_events;
create policy "quiz_focus_events: teacher"
  on public.quiz_focus_events for select to authenticated
  using (
    exists (
      select 1
      from public.quiz_attempts t
      join public.quizzes q on q.id = t.quiz_id
      where t.id = quiz_focus_events.attempt_id
        and public.is_class_teacher(q.class_id)
    )
  );

-- p_away true: the student left the quiz page. false: they came back.
-- Only counts while an attempt is open. Returns whether anything was stored.
create or replace function public.log_quiz_focus(p_quiz_id uuid, p_away boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_class uuid;
  v_attempt uuid;
  v_card uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id into v_class from public.quizzes where id = p_quiz_id;
  if not found or not public.is_class_member(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('quiz-attempt'),
    pg_catalog.hashtext(p_quiz_id::text || v_uid::text)
  );

  select id
    into v_attempt
  from public.quiz_attempts
  where quiz_id = p_quiz_id
    and student_id = v_uid
    and finished_at is null;

  if not found then
    return false;
  end if;

  if not coalesce(p_away, false) then
    update public.quiz_focus_events
    set returned_at = now()
    where attempt_id = v_attempt
      and returned_at is null;
    return found;
  end if;

  if exists (
    select 1 from public.quiz_focus_events
    where attempt_id = v_attempt and returned_at is null
  ) then
    return false;
  end if;

  if (select count(*) from public.quiz_focus_events where attempt_id = v_attempt) >= 300 then
    return false;
  end if;

  select i.card_id
    into v_card
  from public.quiz_attempt_questions i
  where i.attempt_id = v_attempt
    and not exists (
      select 1 from public.quiz_answers a
      where a.attempt_id = i.attempt_id and a.card_id = i.card_id
    )
  order by i.issued_at desc
  limit 1;

  insert into public.quiz_focus_events (attempt_id, card_id)
  values (v_attempt, v_card);
  return true;
end;
$$;

-- Teacher summary for one quiz. Scores, timing, and misses use each student's
-- latest finished attempt. Times away cover every attempt.
create or replace function public.quiz_teacher_results(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class uuid;
  v_cards jsonb;
  v_students jsonb;
  v_questions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select class_id, cards into v_class, v_cards from public.quizzes where id = p_quiz_id;
  if not found or not public.is_class_teacher(v_class) then
    raise exception 'That quiz is not available.' using errcode = '42501';
  end if;

  with latest as (
    select distinct on (t.student_id) t.id, t.student_id
    from public.quiz_attempts t
    where t.quiz_id = p_quiz_id
      and t.finished_at is not null
    order by t.student_id, t.attempt_number desc
  ),
  timing as (
    select l.student_id,
           avg(extract(epoch from (a.answered_at - i.issued_at))) as avg_seconds
    from latest l
    join public.quiz_answers a on a.attempt_id = l.id
    join public.quiz_attempt_questions i on i.attempt_id = a.attempt_id and i.card_id = a.card_id
    where a.answered_at >= i.issued_at
    group by l.student_id
  ),
  away as (
    select t.student_id,
           count(e.id) as times,
           sum(extract(epoch from (
             greatest(coalesce(e.returned_at, t.finished_at, now()), e.left_at) - e.left_at
           ))) as seconds
    from public.quiz_focus_events e
    join public.quiz_attempts t on t.id = e.attempt_id
    where t.quiz_id = p_quiz_id
    group by t.student_id
  ),
  students as (
    select distinct t.student_id from public.quiz_attempts t where t.quiz_id = p_quiz_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', s.student_id,
           'avgSeconds', round(timing.avg_seconds::numeric, 1),
           'timesAway', coalesce(away.times, 0),
           'secondsAway', round(coalesce(away.seconds, 0)::numeric)
         )), '[]'::jsonb)
    into v_students
  from students s
  left join timing on timing.student_id = s.student_id
  left join away on away.student_id = s.student_id;

  with latest as (
    select distinct on (t.student_id) t.id
    from public.quiz_attempts t
    where t.quiz_id = p_quiz_id
      and t.finished_at is not null
    order by t.student_id, t.attempt_number desc
  ),
  taken as (
    select count(*)::integer as n from latest
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'cardId', listed.elem->>'id',
           'question', listed.elem->>'question',
           'expected', listed.elem->>'answer',
           'taken', taken.n,
           'missed', taken.n - (
             select count(*)::integer
             from public.quiz_answers a
             join latest l on l.id = a.attempt_id
             where a.card_id::text = listed.elem->>'id'
               and a.correct
           )
         ) order by listed.ord), '[]'::jsonb)
    into v_questions
  from jsonb_array_elements(v_cards) with ordinality as listed(elem, ord)
  cross join taken;

  return jsonb_build_object('students', v_students, 'questions', v_questions);
end;
$$;

revoke all on function public.log_quiz_focus(uuid, boolean) from public, anon;
revoke all on function public.quiz_teacher_results(uuid) from public, anon;
grant execute on function public.log_quiz_focus(uuid, boolean) to authenticated;
grant execute on function public.quiz_teacher_results(uuid) to authenticated;
