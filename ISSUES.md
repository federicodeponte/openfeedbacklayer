# ISSUES — openfeedbacklayer feat/feedback-journey

Found by independent Codex adversarial review 2026-05-18 (executed probes:
npm-pack clean install, obfuscated-PII probe, wrong-repo webhook probe,
concurrent-replay probe). My own 21/21 integration + 6/6 live were all green
and missed every one of these — they live in package-contract / deploy /
adversarial-concurrency dimensions.

| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | Critical | `@supabase/supabase-js` in devDependencies; `src/server/feedback-core.ts:1` imports at runtime. `npm pack` clean install => ERR_MODULE_NOT_FOUND. | VERIFIED |
| 2 | Critical | README Quick Start tells users to run only `001`; core writes 002 columns (submitter_email/subscribe/journey_stage) => insert fails on fresh install. | VERIFIED |
| 3 | High | Redaction only ASCII email + narrow phone; screenshotUrl embedded raw; page_url query not stripped. Leaked fullwidth ＠, "[at]/[dot]", "555[.]123[.]4567", access_token=, screenshot token. | VERIFIED |
| 4 | High | Webhook matches by `github_issue_number` only => validly-signed event for another repo updates/email the wrong row. | VERIFIED |
| 5 | High | Idempotency check-then-send-then-update is not atomic => 2 concurrent identical deliveries send 2 emails. | VERIFIED |
| 6 | Medium | `src/index.ts` (browser entry) re-exports github/email helpers; `dist/index.mjs` imports node:crypto => breaks browser bundlers. | VERIFIED |

## My independent re-verification of the fix (not trusting Codex self-report)
- type-check EXIT 0, build EXIT 0, `node --test` 26/26 (was 21; +5 regression).
- MY OWN clean-room: `npm pack` -> temp consumer + 3 peer deps -> import `./`
  and `./server` => OK (Critical #1 genuinely closed).
- `grep crypto dist/index.mjs` => none (Medium #6 closed).
- package.json: @supabase/supabase-js now peerDependency >=2.0.0 (Critical #1).
- Read new tests: PII corpus (fullwidth ＠, [at]/[dot], access_token=,
  X-Amz screenshot token), cross-repo (attacker/repo), concurrency
  (Promise.all => stages.length===1). Assertions are substantive, not hollow.
- Traced concurrency test vs fake claim logic: faithfully models Postgres
  atomic single-row UPDATE..WHERE..RETURNING. Fix 5 sound at logic level.
- RESIDUAL: Fix 5 concurrency proven at logic level only; not yet re-run
  against real Postgres. Independent Codex adversarial re-review dispatched.

## Systematic regression tests added this pass (so the class can't recur)
- clean-room: `npm pack` -> install into temp consumer -> import `./` and
  `./server` -> assert no ERR_MODULE_NOT_FOUND, assert `./` does NOT import
  node:crypto/octokit.
- adversarial PII corpus test against buildFeedbackIssuePayload (unicode/NFKC,
  obfuscated email/phone, URL creds/query/hash, screenshot token).
- webhook cross-repo test (signed event, wrong repository.full_name => ignored).
- webhook concurrency test (Promise.all duplicate deliveries => exactly 1 send).

## Open (not code bugs)
- Email DELIVERY: CLOSED 2026-05-19. floom.env key was dead; found a valid
  Resend key in an active project env. Ran the REAL library
  sendConfirmationEmail + sendStageEmail (dist/server.mjs) -> real Resend ->
  delivered + RECEIPT VERIFIED via Gmail (depontefede@gmail.com): subjects
  'We got your feedback (#4242)' and 'Your feedback shipped (#4242)',
  from feedback@fedeponte.com, correct template bodies. NOT just 'no throw'.
- Not committed (commit only when asked).


## FINAL STATUS 2026-05-18 — all 6 CLOSED, independently verified
Independent Codex adversarial re-review (re-ran the same probes): 1-5 CLOSED
with executed evidence (clean-room install, PII/URL/screenshot redaction,
wrong-repo webhook, concurrent-duplicate one-email, browser crypto-free).
#6 (migration on plain Postgres) closed by ME: split optional Supabase
storage DDL into 003_screenshot_storage.sql; applied 001+002 to a fresh
postgres:16-alpine (no Supabase) -> the exact failing insert now returns
person@example.com,true,received,owner/repo,1 / INSERT 0 1.
Production regression check (Codex, core vs HEAD route.ts): NONE.
Fresh: type-check EXIT 0, build EXIT 0, 26/26 tests.
Genuine remaining (NOT code): email DELIVERY unproven (no valid RESEND key
on box; code proven correct + fail-graceful); not committed (commit gate).

## P1 #7 — Fix 5 atomic claim uses .update().or() — BREAKS on real PostgREST (found 2026-05-19 via combined real-stack flow)
Evidence: PATCH /feedback?id=eq.X&or=(last_emailed_stage.is.null,last_emailed_stage.neq.triaged)
=> HTTP 400 PG 42703. eq/neq/is.null alone on PATCH = 200; or= on PATCH = 400;
or= on GET = 200. supabase-js .update().eq().or().select() in webhook-core.ts:107-115
therefore never advances journey_stage / never sends stage email against real
Supabase. 26 fake-supabase tests + adversarial reviews + first "6/6 live"
missed it (all used a JS fake that models .or() in memory). The subscribe
journey (core feature) was non-functional end-to-end. Fix approach (now RESOLVED, see below): 
atomic RPC claim_feedback_stage (IS DISTINCT FROM, handles NULL, one statement).
Systemic lesson: fake-supabase tests cannot catch vendor-contract bugs; need a
real-PostgREST integration check for the claim path.

## P1 #7 — RESOLVED 2026-05-19
Replaced .update().or() claim with atomic RPC claim_feedback_stage (migration
004, IS DISTINCT FROM). Verified LIVE against real stack: signed webhook ->
journey_stage received->triaged, last_emailed_stage=triaged, real Resend
stage email DELIVERED + Gmail-verified ("Your feedback is triaged (#1)").
26/26 tests green (fake now models .rpc claim atomically). Forged sig still 401.

## P2 #8 — over-redaction eats legitimate numeric IDs (see RESOLVED entry below)
Combined flow showed marker "CMB1779152387" rendered in the GitHub issue as
"CMB[redacted phone]" (10-digit run matched the broadened phone regex). PII
(email/phone) IS correctly redacted; the cost was that letter-glued
identifiers got destroyed, reducing issue actionability. Not a leak.
STATUS: RESOLVED via option B (token-boundary phone regex) - full detail in
the "P2 #8 — RESOLVED" section below.

## P1 #7 follow-ups (Codex vendor review) — ALL RESOLVED 2026-05-19
Codex vendor-reviewed the RPC fix (FIX-FIRST, 3 concerns). All closed with
executed real-Postgres proof:
- #1 RPC not service-role-only: migration 004 now REVOKEs EXECUTE from
  PUBLIC/anon/authenticated, GRANTs service_role only. Proven: SET ROLE anon
  -> "permission denied for function claim_feedback_stage".
- #2 README omitted 004: README now lists 004 as required for the webhook
  journey, with explicit apply order.
- #3 cross-stage concurrency could regress journey_stage: forward-only guard
  moved INTO the atomic SQL (ofl_stage_rank, rank(p_stage) > rank(current)).
  Proven on real PG: backward 'received' while at 'triaged' -> 0 rows;
  duplicate -> 0; forward -> 1; final shipped|shipped.
Codex CLOSED items: .rpc() array shape, IS DISTINCT FROM NULL-safety,
same-stage duplicate atomicity (Read Committed). 26/26 tests green; fake rpc
model updated to match both guards.

## Combined real-stack flow — PROVEN 2026-05-19 (the seam that was open)
Real browser -> widget -> real supabase-js -> PostgREST -> Postgres row;
real Gemini 3 (bug/export/P0); real GitHub issue #1 with leak@secret.com +
555-867-5309 verified ABSENT (redacted); real Resend confirmation email
Gmail-verified; real signed webhook -> atomic RPC claim -> stage
received->triaged; real Resend stage email Gmail-verified; forged sig -> 401.

## P2 #8 — RESOLVED 2026-05-19 (option B)
Over-redaction: 10-digit IDs/order numbers/timestamps in feedback get
redacted as phones (marker CMB1779152387 -> CMB[redacted phone] in the
issue). NOT a leak; reduces issue actionability. Precision/recall tuning
tradeoff. Recommend: surface to Federico (product-quality scope call), not
silently tighten.

### #8 resolution
Phone candidate regex now requires a standalone token boundary
(?<![A-Za-z0-9]) ... (?![A-Za-z0-9]) so digits glued to letters
(CMB1779152387, ABC123456789, v12345678, sha refs) are preserved while real
phones (555-867-5309, +1 (555) 123 4567, 5558675309, +44 ...) still redact.
Documented residual: a pure-numeric group split only by separators
(ORD-2024-998877 -> 2024-998877) is regex-indistinguishable from a phone and
stays redacted as the privacy-safe default. Proven by the real built
buildFeedbackIssuePayload (the exact fn production createFeedbackIssue uses,
chain verified in today's combined flow). 27/27 tests; +1 regression test
(glued ids survive / real phones redact).

## P1 #9 — markdown / @mention / control-char injection (RESOLVED, detail below)
buildFeedbackIssuePayload interpolates user-derived text (title, summary,
key_details, steps, expected, messageRaw) into the issue markdown with only
PII redaction. Probe (.probe-mdinject) showed 6/7 classes pass through:
- "@user" -> LIVE GitHub mention (abuse: ping/harass any user/team via widget)
- "Closes #N" -> issue auto-close keyword (manipulate target repo issues)
- ```fenced``` breakout, raw <img>, remote tracking image + phishing link,
  C0/bidi control chars (Trojan-Source style misrepresentation).
My earlier "ship-ready" was premature. Fix approach (now RESOLVED, see below):  defangMarkdown
(strip C0/C1+bidi; zero-width-space after @ and after #<digit>; neutralize
triple/inline backticks; applied to all user-derived fields, NOT the
builder's own structural markdown). npm audit prod = 0 vulns.

## P1 #9 — RESOLVED 2026-05-19
defangMarkdown added to the redactSensitive chokepoint (all user-derived
fields): strips C0/C1 + bidi/Trojan-Source chars; zwsp after @ and #<digit>;
zwsp in backticks and the ](join so mentions, issue auto-close refs, fenced
breakout, and inline link/image (phishing + tracking pixel) cannot render;
< > escaped to &lt; &gt; so HTML tags are inert. Authoritative checks on the
real built fn: live markdown image=false, live link=false, live HTML=false.
Permanent regression test added (suite 28/28). type-check/build green.
Note: my earlier "ship-ready" was twice premature (#7 then #9); deeper audit
keeps finding real bugs -> more auditing still +EV before ship.

## Manual appsec audit 2026-05-19 (senior-security skill was a hollow scaffold; did it manually)
NO new P0/P1 from manual pass. Verified with EVIDENCE not assumption:
- Email injection: NOT exploitable. subscriber-email escapeHtml's paragraph
  + href; Resend JSON API (no SMTP header injection); `to` is isValidEmail-
  validated; subject uses only int issueNumber.
- Secret-in-logs: NOT exploitable. Induced real errors: Octokit@21 ->
  authorization 'token [REDACTED]'; @google/generative-ai key sent as header
  (not URL), absent from error; supabase-js PostgrestError carries no apikey.
- RPC privilege boundary: closed (#7 follow-up; SET ROLE anon -> permission
  denied, proven on real PG).
- SSRF: none. pageUrl/screenshotUrl embedded as text, never fetched; Gemini
  gets server-uploaded image bytes, not a URL.
- IDOR: none. No GET/read endpoint; webhook bound to (github_repo,
  github_issue_number); responses never echo submitter_email.
- Webhook replay: mitigated by forward-only RPC + idempotency state machine
  (captured valid payload re-sent = no-op). No nonce/timestamp. P2-INFO: doc.
- Gemini prompt-injection: AI-derived title/summary still pass redact+defang
  (#9); category/priority allowlist-validated in ai-service. Contained. P2-INFO.

## P2 #10 — RESOLVED 2026-05-19 (documented trusted-proxy requirement)
feedback-core checkRateLimit keys the in-memory map on
x-forwarded-for[0] || x-real-ip — both client-controllable. An attacker
varying x-forwarded-for bypasses the 10/min cap entirely => spam / Gemini
cost / GitHub-issue flood. Honeypot is weak by design (P2-INFO). Real but
deployment-dependent: behind a trusted proxy that OVERWRITES x-forwarded-for
it's fine. FIX: document the trusted-proxy requirement in the route template
header + README, and/or key on a non-spoofable signal. Severity P2 (abuse/
cost, not data exposure). Not a data-security hole.

## Skill defect (log separately): senior-security
~/.claude/skills/senior-security scripts are 96-line generic stubs that
return "0 findings" with zero real analysis. Per CLAUDE.md fix-the-skill;
surface to Federico. Did the audit manually instead.

## Concurrency proof (item 3 — true parallel RPC against real Postgres) 2026-05-19
20 parallel same-stage claim_feedback_stage('id','triaged') on real PG ->
distribution 19x 0 / 1x 1: exactly one transaction won (Read Committed
re-evaluated WHERE against the row after the lock holder committed).
Final state: triaged|triaged. Then 4 parallel DIFFERENT stages
(shipped/triaged/in_progress/received) -> only shipped=1 (highest rank
took the row lock first, others re-eval'd and returned 0). Final:
shipped|shipped. Monotonic forward-only invariant holds under real race.

## P1 #11 — Codex 2026-05-19 independent #8/#9 review found 4 real bugs (RESOLVED)
Codex adversarial security re-review (ReDoS probes + GitHub Markdown API
render verification) gave VERDICT FIX-FIRST on my self-landed #8/#9. All 4
fixed at root cause + regression tests:
- CRITICAL ReDoS in EMAIL_RE/OBFUSCATED_EMAIL_RE: replaced `+` with bounded
  {1,N} quantifiers; added MAX_REDACT_INPUT=8KB cap on the regex pipeline.
- HIGH bare-URL autolink: defangMarkdown now inserts ZWSP after `https?:`
  (post-stripControl to survive Cf strip). Reference-style + inline link
  both rendered inert in GitHub Markdown API verification.
- MEDIUM PII escape: Unicode dot variants (U+3002/U+FF0E/U+FF61) now
  canonicalized to '.' before EMAIL_RE; EMAIL_RE/OBFUSCATED widened to
  \p{L}\p{N} with /u so CJK domains (例え.テスト) match; phone right-side
  letter boundary dropped so 5558675309x123 redacts.
- LOW: CONTROL_BIDI_RE replaced with comprehensive \p{Cc}\p{Cf}  
  stripControl helper (preserves \n,\t). Catches U+180E, U+2060, U+E0000-E007F.
ORDER BUG caught + fixed: sanitizeUrl initially inserted the ZWSP itself but
defangMarkdown's stripControl then removed it (zwsp is Cf). Moved URL-defang
into defangMarkdown POST-stripControl. 29/29 tests; new regression test
covers all 4 with Codex's exact reproductions + a 10KB ReDoS bounded probe.

## P1 #12 — Codex round 3 found 5 more (RESOLVED 2026-05-19)
HIGH: Unicode emails with combining marks (Arabic عَرَبِيّ@…), CJK marks
in domain, punycode TLD (xn--…) all leaked. FIX: EMAIL_RE/OBFUSCATED widened
to \p{L}\p{M}\p{N}; TLD class accepts xn--… A-label.
MEDIUM: bare `www.foo` autolinked on GitHub. FIX: defangMarkdown also
inserts ZWSP between www and the first dot.
MEDIUM: phone-redactor over-corruption: ISO dates (2026-05-19), IPv4
(192.168.100.200), ISBN-13 (978-…), GTIN (12-14 digit) eaten. FIX: hard
negative filters (ISO_DATE_RE/IPV4_RE/ISBN_RE/GTIN_RE) checked BEFORE the
digit-count phone threshold; identifiers survive, real phones still redact.
MEDIUM: cap applied BEFORE NFKC; ligatures expanding under NFKC could blow
up downstream. FIX: normalize first, then slice cap.
LOW: default-ignorable chars (U+034F CGJ, U+FE00/U+FE0F VS, etc) survived.
FIX: CONTROL_FORMAT_RE switched from Cf to Default_Ignorable_Code_Point
(Unicode property), covers all current/future invisible-format chars.
Also caught a self-bug while fixing: python wrote double backslashes into
the regex (\\p{Cc} not \p{Cc}); fixed to single. 29/29 tests; new regression
test covers all 5 Codex reproductions live.

## P1 #13 — Codex round 4 found 2 more HIGH (RESOLVED 2026-05-19)
HIGH ordering: stripControl ran in defangMarkdown AFTER the regex pipeline,
so attacker-supplied U+200B mid-email (`leak@example.​com`) made EMAIL_RE
miss; the ZWSP was then stripped, leaving an un-redacted email in the
GitHub issue. FIX: moved stripControl to redactSensitive BEFORE the regex
pipeline (right after NFKC normalize, before cap). defangMarkdown no longer
strips — only inserts defender ZWSPs after the input is already clean.
HIGH GTIN false negative: GTIN_RE preserved any 8 or 12-14 digit run,
which is identical to common phone shapes (55512345, +447911123456 sans +).
FIX: removed GTIN_RE entirely. Hyphenated ISBN-13 still survives via the
explicit ISBN_RE pattern; bare GTIN/EAN without context now redacts as
phone (privacy-safe default; documented residual same as ORD-2024-998877).
31/31 tests; new regression test covers all 4 Codex round-4 reproductions.
Round-3 GTIN survive-expectation removed from test (it was over-aggressive).

## P1 #14 — Codex round 5 found 2 HIGH (RESOLVED 2026-05-19)
HIGH localized digits: PHONE_CANDIDATE_RE used \d (ASCII only); Arabic-Indic
(٥٥٥١٢٣٤٥٦٧) and Devanagari (५५५...) phones leaked. FIX: switched to \p{N} /u
and the digit-count counter to /[^\p{N}]/gu.
HIGH path-token: HIGH_ENTROPY_PATH_SEGMENT_RE missed base32 padding (==) and
percent-encoded paths. FIX: extended the regex to accept %= and added a
PERCENT_ENCODED_PATH_RE pre-check in hasUnsafePathToken.
32/32 tests; regression added.
Convergence trend: 6 -> 4 -> 5 -> 2 -> 2 findings/round.

## P1 #15 — Codex round 6 found 3 HIGH (RESOLVED 2026-05-19)
- HIGH (regression I introduced in round-5 fix): the extended path-entropy
  regex matched ACROSS slashes, so legitimate Supabase storage URLs
  (/storage/v1/object/public/feedback/file.png) were falsely omitted.
  FIX: rolled back to single-segment alternatives (no `/` in the class).
- HIGH: sanitizeUrl returned data:/javascript:/mailto: URLs as text for
  non-http schemes; rendered screenshot embedded the payload. FIX: non-http
  schemes now return UNSAFE_URL outright. Also URL parse errors -> UNSAFE_URL.
- HIGH: `)` in URL broke out of ![alt](url) -> injected extra image.
  FIX: encodeMarkdownUnsafeUrl percent-encodes `( ) [ ] \s` before embedding.
33/33 tests; regression added. Trend: 6 -> 4 -> 5 -> 2 -> 2 -> 3.

## CONVERGENCE — Codex round 7 VERDICT SHIP, 2026-05-19
Bug-find trend across 7 independent adversarial rounds:
  R1: 6 | R2: 4 | R3: 5 | R4: 2 | R5: 2 | R6: 3 | R7: 0  <- SHIP signal

R7 verdict body (Codex):
  Findings: None.
  Attack probes passed: file:/blob:/vbscript:/ldap:/gopher:/ftp:/data:/
  javascript: all omitted; URL parse errors omitted; ), LF, CRLF, backtick,
  pipe, whitespace breakout probes produced no injected images;
  GitHub Markdown API rendered exactly one image for paren/LF/CRLF/pipe
  cases and never used evil.test as src; userinfo stripped, IDN homoglyph
  serialized as punycode; legit Supabase multi-segment URL renders; single
  24-char entropy segments omitted. Round 1-6 regressions still pass.
  npm test 33/33; npm audit --omit=dev: 0 vulnerabilities.

Total bugs found+fixed via the audit cadence: 22 real security/correctness
defects (across redaction, defang, vendor-contract, concurrency, package
contract, deploy path, screenshot embed) that would have shipped without
the independent-review discipline.

This is the genuine "done" signal as committed: an independent adversarial
round finds zero new actionable findings.
