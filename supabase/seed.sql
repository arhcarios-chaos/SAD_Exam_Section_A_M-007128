-- Run AFTER schema.sql, and AFTER creating the two test accounts in Supabase Auth
-- (Authentication > Users > Add user, tick "Auto confirm"):
--   staff@example.test    and    scholar@example.test
-- Seed records are synthetic test inputs, not official grades.

insert into public.scholars (student_id, full_name, program_id)
select v.sid, v.nm, p.id
from (values
  ('A01','Ana Reyes','MERIT'),
  ('A02','Ben Cruz','MERIT'),
  ('A03','Carla Santos','COMMUNITY'),
  ('A04','Dino Garcia','COMMUNITY'),
  ('A05','Elena Flores','MERIT'),
  ('A06','Felix Ramos','COMMUNITY')
) v(sid, nm, code) join public.programs p on p.code = v.code
on conflict (student_id) do nothing;

-- AY 2026-2027 Semester 1. Deadline is 2026-10-30 17:00 Asia/Manila.
insert into public.submissions (scholar_id, academic_year, semester, gwa, units, failed_count, incomplete_count, dropped_count, evidence_ref, submitted_at, verification_status)
select s.id, '2026-2027', 1, v.gwa, v.units, v.failed, v.inc, v.drp, 'SYNTHETIC-GRADES-' || v.sid || '.pdf', v.ts::timestamptz, v.vs
from (values
  ('A01', 1.75, 18, 0, 0, 0, '2026-10-30 17:00:00+08', 'Verified'),  -- exactly at deadline
  ('A02', 1.76, 18, 0, 0, 0, '2026-10-29 17:00:00+08', 'Verified'),
  ('A03', 2.25, 15, 0, 0, 1, '2026-10-29 17:00:00+08', 'Verified'),
  ('A04', 2.25, 14, 0, 1, 0, '2026-10-29 17:00:00+08', 'Verified'),
  ('A05', 1.50, 18, 1, 0, 0, '2026-10-30 17:01:00+08', 'Verified'),  -- one minute late
  ('A06', 2.00, 15, 0, 0, 0, '2026-10-29 17:00:00+08', 'Pending')    -- pending verification
) v(sid, gwa, units, failed, inc, drp, ts, vs)
join public.scholars s on s.student_id = v.sid
on conflict (scholar_id, academic_year, semester) do nothing;

insert into public.history (submission_id, action, from_value, to_value, note, actor_name)
select id, 'Seeded', null, verification_status, 'Synthetic test record', 'seed script' from public.submissions;

-- Test accounts: staff role + link the scholar login to A06 (used for TC06-TC09).
update public.profiles set role = 'staff', full_name = 'Test Staff' where email = 'staff@example.test';
update public.profiles set full_name = 'Felix Ramos' where email = 'scholar@example.test';
update public.scholars set user_id = (select id from public.profiles where email = 'scholar@example.test')
where student_id = 'A06';
