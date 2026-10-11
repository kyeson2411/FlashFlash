-- AutoFlash: copy hard class cards into a new draft review deck.
--
-- How to apply
--   Dashboard -> SQL Editor -> paste this file -> Run.
--   Run it once, after 20261011200000_quiz_flags.sql.

create or replace function public.create_review_deck(
  p_class_id uuid,
  p_title    text,
  p_card_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_count integer := coalesce(cardinality(p_card_ids), 0);
  v_found integer;
  v_deck  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.teacher_id = auth.uid()
  ) then
    raise exception 'That class is no longer available.' using errcode = '42501';
  end if;

  if char_length(v_title) not between 1 and 200 then
    raise exception 'Enter a deck name between 1 and 200 characters.' using errcode = '22023';
  end if;

  if v_count not between 1 and 100 then
    raise exception 'Choose from 1 to 100 cards.' using errcode = '22023';
  end if;

  select count(distinct f.id)::integer
    into v_found
  from public.flashcards f
  join public.decks d on d.id = f.deck_id
  where f.id = any (p_card_ids)
    and d.class_id = p_class_id;

  if v_found <> (select count(distinct id) from unnest(p_card_ids) as ids (id)) then
    raise exception 'Some of these cards are no longer in this class.' using errcode = '22023';
  end if;

  insert into public.decks (title, class_id, owner_id)
  values (v_title, p_class_id, auth.uid())
  returning id into v_deck;

  insert into public.flashcards (deck_id, position, question, answer)
  select v_deck,
         row_number() over (order by picked.ord)::integer,
         picked.question,
         picked.answer
  from (
    select distinct on (lower(btrim(f.question)))
           ids.ord, btrim(f.question) as question, btrim(f.answer) as answer
    from unnest(p_card_ids) with ordinality as ids (id, ord)
    join public.flashcards f on f.id = ids.id
    order by lower(btrim(f.question)), ids.ord
  ) as picked;

  return v_deck;
end;
$$;

revoke execute on function public.create_review_deck(uuid, text, uuid[]) from public, anon;
grant  execute on function public.create_review_deck(uuid, text, uuid[]) to authenticated;
