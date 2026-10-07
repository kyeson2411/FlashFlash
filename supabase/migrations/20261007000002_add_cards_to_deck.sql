-- AutoFlash: add generated cards onto a deck the student already owns.
--
-- How to apply
--   Dashboard -> SQL Editor -> paste this file -> Run.
--   Run it after the Phase 6 and Phase 7 migrations.

create function public.add_cards_to_deck(
  p_deck_id uuid,
  p_cards   jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_next     int;
  v_existing int;
  v_count    int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_cards is null
     or jsonb_typeof(p_cards) <> 'array'
     or jsonb_array_length(p_cards) not between 1 and 20 then
    raise exception 'Add between 1 and 20 cards.' using errcode = '22023';
  end if;

  -- Locks the deck so two saves cannot take the same position.
  perform 1
  from public.decks
  where id = p_deck_id
  for update;

  if not found then
    raise exception 'Deck not found.' using errcode = 'P0002';
  end if;

  select count(*)::int into v_existing
  from public.flashcards
  where deck_id = p_deck_id;

  v_count := jsonb_array_length(p_cards);
  if v_existing + v_count > 200 then
    raise exception 'A deck can hold 200 cards.' using errcode = '22023';
  end if;

  select coalesce(max(position), 0) into v_next
  from public.flashcards
  where deck_id = p_deck_id;

  insert into public.flashcards (deck_id, position, question, answer)
  select p_deck_id,
         v_next + t.ord::int,
         btrim(t.card ->> 'question'),
         btrim(t.card ->> 'answer')
  from jsonb_array_elements(p_cards) with ordinality as t (card, ord);

  return p_deck_id;
end;
$$;

revoke execute on function public.add_cards_to_deck(uuid, jsonb) from public, anon;
grant  execute on function public.add_cards_to_deck(uuid, jsonb) to authenticated;
