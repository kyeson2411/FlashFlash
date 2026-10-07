-- AutoFlash: Still learning stays ready the same day.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261007000001_phase7_mastery.sql.
--
-- Know it still waits 1 day, then about 6 days, then longer.
-- Still learning is due again immediately, so the next Study now includes it.
-- The browser still never sees the schedule.

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
    v_i := 0;
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
      due_at           = case
                           when p_outcome = 'learning' then now()
                           else now() + make_interval(days => v_i)
                         end,
      last_reviewed_at = now()
  where id = p_card_id;

  insert into public.review_events (owner_id, deck_id, card_id, outcome, mode)
  values (auth.uid(), v_deck_id, p_card_id, p_outcome, p_mode);
end;
$$;

revoke execute on function public.review_flashcard(uuid, text, text) from public, anon;
grant  execute on function public.review_flashcard(uuid, text, text) to authenticated;
