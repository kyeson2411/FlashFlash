-- AutoFlash: stop class policies from calling each other.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261008010000_teacher_classes.sql.
--
-- The first class script let a profile lookup select class_members, which
-- selected classes, which selected class_members again. Postgres rejects that
-- and the signed-in app never finishes loading.

create or replace function public.is_class_teacher(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classes
    where id = p_class_id and teacher_id = (select auth.uid())
  );
$$;

create or replace function public.is_class_member(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_members
    where class_id = p_class_id and student_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_class_teacher(uuid) from public, anon;
revoke execute on function public.is_class_member(uuid) from public, anon;
grant execute on function public.is_class_teacher(uuid) to authenticated;
grant execute on function public.is_class_member(uuid) to authenticated;

drop policy if exists "classes: members read" on public.classes;
drop policy if exists "class_members: teacher reads roster" on public.class_members;
drop policy if exists "profiles: teacher reads class members" on public.profiles;
drop policy if exists "decks: class members read" on public.decks;
drop policy if exists "flashcards: class members read" on public.flashcards;
drop policy if exists "progress: teacher reads class" on public.student_card_progress;

create policy "classes: members read"
  on public.classes for select to authenticated
  using (public.is_class_member(id));

create policy "class_members: teacher reads roster"
  on public.class_members for select to authenticated
  using (public.is_class_teacher(class_id));

create policy "profiles: teacher reads class members"
  on public.profiles for select to authenticated
  using (exists (
    select 1
    from public.class_members m
    where m.student_id = profiles.id
      and public.is_class_teacher(m.class_id)
  ));

create policy "decks: class members read"
  on public.decks for select to authenticated
  using (class_id is not null and public.is_class_member(class_id));

create policy "flashcards: class members read"
  on public.flashcards for select to authenticated
  using (exists (
    select 1
    from public.decks d
    where d.id = flashcards.deck_id
      and d.class_id is not null
      and public.is_class_member(d.class_id)
  ));

create policy "progress: teacher reads class"
  on public.student_card_progress for select to authenticated
  using (exists (
    select 1
    from public.flashcards f
    join public.decks d on d.id = f.deck_id
    where f.id = student_card_progress.card_id
      and d.class_id is not null
      and public.is_class_teacher(d.class_id)
  ));
