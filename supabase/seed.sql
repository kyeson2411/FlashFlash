-- Sample class for presenting AutoFlash on a laptop.
-- Loaded after migrations on the first `supabase start`, and again on `supabase db reset`.
--
-- Teacher: teacher@autoflash.test / Teacher1flash
-- Student: student@autoflash.test / Student1flash

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'teacher@autoflash.test',
    extensions.crypt('Teacher1flash', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"teacher","full_name":"Ava Santos","school_id":"TEACHER1","privacy_consent":"true","privacy_notice_version":"2026-10"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'student@autoflash.test',
    extensions.crypt('Student1flash', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"student","full_name":"Ken Rivera","school_id":"STUDENT1","privacy_consent":"true","privacy_notice_version":"2026-10"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  id,
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  id::text,
  now(),
  now(),
  now()
from auth.users
where email in ('teacher@autoflash.test', 'student@autoflash.test');

insert into public.classes (id, teacher_id, name, code)
values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'Science',
  'BIO101'
);

insert into public.class_members (class_id, student_id, status)
values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'active'
);

insert into public.decks (id, owner_id, title, class_id)
values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'Cell structure',
  '33333333-3333-4333-8333-333333333333'
);

insert into public.flashcards (id, deck_id, position, question, answer)
values
  (
    '44444444-4444-4444-8444-444444444441',
    '44444444-4444-4444-8444-444444444444',
    1,
    'What do the mitochondria do?',
    'Make energy'
  ),
  (
    '44444444-4444-4444-8444-444444444442',
    '44444444-4444-4444-8444-444444444444',
    2,
    'What is the control center of the cell?',
    'Nucleus'
  ),
  (
    '44444444-4444-4444-8444-444444444443',
    '44444444-4444-4444-8444-444444444444',
    3,
    'What do chloroplasts do?',
    'Make food'
  ),
  (
    '44444444-4444-4444-8444-444444444440',
    '44444444-4444-4444-8444-444444444444',
    4,
    'What surrounds an animal cell?',
    'Cell membrane'
  );

update public.decks
set workflow_status = 'published'
where id = '44444444-4444-4444-8444-444444444444';

insert into public.quizzes (id, class_id, deck_id, title, cards, opens_at, due_at, created_by)
select
  '55555555-5555-4555-8555-555555555555',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  'Cell structure check',
  (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', f.id::text, 'question', f.question, 'answer', f.answer)
        order by f.position
      ),
      '[]'::jsonb
    )
    from public.flashcards f
    where f.deck_id = '44444444-4444-4444-8444-444444444444'
  ),
  now() - interval '1 hour',
  now() + interval '14 days',
  '11111111-1111-4111-8111-111111111111';
