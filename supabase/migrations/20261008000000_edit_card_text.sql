-- AutoFlash: let a student correct a card's question and answer.
-- Study state and scheduling stay on the server.
--
-- How to apply
--   Dashboard -> SQL Editor -> paste this file -> Run.
--   Run it after the Phase 7 migration.

grant update (question, answer) on public.flashcards to authenticated;
