-- AutoFlash: let a teacher see when a student last reviewed a class card.
--
-- How to apply
--   Hosted Supabase : Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run this after 20261009000000_undo_and_progress.sql.
--
-- last_reviewed_at is the day of the review, not the hidden schedule.
-- Row security still limits a teacher to cards in their own classes.

grant select (last_reviewed_at) on public.student_card_progress to authenticated;
