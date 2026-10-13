# AI CV Builder

Upload a CV (PDF) or describe your background in plain text, name a target role, and get a focused CV you can review, edit and download as an A4 PDF. The AI may rephrase and restructure, but it is **not allowed to invent facts**: anything it can't trace back to your own words is removed, and gaps become questions for you.

**Stack:** NestJS (Fastify adapter) · MikroORM · PostgreSQL · Redis + BullMQ · Next.js 15 (App Router) · TanStack Query · Tailwind · Anthropic API (Claude) · pdfmake · Jest.

---

## Run it

```bash
cp .env.example .env          # put your key in ANTHROPIC_API_KEY
docker compose up --build
```

Open **http://localhost:3000**, sign up, create a CV.

`ANTHROPIC_API_KEY` is the only secret, and only the `worker` container receives it. The model defaults to `claude-sonnet-5-5`; override it with `ANTHROPIC_MODEL`.

To click through the whole flow without a key, run `LLM_PROVIDER=fake docker compose up --build`. A deterministic stub replaces Claude: it copies sentences from your input and asks generic questions. That's enough to exercise the queue, progress, questions, editing and PDF export, but the output isn't a real CV.

Services: `postgres`, `redis`, `migrate` (one-shot), `api` (:3001, internal), `worker`, `web` (:3000).

## Run the tests

```bash
npm ci
npm test                                            # unit tests (no services needed)

docker compose -f docker-compose.test.yml up -d     # throwaway Postgres :5433 + Redis :6380
npm run test:e2e                                    # API end-to-end tests against real Postgres/Redis
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit, e2e, the production build and `docker compose build`.

What is tested and why:

| Area | Where | Why it matters most |
|---|---|---|
| Grounding verifier | `apps/api/src/grounding/verifier.spec.ts` | This is the "don't invent facts" guarantee |
| Generation pipeline (repair pass, invalid-output retry, answers as grounding, section updates keep user edits) | `cv-pipeline.spec.ts` | LLM output is untrusted. Behaviour under bad output |
| Concurrent-edit merge (`applySectionChange` / `changeTarget`) | `assemble.spec.ts` | A background job must never overwrite the user's edits |
| PDF in/out (A4, selectable text, Cyrillic, fake/corrupt/scanned PDFs) | `source-ingest.spec.ts` | Untrusted uploads, and the deliverable itself |
| Retry/failure policy, no provider details leaked | `job-processor.spec.ts` | Failure handling |
| Full HTTP flow (auth, isolation on **every** endpoint, generate → verify → question → answer → edit → PDF, retries, double-submit, version conflicts, injection fencing, rate limits) | `apps/api/test/cv-flow.e2e-spec.ts` | Whole flow through the real HTTP stack, DB and queue |

The UI was checked with a Playwright script on an iPhone 13 viewport and on desktop: sign-up, PDF upload, reload during generation, answering a question, autosave and PDF download. That script isn't part of the repo (see "With more time").

---

## Architecture

```
 Browser ──► web (Next.js) ──/api/* proxy──► api (NestJS/Fastify) ──► PostgreSQL  (source of truth)
                                                  │                        ▲
                                                  └─ enqueue job id ──► Redis/BullMQ
                                                                           │
                                               worker (NestJS context) ◄───┘ ──► Anthropic API
                                                  └─ writes status/stage/result to PostgreSQL
```

* **`apps/web`** is Next.js. The browser only talks to the web origin, and a route handler (`app/api/[...path]/route.ts`) proxies to the API. That keeps the session cookie `httpOnly` + `SameSite=Lax` with no CORS, and `API_URL` is read at runtime, not baked into the build.
* **`apps/api`** has two entrypoints from one codebase and one image:
  * `main.ts` is the REST API. It does quick work only: auth, validation, CRUD, PDF render.
  * `worker.ts` is the BullMQ consumer that calls the LLM. Slow, failure-prone LLM calls never block HTTP workers, and the worker scales independently.
  * `cli/migrate.ts` runs as a one-shot compose service before api/worker start, so replicas never race on migrations.
* **`packages/shared`** holds the zod schema of the CV document and the API DTOs. The API, the LLM pipeline and the editor all validate and sanitise with this one definition: length limits, control/bidi characters stripped, links limited to `http(s)`/`mailto`.

### Long-running generation without a frozen screen

1. `POST /api/cvs` validates input, extracts PDF text, inserts the `cvs` row and a `cv_jobs` row, enqueues the job id, and returns **202** right away.
2. The worker records `status` and `stage` (`reading_source → drafting → verifying → saving`) **in Postgres**. The UI polls `GET /api/cvs/:id` only while a job is active and shows the stages.
3. Job state lives in the database, not in the browser or Redis. Reloading the page, closing the tab, or opening the CV on a phone shows the same progress, and the finished CV is there later from any device.
4. **Reconciliation:** a sweeper in the worker re-enqueues jobs that were committed but never enqueued (Redis down, crash between commit and enqueue). It also fails jobs that BullMQ lost, so users see an error and a *Try again* button instead of an endless spinner. It works like a light transactional outbox.
5. **Double-submit protection is in the database:** partial unique indexes allow at most one in-flight generation per CV and one in-flight apply per question.

### Data model

`users` · `sessions` (SHA-256 of an opaque token, so sessions can be revoked) · `cvs` (extracted `source_text`, `document` JSONB, `version`, `removed_claims`) · `cv_questions` (section + item id, status `open/applying/answered/dismissed`, answer) · `cv_jobs` (type, status, stage, attempts, user-safe error).

The CV document is stored as JSONB rather than normalised tables. It's always read and written as a whole by one owner, its shape is enforced by the shared zod schema, and JSONB keeps edits atomic and versionable. I'd normalise it only if we needed to query across CVs.

### Main decisions and trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| Separate worker + BullMQ | LLM calls take 10–60 s and fail transiently. They need retries with backoff and shouldn't block the API | One more process. Redis is a dependency, though not a source of truth |
| Postgres owns job state, Redis only carries ids | Survives reloads and Redis loss. One place to read progress from | Small reconciliation sweeper needed |
| Polling (1.5 s, only while active) instead of SSE/WebSockets | Stateless, works through the proxy and on flaky mobile networks, trivially reload-safe | A little extra traffic during generation |
| Opaque server-side sessions, not JWT | Logout and revocation actually work. Nothing sensitive in the cookie | One indexed DB lookup per request |
| Optimistic concurrency (`version`) on every document write | Two tabs, two devices and background "apply answer" jobs can all write the same CV | User sees "changed elsewhere → load latest" instead of a silent merge |
| Worker writes are minimal section changes (`replace-item`, `replace-section`, `append-items`) merged onto the *latest* document | A user can keep editing other parts of the CV while an answer is applied | If the user edited *the same* item meanwhile, the job stops (409-style) and keeps their answer to resubmit |
| PDF rendered server-side with pdfmake (real text, embedded Roboto) | A4, selectable/ATS-friendly text, Cyrillic, no headless browser in the image | Layout is code, not HTML/CSS. One template (more were out of scope) |
| PDF uploads parsed at request time (size/page caps, magic bytes, 10 s timeout); only the text is stored | Immediate "this PDF is scanned, paste text instead" feedback | Parsing untrusted PDFs in the API process. With more time it would move to a sandboxed worker |
| NestJS + Fastify + MikroORM + Next.js | Matches the target stack | — |

---

## How the AI is kept from inventing facts

Defence in depth. The prompt asks; the code enforces.

1. **Constrained output.** Every call forces a single tool (`tool_choice`) with a JSON schema. The response is parsed with zod, and malformed output gets one corrective retry before the job fails or retries. Free text is never parsed.
2. **Prompt rules + evidence.** The system prompt forbids new employers, titles, dates, numbers, technologies, certifications and computed facts like "5+ years". Every bullet must carry **evidence**: verbatim quotes from the user's input. Missing or vague information must become a **question**, not a guess.
3. **Deterministic verifier** (`apps/api/src/grounding`). After every LLM call, the output is checked against the *grounding corpus*: source text, the user's answers, and (for section updates) the user's own manual edits.
   * Employer, institution, job title, degree and name must consist of words from the source. A job at an unknown employer is dropped whole.
   * Email, phone (digit sequence) and links must appear in the source.
   * Every **number** and **proper noun / technology** (capitalised mid-sentence, CamelCase, ALLCAPS, contains digits/`+`/`#`) in a bullet or summary sentence must appear in the source. Digits inside phone numbers, emails and URLs don't count as support for metrics. Spelled-out small numbers ("two" ↔ "2") and simple plurals are tolerated.
   * Every bullet needs at least one evidence quote that actually exists in the source.
   * Skills must be named in the source.
   * The summary may *name* the target role ("targeting a Senior Backend Engineer role") but nothing else that isn't in the source.
4. **One repair pass.** If anything fails verification, the model gets the exact list of problems and one chance to fix the draft. The result is verified again and whatever is still unsupported is **dropped**. A repair that makes things worse is discarded.
5. **Transparency.** Removed claims are stored and shown under "Left out by fact-check" with the reason. The most important ones become verifier questions: "We left out '…' because we couldn't find it in what you gave us. If it's accurate, tell us the details."
6. **Answers update only the relevant part.** A question is tied to a section or item. The answer is used to update *only* that section, verified the same way (the answer becomes part of the corpus), and merged with a version check.
7. **Prompt injection.** All user text sits inside tagged blocks, and tag-like sequences in it are neutralised, so a CV can't close its own `<source>` block. The model is told that block content is data. The real backstop is (3): whatever the model does, it can't add facts the user didn't write.

**Known limits.** The checks are lexical, not semantic. A bullet that recombines true facts misleadingly ("led the migration" when the source says "took part in the migration") passes as long as no new number or name appears. Verb-level and seniority claims are covered by the prompt, not proven by the verifier. Next step: an LLM-as-judge entailment check per bullet against its evidence quotes, plus an eval set of adversarial CVs to measure the false-positive and false-negative rate.

## Failures and untrusted input

* **LLM:** typed errors decide what to do. Transient errors (429/5xx/overload/timeouts, malformed output) are retried with exponential backoff (3 attempts). Fatal ones (auth, refusal, conflicts) fail immediately. Users only see safe messages, never provider payloads. A failed generation shows *Try again*. A failed answer goes back to the question with the user's text kept.
* **Uploads:** magic-byte check (not MIME or extension), 5 MB, 10 pages, parse timeout, a friendly error for scanned PDFs, control characters stripped. The file itself isn't stored.
* **All input** is validated with zod at the boundary, including route params (non-UUID → 404). Oversized bodies get 413.
* **Authorization:** every query is scoped by owner. Foreign ids return **404, not 403**, so ids can't be probed. The e2e test hits every endpoint as another user.
* **Auth:** argon2id, timing-equalised login (no account enumeration), rate limits (per IP for auth, per session for expensive endpoints), a cap on in-flight jobs per user (LLM cost), revocable sessions.
* **Rendering:** React escapes all text, and links are restricted to `http(s)`/`mailto` by the shared schema, both for the editor and the PDF.
* **Shutdown:** the worker waits for in-flight jobs on SIGTERM. BullMQ stalled-job detection plus the sweeper cover crashes.

---

## What I simplified or cut

* **Polling instead of push.** Fine at this scale. I'd move to SSE for many concurrent users.
* **No email verification, password reset, OAuth, templates or JD tailoring** (out of scope per the brief).
* **Single CV template.** Dates are free-text strings: CVs use "Mar 2021", "2019–2021" and so on, and normalising them wasn't worth the risk of corrupting facts.
* **Editor is form-based.** Bullets are one per line in a textarea and skills are comma-separated. Reliable on phones, but no drag-and-drop or rich text.
* **No live PDF preview in the page.** The PDF is generated on download.
* **No observability stack.** Structured Nest logs only, with job ids, durations and token usage. No Sentry, metrics or tracing.
* **Frontend has no automated tests.** I spent the test budget on the backend, where the risk is (grounding, concurrency, authZ).

## With more time

* An LLM-as-judge entailment check per bullet, and an **eval suite** of real and adversarial CVs to tune the verifier's precision and recall.
* Stream progress over SSE. Move PDF parsing into a sandboxed worker with memory limits.
* Sentry + OpenTelemetry, a BullMQ dashboard, metrics for token cost per CV and verifier removal rate.
* Version history and undo for the document. Show the user a diff when an answer is applied.
* Playwright e2e for the UI in CI. Accessibility audit.
* Prompt caching for the shared system prompt and source on repair/answer calls.
* Proper redirect handling for 401 in the Next.js middleware (it currently checks only cookie presence; the API is the authority).

## How I used AI tools

The project was built with an AI coding agent (Claude) as a pair programmer. I set the architecture and constraints up front: separate worker, Postgres as source of truth for jobs, versioned writes, a deterministic verifier as the real guarantee. The agent drafted code under them; I reviewed, ran and tested every part.

Things review and testing caught that the first drafts got wrong, each fixed in its own commit:

* **Phone digits "supported" fake metrics.** The verifier accepted "improved latency by 45%" because a phone number contained `45`. Digits in phones, emails and URLs are now excluded.
* **Plural false positives.** "APIs" vs "API" caused needless repair passes and dropped true content. Found by a unit test.
* **500 instead of 404** on the PDF endpoint for another user's CV: the PDF content-type was set before the error was serialised. Found by the isolation e2e test.
* **Version race on regeneration.** The worker wrote `loadedVersion + 1`, so a concurrent user save could share a version number and later be silently overwritten. Fixed with an atomic increment and a regression test.
* **Rate limiting by IP behind the proxy** would have throttled all users together. Now keyed per session for signed-in requests.
* **pdf.js under Jest** needs `--experimental-vm-modules` (ESM dynamic import). Kept the real parser in tests instead of mocking it away.

## Repository layout

```
apps/api      NestJS API + worker (src/main.ts, src/worker.ts, src/cli/migrate.ts)
  src/grounding     corpus matching + verifier (the "no invented facts" guarantee)
  src/generation    queue, worker processor, sweeper, LLM pipeline (prompts, draft schema, assemble)
  src/llm           Anthropic client, fake client, typed errors
  src/cvs           REST controller/service, PDF ingestion
  src/pdf           A4 PDF rendering
  test/             e2e tests (real Postgres + Redis, scripted LLM)
apps/web      Next.js app (proxy route, pages, editor, questions panel)
packages/shared  zod CV schema + API DTOs used by both sides
```

### API (all under `/api`, JSON unless noted)

`POST /auth/signup` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /cvs` · `POST /cvs` (multipart: `targetRole` + `file` or `text`, returns 202) · `GET /cvs/:id` · `PUT /cvs/:id/document` (`{version, document}`, 409 on stale version) · `PATCH /cvs/:id` · `DELETE /cvs/:id` · `POST /cvs/:id/regenerate` · `POST /cvs/:id/questions/:qid/answer` · `POST /cvs/:id/questions/:qid/dismiss` · `GET /cvs/:id/pdf` · `GET /health`
