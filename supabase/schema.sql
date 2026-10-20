-- Scholarship Monitoring and Academic Compliance System
-- Run this whole file once in the Supabase SQL editor, then run seed.sql.

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text not null default 'scholar' check (role in ('scholar','staff')),
  created_at timestamptz not null default now()
);

create table public.programs (
  id int primary key generated always as identity,
  code text unique not null,
  name text not null,
  max_gwa numeric(3,2) not null check (max_gwa between 1 and 5),
  min_units int not null check (min_units >= 0),
  max_failed int not null check (max_failed >= 0),
  max_incomplete int not null check (max_incomplete >= 0),
  max_dropped int not null check (max_dropped >= 0),
  required_evidence text not null default 'Grade document reference',
  deadline timestamptz not null
);

create table public.scholars (
  id uuid primary key default gen_random_uuid(),
  student_id text unique not null,
  full_name text not null,
  program_id int not null references public.programs(id),
  user_id uuid unique references public.profiles(id) on delete set null,
  award_status text not null default 'Active' check (award_status in ('Active','Suspended','Ended')),
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  academic_year text not null check (academic_year ~ '^\d{4}-\d{4}$'),
  semester int not null check (semester in (1,2)),
  gwa numeric(3,2) not null check (gwa between 1.00 and 5.00),
  units int not null check (units >= 0),
  failed_count int not null check (failed_count >= 0),
  incomplete_count int not null check (incomplete_count >= 0),
  dropped_count int not null check (dropped_count >= 0),
  evidence_ref text not null check (length(trim(evidence_ref)) > 0),
  submitted_at timestamptz not null default now(),
  resubmitted_at timestamptz,
  verification_status text not null default 'Pending' check (verification_status in ('Pending','Verified','Returned')),
  verification_reason text,
  compliance_result text not null default 'Not Evaluated' check (compliance_result in ('Not Evaluated','Compliant','With Deficiency')),
  deficiency_reasons text[] not null default '{}',
  policy_checks jsonb,
  renewal_decision text not null default 'Undecided' check (renewal_decision in ('Undecided','Approved','Held')),
  decision_note text,
  unique (scholar_id, academic_year, semester)
);

create table public.history (
  id bigint primary key generated always as identity,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  action text not null,
  from_value text,
  to_value text,
  note text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);

-- ---------- Auth helpers ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff')
$$;

create or replace function public.my_scholar_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.scholars where user_id = auth.uid()
$$;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(full_name, email) from public.profiles where id = auth.uid()
$$;

-- ---------- Row level security (read side) ----------
alter table public.profiles    enable row level security;
alter table public.programs    enable row level security;
alter table public.scholars    enable row level security;
alter table public.submissions enable row level security;
alter table public.history     enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy programs_read on public.programs for select to authenticated using (true);
create policy scholars_read on public.scholars for select to authenticated
  using (public.is_staff() or user_id = auth.uid());
create policy submissions_read on public.submissions for select to authenticated
  using (public.is_staff() or scholar_id = public.my_scholar_id());
create policy history_read on public.history for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.submissions s
    where s.id = history.submission_id and s.scholar_id = public.my_scholar_id()));

-- No client may write tables directly. All writes go through the functions below.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;

-- ---------- Policy data ----------
insert into public.programs (code, name, max_gwa, min_units, max_failed, max_incomplete, max_dropped, deadline) values
  ('MERIT',     'Merit Scholar',     1.75, 18, 0, 0, 0, '2026-10-30 17:00:00+08'),
  ('COMMUNITY', 'Community Scholar', 2.25, 15, 0, 0, 1, '2026-10-30 17:00:00+08');

-- ---------- Scholar management (staff) ----------
create or replace function public.register_scholar(p_student_id text, p_name text, p_program_id int, p_login_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  if not public.is_staff() then raise exception 'Only Scholarship Staff can register scholars.'; end if;
  if coalesce(trim(p_student_id),'') = '' or coalesce(trim(p_name),'') = '' then
    raise exception 'Student ID and name are required.'; end if;
  if not exists (select 1 from programs where id = p_program_id) then
    raise exception 'Select a valid scholarship program.'; end if;
  if exists (select 1 from scholars where student_id = trim(p_student_id)) then
    raise exception 'Student ID % is already registered.', trim(p_student_id); end if;
  if nullif(trim(coalesce(p_login_email,'')),'') is not null then
    select id into v_uid from profiles where lower(email) = lower(trim(p_login_email));
    if v_uid is null then raise exception 'No account exists for that email. The scholar must sign up first.'; end if;
    if exists (select 1 from scholars where user_id = v_uid) then
      raise exception 'That login is already linked to another scholar.'; end if;
  end if;
  insert into scholars(student_id, full_name, program_id, user_id)
  values (trim(p_student_id), trim(p_name), p_program_id, v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_scholar_program(p_scholar_id uuid, p_program_id int)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then raise exception 'Only Scholarship Staff can assign programs.'; end if;
  if not exists (select 1 from programs where id = p_program_id) then
    raise exception 'Select a valid scholarship program.'; end if;
  update scholars set program_id = p_program_id where id = p_scholar_id;
  -- Policy changed: earlier evaluations no longer apply.
  for r in select id, compliance_result from submissions where scholar_id = p_scholar_id and compliance_result <> 'Not Evaluated' loop
    update submissions set compliance_result='Not Evaluated', deficiency_reasons='{}', policy_checks=null,
      renewal_decision='Undecided', decision_note=null where id = r.id;
    insert into history(submission_id, action, from_value, to_value, note, actor_id, actor_name)
    values (r.id, 'Evaluation reset', r.compliance_result, 'Not Evaluated', 'Program assignment changed', auth.uid(), public.actor_name());
  end loop;
end $$;

-- ---------- Scholar submission ----------
create or replace function public.submit_grades(p_year text, p_sem int, p_gwa numeric, p_units int,
  p_failed int, p_inc int, p_drop int, p_evidence text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sid uuid; v_ex submissions%rowtype; v_id uuid;
begin
  v_sid := public.my_scholar_id();
  if v_sid is null then raise exception 'Only an assigned scholar can submit grades.'; end if;
  if p_year is null or p_year !~ '^\d{4}-\d{4}$' or split_part(p_year,'-',2)::int <> split_part(p_year,'-',1)::int + 1 then
    raise exception 'Academic year must look like 2026-2027.'; end if;
  if p_sem not in (1,2) then raise exception 'Semester must be 1 or 2.'; end if;
  if p_gwa is null or p_gwa < 1.00 or p_gwa > 5.00 then raise exception 'GWA must be between 1.00 and 5.00.'; end if;
  if p_units is null or p_units < 0 then raise exception 'Enrolled units must be a non-negative whole number.'; end if;
  if p_failed is null or p_failed < 0 then raise exception 'Failed count must be a non-negative whole number.'; end if;
  if p_inc is null or p_inc < 0 then raise exception 'Incomplete count must be a non-negative whole number.'; end if;
  if p_drop is null or p_drop < 0 then raise exception 'Dropped count must be a non-negative whole number.'; end if;
  if coalesce(trim(p_evidence),'') = '' then raise exception 'A grade-document reference is required.'; end if;

  select * into v_ex from submissions where scholar_id = v_sid and academic_year = p_year and semester = p_sem for update;
  if found then
    if v_ex.verification_status <> 'Returned' then
      raise exception 'Duplicate submission: you already submitted Academic Year % Semester %.', p_year, p_sem;
    end if;
    update submissions set gwa=p_gwa, units=p_units, failed_count=p_failed, incomplete_count=p_inc,
      dropped_count=p_drop, evidence_ref=trim(p_evidence), resubmitted_at=now(),
      verification_status='Pending', verification_reason=null, compliance_result='Not Evaluated',
      deficiency_reasons='{}', policy_checks=null, renewal_decision='Undecided', decision_note=null
    where id = v_ex.id;
    insert into history(submission_id, action, from_value, to_value, note, actor_id, actor_name)
    values (v_ex.id, 'Resubmitted', 'Returned', 'Pending', 'Previous return reason: ' || coalesce(v_ex.verification_reason,'(none)'), auth.uid(), public.actor_name());
    return v_ex.id;
  end if;

  insert into submissions(scholar_id, academic_year, semester, gwa, units, failed_count, incomplete_count, dropped_count, evidence_ref)
  values (v_sid, p_year, p_sem, p_gwa, p_units, p_failed, p_inc, p_drop, trim(p_evidence)) returning id into v_id;
  insert into history(submission_id, action, from_value, to_value, actor_id, actor_name)
  values (v_id, 'Submitted', null, 'Pending', auth.uid(), public.actor_name());
  return v_id;
end $$;

-- ---------- Verification ----------
create or replace function public.verify_submission(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r submissions%rowtype;
begin
  if not public.is_staff() then raise exception 'Only Scholarship Staff can verify evidence.'; end if;
  if p_status not in ('Verified','Returned') then raise exception 'Status must be Verified or Returned.'; end if;
  select * into r from submissions where id = p_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  if r.verification_status <> 'Pending' then
    raise exception 'Only submissions that are Pending verification can be verified or returned (current: %).', r.verification_status; end if;
  if p_status = 'Returned' and coalesce(trim(p_reason),'') = '' then
    raise exception 'A reason is required when returning evidence.'; end if;
  update submissions set verification_status = p_status, verification_reason = nullif(trim(coalesce(p_reason,'')),'') where id = p_id;
  insert into history(submission_id, action, from_value, to_value, note, actor_id, actor_name)
  values (p_id, 'Verification', r.verification_status, p_status, p_reason, auth.uid(), public.actor_name());
end $$;

-- ---------- Compliance evaluation (thresholds come from the programs table) ----------
create or replace function public.evaluate_submission(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r submissions%rowtype; p programs%rowtype;
  checks jsonb := '[]'::jsonb; reasons text[] := '{}'; v_result text; v_decision text;
begin
  if not public.is_staff() then raise exception 'Only Scholarship Staff can evaluate compliance.'; end if;
  select * into r from submissions where id = p_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  if r.verification_status <> 'Verified' then
    raise exception 'Evaluation blocked: evidence must be Verified first (current: %).', r.verification_status; end if;
  if coalesce(trim(r.evidence_ref),'') = '' then raise exception 'Evaluation blocked: evidence reference is missing.'; end if;
  select pr.* into p from programs pr join scholars s on s.program_id = pr.id where s.id = r.scholar_id;

  checks := checks || jsonb_build_object('check','GWA','rule','at most '||p.max_gwa,'actual',r.gwa::text,'pass',r.gwa <= p.max_gwa);
  if r.gwa > p.max_gwa then reasons := reasons || format('GWA %s is above the maximum of %s.', r.gwa, p.max_gwa); end if;

  checks := checks || jsonb_build_object('check','Enrolled units','rule','at least '||p.min_units,'actual',r.units::text,'pass',r.units >= p.min_units);
  if r.units < p.min_units then reasons := reasons || format('Enrolled units %s are below the minimum of %s.', r.units, p.min_units); end if;

  checks := checks || jsonb_build_object('check','Failed subjects','rule','at most '||p.max_failed,'actual',r.failed_count::text,'pass',r.failed_count <= p.max_failed);
  if r.failed_count > p.max_failed then reasons := reasons || format('Failed subjects (%s) exceed the allowed %s.', r.failed_count, p.max_failed); end if;

  checks := checks || jsonb_build_object('check','Incomplete grades','rule','at most '||p.max_incomplete,'actual',r.incomplete_count::text,'pass',r.incomplete_count <= p.max_incomplete);
  if r.incomplete_count > p.max_incomplete then reasons := reasons || format('Incomplete grades (%s) exceed the allowed %s.', r.incomplete_count, p.max_incomplete); end if;

  checks := checks || jsonb_build_object('check','Dropped subjects','rule','at most '||p.max_dropped,'actual',r.dropped_count::text,'pass',r.dropped_count <= p.max_dropped);
  if r.dropped_count > p.max_dropped then reasons := reasons || format('Dropped subjects (%s) exceed the allowed %s.', r.dropped_count, p.max_dropped); end if;

  checks := checks || jsonb_build_object('check','Submission deadline',
    'rule','on or before '||to_char(p.deadline at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI')||' (Asia/Manila)',
    'actual',to_char(r.submitted_at at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI:SS'),'pass',r.submitted_at <= p.deadline);
  if r.submitted_at > p.deadline then
    reasons := reasons || format('Submitted late: %s is after the deadline of %s (Asia/Manila).',
      to_char(r.submitted_at at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI:SS'),
      to_char(p.deadline at time zone 'Asia/Manila','YYYY-MM-DD HH24:MI')); end if;

  v_result := case when cardinality(reasons) = 0 then 'Compliant' else 'With Deficiency' end;
  v_decision := r.renewal_decision;
  if v_result <> 'Compliant' and r.renewal_decision = 'Approved' then v_decision := 'Undecided'; end if;

  update submissions set compliance_result = v_result, deficiency_reasons = reasons, policy_checks = checks,
    renewal_decision = v_decision where id = p_id;
  insert into history(submission_id, action, from_value, to_value, note, actor_id, actor_name)
  values (p_id, 'Evaluation', r.compliance_result, v_result, array_to_string(reasons, ' | '), auth.uid(), public.actor_name());
  if v_decision <> r.renewal_decision then
    insert into history(submission_id, action, from_value, to_value, note, actor_id, actor_name)
    values (p_id, 'Renewal decision', r.renewal_decision, v_decision, 'Approval cleared: re-evaluation found a deficiency', auth.uid(), public.actor_name());
  end if;
  return v_result;
end $$;

-- ---------- Renewal decision ----------
create or replace function public.decide_renewal(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r submissions%rowtype;
begin
  if not public.is_staff() then raise exception 'Only Scholarship Staff can record renewal decisions.'; end if;
  if p_decision not in ('Approved','Held') then raise exception 'Decision must be Approved or Held.'; end if;
  select * into r from submissions where id = p_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  if r.verification_status <> 'Verified' then
    raise exception 'Renewal blocked: evidence must be Verified and evaluated first (current: %).', r.verification_status; end if;
  if r.compliance_result = 'Not Evaluated' then
    raise exception 'Renewal blocked: run the compliance evaluation first.'; end if;
  if p_decision = 'Approved' and r.compliance_result <> 'Compliant' then
    raise exception 'Cannot approve renewal: the record is With Deficiency. Hold it instead.'; end if;
  if p_decision = 'Held' and coalesce(trim(p_note),'') = '' then
    raise exception 'A note is required when holding renewal.'; end if;
  update submissions set renewal_decision = p_decision, decision_note = nullif(trim(coalesce(p_note,'')),'') where id = p_id;
  insert into history(submission_id, action, from_value, to_value, note, actor_id, actor_name)
  values (p_id, 'Renewal decision', r.renewal_decision, p_decision, p_note, auth.uid(), public.actor_name());
end $$;

-- ---------- Function privileges ----------
revoke all on function public.register_scholar(text,text,int,text)      from public, anon;
revoke all on function public.set_scholar_program(uuid,int)             from public, anon;
revoke all on function public.submit_grades(text,int,numeric,int,int,int,int,text) from public, anon;
revoke all on function public.verify_submission(uuid,text,text)         from public, anon;
revoke all on function public.evaluate_submission(uuid)                 from public, anon;
revoke all on function public.decide_renewal(uuid,text,text)            from public, anon;
grant execute on function public.register_scholar(text,text,int,text)   to authenticated;
grant execute on function public.set_scholar_program(uuid,int)          to authenticated;
grant execute on function public.submit_grades(text,int,numeric,int,int,int,int,text) to authenticated;
grant execute on function public.verify_submission(uuid,text,text)      to authenticated;
grant execute on function public.evaluate_submission(uuid)              to authenticated;
grant execute on function public.decide_renewal(uuid,text,text)         to authenticated;
