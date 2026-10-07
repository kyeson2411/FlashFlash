-- AutoFlash - Phase 7: hidden SM-2 scheduling, study modes, and personal review history.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Supabase CLI    : place the file in supabase/migrations and run `supabase db push`.
--
-- Students still only choose Know it or Still learning. This file maps those
-- choices to SuperMemo-2 quality scores inside the database. Ease factor,
-- repetitions, and interval are never granted back to the browser.

-- ---------------------------------------------------------------------------
-- 1. Hidden scheduling columns on flashcards
-- ---------------------------------------------------------------------------
alter table public.flashcards
  add column ease_factor      numeric(4, 2) not null default 2.50
    check (ease_factor >= 1.30),
  add column repetitions      int           not null default 0
    check (repetitions >= 0),
  add column interval_days    int           not null default 0
    check (interval_days >= 0),
  add column due_at           timestamptz   not null default now(),
  add column last_reviewed_at timestamptz;

create index flashcards_deck_due_idx on public.flashcards (deck_id, due_at);

-- Phase 6 allowed `update (state)`, which would skip the algorithm.
revoke update on public.flashcards from authenticated;

-- Hide the formula columns. `due_at` stays readable so the server can build
-- the study queue and the personal "ready" counts. The UI does not display it.
revoke select on public.flashcards from authenticated;
grant select (id, deck_id, position, question, answer, state, created_at, due_at)
  on public.flashcards to authenticated;

-- ---------------------------------------------------------------------------
-- 2. review_events: this student's own history (not a grade, not a ranking)
-- ---------------------------------------------------------------------------
create table public.review_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  deck_id     uuid references public.decks (id) on delete set null,
  card_id     uuid references public.flashcards (id) on delete set null,
  outcome     text not null check (outcome in ('known', 'learning')),
  mode        text not null check (mode in ('flip', 'choice', 'typing')),
  reviewed_at timestamptz not null default now()
);

create index review_events_owner_reviewed_idx
  on public.review_events (owner_id, reviewed_at desc);

revoke all on public.review_events from public, anon, authenticated;
grant select, insert on public.review_events to authenticated;

alter table public.review_events enable row level security;
alter table public.review_events force row level security;

create policy "review_events: read own"
  on public.review_events for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "review_events: append own"
  on public.review_events for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. review_flashcard: Know it / Still learning -> SM-2, then one history row
-- ---------------------------------------------------------------------------
create function public.review_flashcard(
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
  v_owner   uuid;
  v_deck_id uuid;
  v_n       int;
  v_i       int;
  v_ef      numeric;
  v_q       int;
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

  select d.owner_id, d.id, f.repetitions, f.interval_days, f.ease_factor
    into v_owner, v_deck_id, v_n, v_i, v_ef
  from public.flashcards f
  join public.decks d on d.id = f.deck_id
  where f.id = p_card_id
  for update of f;

  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;

  if v_owner is distinct from auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  -- Know it = 5, Still learning = 2. The browser never sends this number.
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
    v_i := 1;
  end if;

  v_ef := v_ef + (0.1 - (5 - v_q) * (0.08 + (5 - v_q) * 0.02));
  if v_ef < 1.3 then
    v_ef := 1.3;
  end if;

  update public.flashcards
  set state            = case when v_q >= 3 then 'known' else 'learning' end,
      repetitions      = v_n,
      interval_days    = v_i,
      ease_factor      = v_ef,
      due_at           = now() + make_interval(days => v_i),
      last_reviewed_at = now()
  where id = p_card_id;

  insert into public.review_events (owner_id, deck_id, card_id, outcome, mode)
  values (auth.uid(), v_deck_id, p_card_id, p_outcome, p_mode);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Clearing a mark is not a review. Restore the new-card defaults.
-- ---------------------------------------------------------------------------
create function public.reset_card_progress(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select d.owner_id into v_owner
  from public.flashcards f
  join public.decks d on d.id = f.deck_id
  where f.id = p_card_id
  for update of f;

  if not found then
    raise exception 'Card not found.' using errcode = 'P0002';
  end if;

  if v_owner is distinct from auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  update public.flashcards
  set state = 'unreviewed',
      ease_factor = 2.50,
      repetitions = 0,
      interval_days = 0,
      due_at = now(),
      last_reviewed_at = null
  where id = p_card_id;
end;
$$;

create function public.reset_deck_progress(p_deck_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.decks
    where id = p_deck_id and owner_id = auth.uid()
  ) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  update public.flashcards
  set state = 'unreviewed',
      ease_factor = 2.50,
      repetitions = 0,
      interval_days = 0,
      due_at = now(),
      last_reviewed_at = null
  where deck_id = p_deck_id;
end;
$$;

revoke execute on function public.review_flashcard(uuid, text, text) from public, anon;
grant  execute on function public.review_flashcard(uuid, text, text) to authenticated;

revoke execute on function public.reset_card_progress(uuid) from public, anon;
grant  execute on function public.reset_card_progress(uuid) to authenticated;

revoke execute on function public.reset_deck_progress(uuid) from public, anon;
grant  execute on function public.reset_deck_progress(uuid) to authenticated;
