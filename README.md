# Scholarship Monitoring and Academic Compliance System
SAD Laboratory Midterm, Section A. Plain HTML/CSS/JavaScript with Supabase (Auth, Postgres, RLS). Synthetic data only.

## Setup
1. Create a Supabase project. In Authentication > Providers > Email, turn off "Confirm email" (or tick "Auto confirm" when adding users).
2. Authentication > Users > Add user: `staff@example.test` and `scholar@example.test` (passwords are given to the instructor privately).
3. SQL editor: run `supabase/schema.sql`, then `supabase/seed.sql`. The seed script sets the staff role and links the scholar login to record A06.
4. Copy `config.example.js` to `config.js`; fill in `SUPABASE_URL` and the **anon** key. Never use or commit the service-role key.
5. Serve the folder: `python3 -m http.server 8000`, open http://localhost:8000. (Opening index.html directly also works.)

Environment variable names (kept in `config.js`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## How access is enforced
- RLS is on for every table. Scholars can SELECT only their own scholar row, submissions and history. Staff can SELECT everything.
- Direct INSERT/UPDATE/DELETE is revoked for clients. All writes go through `security definer` functions that check `is_staff()` / `my_scholar_id()` and validate input: `submit_grades`, `verify_submission`, `evaluate_submission`, `decide_renewal`, `register_scholar`, `set_scholar_program`.
- Thresholds and deadlines are read from the `programs` table inside `evaluate_submission`; nothing is hard-coded in app code.
- Three separate states are kept: submission status (Pending/Verified/Returned), academic compliance (Not Evaluated/Compliant/With Deficiency), and award status (Active by default). A deficiency never changes the award status.

## Design decisions (state these if asked)
- The deadline is compared with the server timestamp `submitted_at` (stored as timestamptz, displayed in Asia/Manila). Exactly 17:00:00 is on time; 17:00:01 or later is late.
- A resubmitted correction keeps its original `submitted_at`, so a correction cannot make an on-time record late. `resubmitted_at` records the correction time.
- Re-evaluating a record whose decision was Approved and which is now deficient clears the approval. Changing a scholar's program resets earlier evaluations. Both are logged.
- Holding renewal requires a note; returning evidence requires a reason.

## Test accounts and TC order
`scholar@example.test` is linked to **A06**. Run TC01-TC05 and TC10 as staff, then TC06, TC07, TC08, TC09 (TC09 returns A06, so run it after TC06). See `docs/Test_Results.md`.

TC08 console attempt, signed in as the scholar:
```js
await sb.from('submissions').select('*')                       // returns only A06's row
await sb.from('scholars').select('*').eq('student_id','A01')   // returns []
await sb.rpc('verify_submission',{p_id:'<id of another record>',p_status:'Verified'}) // error: only staff
await sb.from('submissions').update({verification_status:'Verified'}).eq('student_id','A06') // denied / no rows
```

## Known limits
- Not executed against a live Supabase project by the author of this package: run the tests and fill the "actual" column yourself.
- Exceptions, appeals, Registrar API, payments and SMS are out of scope.
- Semesters offered: 1 and 2; years 2025-2026 to 2027-2028.
