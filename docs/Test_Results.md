# Test Results (TC01-TC10)
Expected results are derived from the policy. Fill **Actual**, **Pass/Fail** and **Evidence** while running the app. Report defects honestly.

## Expected status per seeded record (AY 2026-2027, Sem 1; deadline 2026-10-30 17:00 Asia/Manila)
| ID | Program | Derivation | Expected compliance | Expected reasons |
|---|---|---|---|---|
| A01 | Merit | GWA 1.75 <= 1.75; units 18 >= 18; 0/0/0; submitted exactly 17:00 | Compliant | none |
| A02 | Merit | GWA 1.76 > 1.75 | With Deficiency | GWA above maximum |
| A03 | Community | GWA 2.25 <= 2.25; units 15; drop 1 <= 1 | Compliant | none |
| A04 | Community | units 14 < 15; INC 1 > 0 | With Deficiency | Insufficient units; incomplete grade |
| A05 | Merit | failed 1 > 0; 17:01 after 17:00 | With Deficiency | Failed subject; late submission |
| A06 | Community | would pass, but Pending verification | Not Evaluated | Blocked until verified |

## Results
| Test | Input or action | Expected result | Actual result | Pass/Fail | Evidence |
|---|---|---|---|---|---|
| TC01 | Staff evaluates A01 | Compliant; GWA and deadline checks pass at the boundary | | | |
| TC02 | Staff evaluates A02 | With Deficiency; reason cites GWA 1.76 above 1.75 | | | |
| TC03 | Staff evaluates A03 | Compliant; one dropped subject allowed for Community | | | |
| TC04 | Staff evaluates A04 | With Deficiency; two reasons: units below 15 and 1 incomplete | | | |
| TC05 | Staff evaluates A05 | With Deficiency; failed subject and late submission reasons | | | |
| TC06 | Staff presses Evaluate, then Approve on A06 (Pending) | Both rejected with a clear message | | | |
| TC07 | Scholar resubmits AY 2026-2027 Sem 1 (duplicate); then GWA 0.50; then units -1 | Each rejected with a clear message; no row added | | | |
| TC08 | Scholar console: read A01 row; call verify_submission | Read returns nothing; verify raises "Only Scholarship Staff..." | | | |
| TC09 | Staff returns A06 with reason; scholar corrects and resubmits; refresh | Status Pending verification; history shows Return and Resubmitted | | | |
| TC10 | Staff approves A01 (Compliant) and holds A02 with a note; try approving A02; scholar tries rpc decide_renewal | A01 Approved; A02 Held; approving A02 rejected; scholar call denied | | | |
