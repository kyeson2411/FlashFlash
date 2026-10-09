-- AutoFlash: undo the last review, and aggregate progress in the database.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261008010001_fix_class_policy_recursion.sql.
--
-- Scheduling math must stay aligned with src/lib/schedule.ts.
-- The progress counts must stay aligned with src/lib/progress-summary.ts.

-- ---------------------------------------------------------------------------
-- 1. One undo slot per student: the scheduling values from before the last review
-- ---------------------------------------------------------------------------
create table public.review_undo (
  owner_id              uuid primary key references public.profiles (id) on delete cascade,
  card_id               uuid not null,
  deck_id               uuid,
  class_card            boolean not null,
  had_progress          boolean not null,
  prev_state            text,
  prev_repetitions      int,
  prev_interval_days    int,
  prev_ease_factor      numeric(4, 2),
  prev_due_at           timestamptz,
  prev_last_reviewed_at timestamptz,
  event_id              uuid,
  created_at            timestamptz not null default now()
);

alter table public.review_undo enable row level security;
alter table public.review_undo force row level security;
revoke all on public.review_undo from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. review_flashcard remembers the previous schedule, then applies SM-2
-- ---------------------------------------------------------------------------
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
    if not exists (
      select 1 from public.class_members m
      where m.class_id = v_class_id
        and m.student_id = auth.uid()
    ) then
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

  -- Know it = 5, Still learning = 2. Matches src/lib/schedule.ts.
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

revoke execute on function public.review_flashcard(uuid, text, text) from public, anon;
grant execute on function public.review_flashcard(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Undo only the latest saved answer for this student
-- ---------------------------------------------------------------------------
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
    if not exists (
      select 1 from public.class_members m
      where m.class_id = v_class_id
        and m.student_id = auth.uid()
    ) then
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

revoke execute on function public.undo_last_review(uuid) from public, anon;
grant execute on function public.undo_last_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Streak, this week, and due buckets without shipping every review to the app
--    Counts match summarizeProgress in src/lib/progress-summary.ts.
-- ---------------------------------------------------------------------------
create or replace function public.student_progress_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today       date := (timezone('Asia/Manila', now()))::date;
  v_tomorrow    timestamptz := (v_today + 1)::timestamp at time zone 'Asia/Manila';
  v_soon        timestamptz := (v_today + 8)::timestamp at time zone 'Asia/Manila';
  v_streak      int := 0;
  v_days        jsonb := '[]'::jsonb;
  v_ready_today int := 0;
  v_ready_soon  int := 0;
  v_ready_later int := 0;
  v_has_reviews boolean := false;
  v_has_cards   boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.review_events where owner_id = auth.uid()
  ) into v_has_reviews;

  select exists (select 1 from public.flashcards) into v_has_cards;

  with recursive studied as (
    select distinct (reviewed_at at time zone 'Asia/Manila')::date as day
    from public.review_events
    where owner_id = auth.uid()
  ),
  walk as (
    select day
    from studied
    where day = case
      when exists (select 1 from studied where day = v_today) then v_today
      else v_today - 1
    end
    union all
    select s.day
    from studied s
    join walk w on s.day = w.day - 1
  )
  select count(*)::int into v_streak from walk;

  select coalesce(jsonb_agg(
    jsonb_build_object('key', to_char(day, 'YYYY-MM-DD'), 'count', reviews)
    order by day
  ), '[]'::jsonb)
  into v_days
  from (
    select gs::date as day, count(e.id)::int as reviews
    from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') as gs
    left join public.review_events e
      on e.owner_id = auth.uid()
     and (e.reviewed_at at time zone 'Asia/Manila')::date = gs::date
    group by gs::date
  ) counts;

  select
    count(*) filter (where due_at < v_tomorrow),
    count(*) filter (where due_at >= v_tomorrow and due_at < v_soon),
    count(*) filter (where due_at >= v_soon)
  into v_ready_today, v_ready_soon, v_ready_later
  from public.flashcards
  where state = 'known';

  return jsonb_build_object(
    'streak', v_streak,
    'days', v_days,
    'ready_today', v_ready_today,
    'ready_soon', v_ready_soon,
    'ready_later', v_ready_later,
    'has_reviews', v_has_reviews,
    'has_cards', v_has_cards
  );
end;
$$;

revoke execute on function public.student_progress_snapshot() from public, anon;
grant execute on function public.student_progress_snapshot() to authenticated;

create or replace function public.deck_last_reviewed()
returns table (deck_id uuid, reviewed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.deck_id, max(e.reviewed_at)
  from public.review_events e
  where e.owner_id = auth.uid()
    and e.deck_id is not null
  group by e.deck_id;
$$;

revoke execute on function public.deck_last_reviewed() from public, anon;
grant execute on function public.deck_last_reviewed() to authenticated;
