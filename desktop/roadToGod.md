# Road to God

**What is missing for Pi Desktop to be a perfect daily driver for someone who runs several models at once.**

Baseline: `v0.2.12`, commit `c566a97`. Every "today" claim below was read out of the
tree, not remembered. Where a gap is asserted, the file and line that proves it is named.

The **Gap** paragraphs are the baseline audit that motivated this roadmap. They are
kept as an audit trail; the current state for each phase is recorded below and in
the implementation-status block. This prevents a historical finding from being
mistaken for an unfinished feature.

---

## Contents

- [The thesis](#the-thesis)
- [Where we actually are](#where-we-actually-are)
- [What driving it against real providers found](#what-driving-it-against-real-providers-found--2026-08-04)
- [Still open](#still-open)
- [Phase 0 — Debts that block everything else](#phase-0--debts-that-block-everything-else)
- [Phase 1 — Attribution: know what each model did, and what it cost](#phase-1--attribution-know-what-each-model-did-and-what-it-cost)
- [Phase 2 — Routing: the right model without thinking about it](#phase-2--routing-the-right-model-without-thinking-about-it)
- [Phase 3 — Comparison: the thing multi-model users actually do](#phase-3--comparison-the-thing-multi-model-users-actually-do)
- [Phase 4 — Parallelism you can trust](#phase-4--parallelism-you-can-trust)
- [Phase 5 — Context and cache economics](#phase-5--context-and-cache-economics)
- [Phase 6 — The daily-driver surface](#phase-6--the-daily-driver-surface)
- [Phase 7 — Workspaces: PR](#phase-7--workspaces-pr-and-design)
- [Phase 8 — Distribution and trust](#phase-8--distribution-and-trust)
- [Phase 9 — External control](#phase-9--external-control)
- [Deliberately not doing](#deliberately-not-doing)
- [Ordering](#ordering)

---

## The thesis

A single-model GUI needs a chat window. A **multi-model** one needs four things
this app does not have yet:

| | Baseline | Current state |
|---|---|---|
| **Attribution** | Which model did what, and what did it cost | Durable per-turn model/effort and usage ledger; Usage groups measured tokens, cost, cache and failures |
| **Routing** | The right model chosen without deliberating each time | Custom providers, roles, scoped defaults, fallback chains and provider health are available |
| **Comparison** | Same task on two models, then choose | Fan-out, side-by-side answers, adoption, scoreboard and isolated worktree comparison are available |
| **Addressing** | Talk to a specific running session while others stream | `session_send` and reconnect paths accept a session id; background sessions remain addressed |

Everything below serves one of those four. Items that serve none of them are in
[Deliberately not doing](#deliberately-not-doing).

## Implementation status — 2026-08-03

The roadmap has now been executed through the feature phases. The delivered
surface includes addressed session sends, a durable usage ledger and measured
cost views, model roles and fallback routing, provider health, multi-model
comparison and adoption, isolated worktree runs, the running-task dock,
notifications and interrupted-turn recovery, model-aware context and cache
diagnostics, pre-send cost previews, the command palette and keyboard
switching, cross-session comparison, PR review comments and multi-model review,
verified update manifests, opt-in local crash
reports, an SSH workspace bridge for Files, Changes, terminal and Git
worktree operations, an opt-in loopback MCP bridge for external control, and an
optional headless automation daemon for fully-quit desktop deployments.

The remaining items are deliberately explicit:

- `0.5` is in incremental progress. The scheduled automation runner, rewind
  dialogs, fork/handoff actions, PR actions, session open/connect/restore
  lifecycle, and composer draft/send-queue glue are now extracted into
  `src/hooks/useAutomationRunner.ts`, `useRewindDialogs.ts`,
  `useSessionActions.ts`, `usePrActions.ts`, `useSessionLifecycle.ts`, and
  `useComposer.ts`, and `useInlineEdit.ts`, each with regression coverage.
  The activity-center event wiring is now extracted into
  `src/hooks/useActivityCenter.ts` with focused regression coverage. `App.tsx`
  is still above the roadmap's eventual 6,000-line target at 9,200 lines;
  further extraction remains incremental and does not change the UI surface.
- Scheduled automation failures now consume their due slot and persist a sanitized
  last-error marker. Runs now also have an append-only lifecycle ledger with
  session association, dispatch/completion/failure/interruption states, duration,
  retry lineage, durable triage, and stale-run reconciliation after restart. The
  existing Automations list remains the surface for the latest status.
- `pi-app automation daemon` is available for an explicitly managed background
  process when the desktop is fully quit. Desktop and daemon runners share a
  per-automation claim lock, so the same due slot cannot be dispatched twice.
- The SSH remote runtime owns a complete Files / Changes / terminal / Git bridge.
  The direct ACP gateway transport still has no filesystem protocol, so its resource
  pane reports that remote file operations are unavailable rather than touching a
  similarly named local checkout.
- External MCP control is available through the local `pi-app mcp serve` stdio
  adapter. The desktop endpoint is loopback-only, token-authenticated and scoped to
  trusted projects; external starts default to approval-required sessions.
- MCP request receipts are reserved before connection/send side effects, retain
  status across restart, and the stdio adapter reloads the endpoint with bounded
  transport retries. `pi-app mcp revoke` invalidates the active token at request
  ingress without requiring a desktop restart.
- `6.5` is closed as won't-do for this release. English remains complete and is
  still the single source of truth for UI strings.
- `8.1` and `8.2` remain blocked on paid Apple/Windows signing certificates,
  credentials, and the associated purchase decision.
- Turn checkpoints remain host-local by design. When a remote runtime is active,
  automatic checkpoint capture and local checkpoint actions are disabled rather
  than risking a snapshot in the similarly named local repository. Remote Git
  status, diffs, writes and worktree operations use the SSH bridge.

---

## What driving it against real providers found — 2026-08-04

Everything above was verified by test suite. This section is what changed once
real, billed turns were driven through the host against the models actually in
use. Four of the five defects below were invisible to a green suite, and the
fifth was a wrong conclusion of my own.

A live test now exists for this. It is opt-in because it spends money:

```bash
PI_APP_LIVE_MODEL=xai-auth/grok-4.5 cargo test live_model_turn -- --nocapture
```

### Every context window was wrong

`5.1` shipped, but sourced the window by guessing from the model id against a
table naming only claude, gpt-5, grok and gemini. On a catalog of xai, qwen,
minimax, kimi, glm, mimo and stepfun models, **all 34 entries were wrong**:
grok-4.5 reported 131,072 against a real 500K, and everything unlisted fell to
a 128,000 default — including several 1M-context models.

That number drives `contextWindowPercent`, which drives the compaction prompt.
Understating it by 4-8x asked the user to compact — losing context and paying
for a summarization turn — on sessions nowhere near full.

`pi --list-models` reports the real figure in the `context` column of the line
already being parsed for the thinking flag. It now reads it. Fixed in `a071e1a`.

**Lesson, and it recurred twice more below: derive from what the tool reports,
never from a table of names.** A name table is wrong the moment a provider ships
a model nobody added to it, and it fails silently.

### Provider errors were swallowed whole

Selecting a model with no balance produced *silence*. No message, no error, zero
usage — the turn simply ended after ~20s of invisible retries.

Pi does not report a refused turn as an RPC error. It reports it inside the
assistant message and closes with `agent_end`:

```json
{"type":"agent_end","willRetry":false,"messages":[{
  "stopReason":"error",
  "errorMessage":"429: {\"code\":\"1113\",\"message\":\"Insufficient balance…\"}"}]}
```

`agent_end` had no arm, so the catch-all dropped it. `classify_rpc_error`
already maps 429 to `QuotaExceeded` — it was simply never called.

The real cost was not the missing message. **The `2.4` fallback chain keys off
`AcpEvent::Error`, so it never fired for the quota and rate-limit failures it
was built to cover.** The one case where automatic model switching is the entire
point, and it was unreachable. Fixed in `f1a1e44`.

### A cold cache reads as a broken one — `5.2`

The chip called any rate under a third "cold" and captioned it *most of the
prompt is being resent*. On a first turn that is unavoidable: xAI keys its cache
to `prompt_cache_key`, which `pi-xai-oauth` derives from the session id, so a
new chat routes to a cold server by design.

I misread exactly this and spent an afternoon concluding a healthy channel was
broken. Measured properly — three turns inside one persistent session:

| | requests | hits | cached | rate |
|---|---|---|---|---|
| single-turn sessions | 1 | 0 | 0 | 0.0% |
| one warm session | 4 | 4 | 45,184 | 74.7% |

Discounting the unavoidably cold first turn, turns 2-4 reused 45,184 of 45,456
prompt tokens — **99.4%**. Nothing was wrong.

`cacheNote` now separates `opening` (first turn, nothing to reuse), `broken`
(was warm, dropped sharply) and `notEngaging` (several turns in, still cold),
and the note leads the tooltip instead of trailing the alarming band caption.
It also joins the aria-label, where the explanation was missing entirely.
Shipped in `9e1b189`.

### Three defects in shipped code, found by reading it

- **`costPreview`** priced `gpt-4o-mini` at the `gpt-4` rate — a first-match
  lookup, overstating it 33x. Most-specific match now wins, as
  `resolveTaskModel` already did. It was the only new module with no tests.
- **The fallback chain could bill forever.** The attempted-model list was
  rebuilt on every send, including the fallback's own resend, so two roles
  naming each other handed a turn back and forth indefinitely with a real call
  per hop. The exclusion moved into `nextFallbackModel`, where it is testable.
- **`automation_headless`** recorded `ran_late` as false on the success path,
  erasing the catch-up marker in the common case, and returned past
  `client.kill()` on a drain timeout, orphaning a `pi` process per occurrence.

### What was measured, and what it means

| | input | cache_read | rate | cost/turn |
|---|---|---|---|---|
| `xai-auth/grok-4.5`, cold turn | 17,022 | 128 | 0.8% | $0.034 |
| `xai-auth/grok-4.5`, warm session | — | — | 99.4% | — |
| `stepfun/step-3.7-flash`, cold turn | 394 | 10,496 | 96.4% | $0.000 |

`cache_write` is 0 on every provider measured — these report reads only, so it
is never the signal. `cache_read / (input + cache_read)` is.

stepfun hits on a *cold* turn because it caches on prefix rather than session
affinity. That is a real difference in cold-start behaviour, not a mark against
xAI, and it is the origin of the open item below.

`pi-cache-optimizer` was installed and measured against a four-run baseline: no
change to the hit rate, but ~2,100 fewer prompt tokens — a real 12% off each
turn, by slimming rather than reuse. Worth keeping, for a different reason than
the one it is filed under.

---

## Still open

Everything else in this document has shipped. What has not:

| | | Why it is still open |
|---|---|---|
| `0.5` | `App.tsx` at **9,200** lines | Target is under 6,000. Eleven hooks extracted so far, each with coverage. Strictly incremental. |
| `6.5` | Localisation | Closed as won't-do for this release. English stays the single source of truth. |
| `8.1` / `8.2` | macOS notarization, Windows signing | Purchase decisions, not engineering ones. Until then the README's `xattr` instruction is the honest answer. |

### `7.4` — resolved by removal

The Design workspace is gone: the icon, the placeholder component, its i18n,
its skin and its command-palette entry. Option 3 of the three listed below.

It shipped as 46 lines around `EmbeddedBrowser` and had been "coming soon" for
two releases. A third of the switcher was spent advertising something that did
nothing, and a permanent placeholder is worse than an absence — it asks the
user to keep noticing an unkept promise. Nothing is lost that was not already
absent, and the section below still records what it could become.

`loadWorkspace` already fell back to `code` for any unrecognised id, so anyone
sitting in Design when it was removed migrates on next launch rather than
opening into a workspace the shell can no longer render. That is now pinned by
a test rather than left to the fallback's good intentions.

### New — session-opening cost is real and unsurfaced

Not a defect; a consequence of design worth acting on. On a session-keyed
provider, **every new chat pays the full prompt prefix again** — ~15K tokens on
grok. Opening three chats for three related tasks costs three times the prefix;
continuing in one costs it once. On prefix-cached providers like stepfun it does
not apply.

`5.2` now explains this when it happens. What it does not do is help *before*:
nothing suggests continuing in an existing chat when that would be materially
cheaper, and the parallel task batch — which deliberately opens a fresh session
per task — has never accounted for it. Whether it should is a real trade-off:
isolation is the point of a batch, and paying a prefix for it may simply be
correct. It should be a measured decision rather than an unnoticed one.

### New — the model menu knows which models cannot run

Half this catalog is listed and selectable while having no balance. That was
silent before `f1a1e44`; it now produces a clear error, but only *after* a turn
has been spent waiting on retries.

`2.5` shipped provider health from ledger data. It has never had entitlement
failures to draw on, because they were being swallowed. It does now — so the
menu can mark a channel that last refused for balance before it is chosen, not
after.

---

## Verification

Frontend: 89 test files, 765 tests, typecheck clean, production build clean.
Rust: 338 tests, `clippy --all-targets -D warnings` clean.

---

## Where we actually are

Honest inventory, so the roadmap does not promise what already ships.

**Works today**

- **Model catalog** — parsed live from `pi --list-models`, plus a synthetic `auto`
  (`src-tauri/src/models_catalog.rs`). Per-model reasoning efforts come from the CLI.
- **Composer prefs at three scopes** — global / project / session
  (`store::resolve_composer_prefs`, `src-tauri/src/store.rs:1202`).
- **Parallel task batches** — the agent emits a `pi-tasks` fence, the shell turns it
  into concurrent sessions, one model per task (`src/lib/parallelTasks.ts`,
  `src/hooks/useTaskBatch.ts`). Model names are fuzzy-resolved, so "grok 4.5" hits
  `grok-4.5` and "gpt 5.6" does not shadow "gpt-5.6-luna".
- **Background streaming is real** — a streaming session demotes to a background pool
  and keeps streaming while another takes focus (`session_manager.rs`, I01–I03).
- **Real token usage** — parsed from Pi's own `usage` object, not estimated
  (`src-tauri/src/token_usage.rs`), surfaced as a cache-hit chip in the composer
  (`src/components/CacheChip.tsx`).
- **Cache packages** — a curated `cache` group in Settings → Packages.
- **Skills** — Settings → Skills lists, toggles and installs skills.
- **Workspaces** — Code / PR / Design switcher with per-workspace colour skins.
- **PR workflow** — `gh`-backed repo/PR listing, `/review-pr`, PR creation on push.
- **Worktrees**, **checkpoints**, **rewind**, **fork**, **automations**,
  **remote runtime**, **sandbox profiles**, **tool allow/deny**. Remote
  checkpoints are intentionally unavailable; the remote Git bridge covers the
  repository surfaces that can safely operate over SSH.
- **Automation run lifecycle** — every scheduled or manual run is linked to its
  session in `automation-runs.jsonl`, with append-only terminal updates and
  durable triage state. The existing Automations and Activity surfaces receive
  the latest outcome without a separate history screen.
- **Test suite** — 87 files, 738 tests, green.

**Known-weak**

- `App.tsx` remains above the intended 6,000-line extraction target; the
  activity-center wiring is now isolated and further extractions should stay
  test-backed.
- `commands.rs`, `session_manager.rs` and `ResourceViewer.tsx` remain large;
  further extraction should stay incremental and test-backed.
- Automation metadata intentionally keeps the latest summary; complete run history
  and triage are persisted separately in the append-only lifecycle ledger.
- Direct remote ACP has no file/Git/terminal bridge; SSH is the supported full
  remote workspace transport.
- The MCP bridge is intentionally local-only. It is not a WAN relay and does not
  provide remote filesystem access; clients must run on the same machine as the
  desktop app. Pairing/QR flows and per-integration scopes remain outside this
  release; the current local credential is per-launch, revocable and
  project-trusted.
- English only (a second language was removed in 0.2.12 rather than half-maintained).

---

## Phase 0 — Debts that block everything else

**Current state.** `0.1`–`0.4` are complete. Session sends, stop and edit/rewind
actions are addressed, the usage
ledger is durable, measured Usage data is authoritative, and the host scheduler
catches up all due rows. Scheduler failures now advance the cursor and persist the
latest error; run lifecycle details are additionally durable in the append-only
automation ledger. A separately managed `pi-app automation daemon` now covers the
fully-quit desktop case with the same claim lock and ledger. `0.5` remains
incremental: session open/connect/restore, composer draft/send-queue glue, inline
edit/resend, and activity-center event wiring are covered by
`useSessionLifecycle.ts`, `useComposer.ts`, `useInlineEdit.ts`, and
`useActivityCenter.ts`.

These are not features. They are load-bearing defects: several later phases are
unbuildable or unsafe on top of them.

### 0.1 `session_send` is focus-addressed, not session-addressed

**Gap.** `session_send(text, display_text, attachments)` takes no session id
(`src-tauri/src/commands.rs:33`). It delivers to whatever session is currently live.
`runTaskBatchWith` works around this by connecting and sending in immediate sequence
(`src/lib/parallelTasks.ts`, `TaskRunnerDeps.send(prompt)` — note the missing id).

**Why it matters.** Every batch launch is a race. Click another chat between the
connect and the send and your prompt lands in the wrong conversation. For a person
running four models on four tasks this is not an edge case, it is Tuesday.

**Touches.** `commands.rs::session_send`, `session_manager::send_message`,
`src/lib/api.ts`, `TaskRunnerDeps`, every `api.sessionSend` call site.

**Done when.** `session_send` takes an optional `session_id`; omitting it keeps the
current behaviour; the batch runner always passes one; a test starts two sessions,
sends to the non-focused one, and asserts the journal of the *other* session is
untouched.

**Size.** M. **Blocks.** 3.x, 4.x.

---

### 0.2 Usage totals do not survive anything

**Gap.** `usage_total` is a field on `LiveSession`
(`src-tauri/src/session_manager.rs:151`). It is initialised at spawn, folded on each
turn (`:1923`), and never written to disk. Disconnect, idle-recycle (I03), or quit,
and every figure is gone.

**Why it matters.** The cache chip is honest about the current process and silent
about everything else. "Did this week cost me €4 or €40?" is unanswerable. Phase 1
is entirely built on this.

**Touches.** New `usage_ledger.rs`; `store.rs` for the on-disk shape;
`session_manager.rs` at the fold point.

**Done when.** A per-session ledger file exists under the app data dir, appended on
every `turn_end`, keyed by session id and stamped with the model that produced it;
reopening a session shows its historical totals with no live process; a test round-trips
a ledger across a simulated restart.

**Size.** M. **Blocks.** 1.1, 1.2, 1.3, 1.4, 5.1.

---

### 0.3 The Usage page reports a guess as a fact

**Gap.** `usage.rs` computes `estimated_tokens(text) = chars / 4`
(`src-tauri/src/usage.rs:41`) and reports `models_used` as a bare **count**
(`:183`) — not which ones, not how much each.

**Why it matters.** Pi hands us exact figures on every turn and we throw them away,
then show the user arithmetic on character counts. For a multi-model user the single
most valuable page in the app is currently the least trustworthy one.

**Touches.** `usage.rs` (rewrite the source of truth to 0.2's ledger),
`src/components/UsageProfilePage.tsx`, `src/components/Heatmap.tsx`.

**Done when.** The Usage page's token and cost figures come from the ledger; the word
"estimated" disappears from the UI copy where the number is now measured, and is kept
only where a fallback genuinely estimates.

**Size.** M. **Depends on.** 0.2.

---

### 0.4 Automations only fire while the app is open, one per tick

**Gap.** The scheduler is a `window.setInterval(..., 30_000)` in `App.tsx:3211`, and
each tick fires **the first** due automation (`rows.find(...)`, `:3191`). Closed app,
or two automations due together, and work silently does not happen.

**Why it matters.** "Scheduled" that only runs when you are already looking at the app
is a reminder, not an automation.

**Touches.** Move the tick into Rust (a tokio interval in `lib.rs::setup`, the way the
idle and stall watchdogs already are, `lib.rs:143-150`); catch-up on launch for missed
windows; fire all due, not the first.

**Done when.** A run scheduled while the app was closed executes on next launch with a
"ran late" marker; two automations due in the same minute both run; the tray shows
pending runs.

**Size.** M–L.

---

### 0.5 `App.tsx` is 10,457 lines

**Gap.** Down from 10,771, but still the single largest file in the project by a wide
margin, holding routing, session lifecycle, composer state, automations ticking,
rewind, fork, worktrees, and workspace switching.

**Why it matters.** Every item in phases 3 and 4 adds state to this file. Each addition
gets more expensive and less testable than the last. The extraction pattern is already
proven here — `usePrWorkspace`, `useWorktreeDialogs`, `useTaskBatch` all came out with
tests attached.

**Touches.** Continue the same pattern. Next candidates, in order of value:

| Extract | Roughly | Into |
|---|---|---|
| Automations ticking + `runAutomation` | ~350 lines | `useAutomationRunner.ts` (extracted) |
| Rewind + fork + checkpoint dialogs | ~450 lines | `useRewindDialogs.ts` (extracted) |
| Composer draft, attachments, send queue glue | ~600 lines | `useComposer.ts` (extracted) |
| Inline edit / resend flow | ~250 lines | `useInlineEdit.ts` (extracted) |
| Session lifecycle (connect / switch / reattach) | ~700 lines | `useSessionLifecycle.ts` (extracted) |

**Done when.** `App.tsx` is under 6,000 lines and each extracted hook ships with a test
file, as the previous four did.

**Size.** L, but strictly incremental — one hook per PR, tests first.

---

## Phase 1 — Attribution: know what each model did, and what it cost

**Current state.** Complete. Turns carry model and effort metadata, the ledger is
queryable by model/project/day/session, Usage is cost-first, budget confirmation is
advisory, and cache standings are available in the session list.

The foundation of multi-model work. You cannot choose between models you cannot compare,
and you cannot compare what you did not measure.

### 1.1 Stamp every turn with the model that produced it

**Gap.** `SessionMeta.model_id` is a single `Option<String>`
(`src-tauri/src/store.rs:103`). Switch model mid-session — which the composer fully
supports — and the history keeps only the last choice. The journal line format
(`tool_step|status|kind|label`, `session_manager.rs:2282`) carries no model either.

**Why it matters.** "Grok wrote this part, GPT rewrote it, which one broke it?" is the
question, and today the transcript cannot answer it.

**Done when.** Each assistant turn records its model id and effort; the transcript shows
a small model badge on turns where the model differs from the previous one (not on every
turn — that is noise); exported bundles carry it.

**Size.** M. **Depends on.** 0.2.

---

### 1.2 A real usage ledger, queryable

**Gap.** Nothing aggregates across sessions.

**Done when.** One query answers: tokens and cost, grouped by any of *model*, *project*,
*day*, *session*; cache read/write split preserved; a `usage_ledger` unit test covers the
grouping arithmetic including the `cost_total: None` case that `TokenUsage::add` already
handles.

**Size.** M. **Depends on.** 0.2.

---

### 1.3 Rebuild the Usage page around cost-per-model

**Gap.** The page shows streaks and tool counts — engagement metrics for a tool whose
actual scarce resource is money and context.

**Done when.** The page opens on: spend by model this month, spend by project, cache hit
rate trend, and the turn that cost the most. Streaks stay, further down. Every figure
traceable to a ledger row.

**Size.** M. **Depends on.** 1.2.

---

### 1.4 Budget guard

**Gap.** No spend ceiling anywhere. Nothing stops a runaway agent loop on an expensive
model except noticing.

**Done when.** Optional monthly and per-session ceilings in Settings; at 80% a warning
chip, at 100% new turns require an explicit confirm (never a hard block — the user's
money, the user's call); the ceiling is per-model-tier, because a cap that treats a cheap
model like an expensive one is a cap you turn off.

**Size.** M. **Depends on.** 1.2.

---

### 1.5 Cache figures in the session list

**Gap.** The cache chip exists only in the composer, for the live session
(`CacheChip.tsx`), and correctly refuses to show another chat's figures
(`cacheChipView(payload, viewedSessionId)`).

**Done when.** The sidebar shows a cache standing dot per session, read from the ledger,
with no live process required.

**Size.** S. **Depends on.** 0.2.

---

## Phase 2 — Routing: the right model without thinking about it

**Current state.** Complete. The composer includes configured custom providers,
stable model roles, project/mode defaults, opt-in transient fallback, and measured
provider health indicators.

### 2.1 Custom providers in the composer

**Gap.** The catalog deliberately excludes them: *"Custom providers (`[model.*]` in
config.toml) are channels — switch them under Settings → Account → Providers, not here"*
(`models_catalog.rs:44-47`). So an OpenAI-compatible endpoint you configured is a
**global mode switch**, four clicks deep in Settings, not a per-message choice.

**Why it matters.** This is the single largest routing gap. Someone running a local model
alongside two hosted ones cannot switch between them from the composer at all.

**Done when.** Custom providers appear in the composer menu in their own group, visually
distinct from official catalog ids, selectable per session; picking one does not silently
rewrite the global default.

**Size.** M–L. **Note.** The current separation is a deliberate design decision, not an
oversight — changing it means owning the "which config does this write" question properly.

---

### 2.2 Model roles

**Gap.** Every model choice is a raw id. Ids churn; muscle memory does not.

**Done when.** Named roles — `fast`, `deep`, `cheap`, `review`, `local` — each bound to a
real id, editable in Settings; the composer and the task-batch fence accept role names;
`resolveTaskModel` (`parallelTasks.ts`) resolves roles before ids, so "use the fast one
for task 2223" works without naming a version number.

**Size.** M. **High value per unit of work.**

---

### 2.3 Per-mode and per-project model defaults

**Gap.** `resolve_composer_prefs` scopes by global/project/session, but a project has
**one** model regardless of what you are doing in it.

**Done when.** A project can specify a plan-mode model and an agent-mode model
separately; a `/review-pr` run can carry its own model without touching the project
default.

**Size.** S–M.

---

### 2.4 Automatic fallback on provider failure

**Gap.** Failures are already classified — quota / rate-limit / 429 / entitlement
(`src/lib/session.ts:1347`, `src-tauri/src/acp_client.rs:2730`) — and then reported to
the user, who retries by hand.

**Why it matters.** Rate limits are the daily tax of multi-model use. Classification
without action is half the feature.

**Done when.** An opt-in per-role fallback chain; on a classified quota or rate-limit
failure the turn is retried once on the next model in the chain; the transcript shows
plainly which model actually answered (needs 1.1); entitlement failures do **not**
auto-fallback — that is a purchase decision, not a transient error.

**Size.** M. **Depends on.** 1.1, 2.2.

---

### 2.5 Provider health

**Gap.** `providers_ping` exists (`providers.rs`) and returns latency, but only on demand
in the Providers panel. Nothing accumulates.

**Done when.** Rolling latency and failure rate per provider over the last N turns, from
ledger data; shown in the model menu as a subtle indicator, so a degraded endpoint is
visible at the moment of choosing.

**Size.** S–M. **Depends on.** 1.2.

---

## Phase 3 — Comparison: the thing multi-model users actually do

**Current state.** Complete. The existing composer menu starts 2–4 addressed runs;
the comparison view supports adoption, code diff reading, scoreboard attribution,
and isolated local or SSH worktree candidates.

Nothing in this phase exists today. It is the largest genuine capability gap, and it is
what would make this app worth using over a single-model client.

### 3.1 Fan-out: same prompt, N models

**Done when.** One composer action sends the current prompt to 2–4 selected models at
once; the machinery is the existing batch runner (`runTaskBatchWith`) with the same
prompt and different model ids; results land in sibling sessions grouped as one batch.

**Size.** M. **Depends on.** 0.1.

---

### 3.2 Side-by-side comparison view

**Done when.** A view showing N answers in columns, synchronised scrolling, with a diff
mode for code answers; per-column model, tokens, cost, latency (all from 1.2); collapse
identical regions so the actual divergence is what you read.

**Size.** L.

---

### 3.3 Adopt an answer

**Done when.** From the comparison view, one action grafts a chosen answer into the main
chat as if it had been the reply, discarding the others; the graft records which model
was adopted.

**Size.** M. **Depends on.** 3.2, and reuses the existing fork machinery (`session_fork`).

---

### 3.4 Best-of-N on worktrees

**Done when.** A task can be run by N models each on **its own git worktree** (the
worktree commands already exist: `git_worktree_add`, `git_worktree_remove`,
`git_worktree_gc`); the result is a three-way diff of what each model actually changed on
disk, not just what it said; adopting one merges its worktree and GCs the rest.

**Why it matters.** For code, the answer text is not the artefact — the diff is. This is
the highest-value item in the whole document for a working developer.

**Size.** L. **Depends on.** 3.2, 3.3.

---

### 3.5 Adoption scoreboard

**Done when.** A quiet count of which model's answers you actually adopt, per task type,
built from 3.3 events. No scores, no leaderboard theatre — a table you can read once a
month to notice you have been paying for a model you never pick.

**Size.** S. **Depends on.** 3.3.

---

## Phase 4 — Parallelism you can trust

**Current state.** Complete. The running-task dock, honest concurrency cap, desktop
notifications, interrupted-turn markers and retry path are wired to the existing
session manager rather than a second execution engine.

The host already supports concurrency. The shell does not yet make it legible.

### 4.1 A running-tasks dock

**Gap.** Background sessions stream invisibly. The batch strip shows a batch while it
launches, then the work disappears into the sidebar.

**Done when.** A persistent, collapsible strip listing every session currently streaming
— model, elapsed, token burn, a stop button — regardless of which batch or workspace
started it.

**Size.** M.

---

### 4.2 Concurrency that is honest about its cap

**Gap.** `planTaskWaves` splits by `maxConcurrentAgents` (default 3) because exceeding it
makes the host recycle a process mid-run. The user is never told which wave they are in.

**Done when.** The dock shows `3 / 3 agents · 2 queued`; raising the cap is one click from
there; the wave boundary is visible rather than mysterious.

**Size.** S. **Depends on.** 4.1.

---

### 4.3 Finish notifications

**Done when.** A background task completing raises a desktop notification (the
`desktopNotify` helper already exists) with the model and a one-line result; clicking it
focuses that session.

**Size.** S.

---

### 4.4 In-flight recovery

**Gap.** A crash or force-quit mid-turn loses the turn; on restart the session shows a
truncated exchange.

**Done when.** Startup reconciliation — which already exists for the operation journal
and checkpoints (`lib.rs:79-84`) — extends to interrupted turns: the session opens with
an explicit "this turn was interrupted" marker and a retry action, instead of a silent
gap.

**Size.** M.

---

## Phase 5 — Context and cache economics

**Current state.** Complete. Context denominators follow the active model, cache-break
causes are labelled as heuristics, compaction threshold is configurable, and the
composer shows a pre-send size/cost preview.

### 5.1 Per-model context windows

**Gap.** The context chip measures occupancy from real `input + cacheRead`
(`src/lib/contextUsage.ts:71`) — correct — but there is no per-model window size
anywhere in the tree. The denominator is not model-aware.

**Why it matters.** 120k tokens is comfortable on one model and overflowing on another.
A percentage against the wrong window is worse than no percentage.

**Done when.** Window size per model, sourced from the CLI catalog where it exposes one
and from a small local table where it does not; the chip's percentage is against the
**active** model's window; switching model recomputes it.

**Size.** M.

---

### 5.2 Cache-break lint

**Gap.** The cache hit rate is now measurable but not **actionable** — you can see it is
cold, not why.

**Done when.** When the rate drops sharply between turns, the chip explains the likely
cause in one line: a changed system prompt, a re-ordered attachment, a tool list change,
a mid-session model switch. Heuristic and clearly labelled as such.

**Size.** M. **Depends on.** 0.2.

---

### 5.3 Compaction control

**Gap.** Compaction is available but its timing is not the user's to shape.

**Done when.** Settings expose when compaction triggers (a percentage of the model's
window) and the transcript shows a clear compaction boundary with what was summarised.

**Size.** M. **Depends on.** 5.1.

---

### 5.4 Pre-send cost preview

**Done when.** With large attachments staged, the composer shows an estimated prompt size
and, where the model's pricing is known, an estimated cost, **before** send. Estimated
here is honest — nothing is measured until the provider answers.

**Size.** S–M.

---

## Phase 6 — The daily-driver surface

**Current state.** Complete except `6.5`, which is explicitly closed below. The
command palette, keyboard switching, cross-session search and two-session comparison
reuse the current workbench and its existing controls.

### 6.1 A real command palette

**Gap.** `⌘K` is bound to search (`src/lib/shortcuts.ts:22-28`). There are seven
shortcuts in total and none of them touch models or sessions.

**Done when.** `⌘K` opens a palette that includes search, plus: switch model, switch
session, switch project, switch workspace, run automation, open settings section, start a
batch. Search remains its first and default mode, so nothing is taken away.

**Size.** M.

---

### 6.2 Model and session switching from the keyboard

**Done when.** `⌘1..9` switches to the Nth pinned session; `⌘⇧M` opens the model menu with
type-ahead; a model switch never loses the composer draft.

**Size.** S.

---

### 6.3 Cross-session content search

**Gap.** `sessions_search` and `session_content_search` both exist host-side. Surfacing is
thin.

**Done when.** The palette searches message content across all sessions, with model and
project filters, and jumps to the matching turn.

**Size.** M. **Depends on.** 6.1.

---

### 6.4 Session comparison of the mundane kind

**Done when.** Two sessions can be opened side by side without a batch — for the common
case of reading yesterday's attempt while making today's.

**Size.** M.

---

### 6.5 Localisation, if it is ever done properly

**Gap.** English only since 0.2.12, which removed a half-maintained second language
rather than pretend.

**Done when.** Either the i18n layer carries a complete second locale with a CI check that
fails on a missing key, or this item is closed as won't-do. Half is worse than neither.

**Size.** L. **Priority.** Low, and honestly stated as such.

**Decision (2026-08-03).** Closed as **won't-do for this release**. The app keeps
one complete English locale rather than shipping a second partial translation;
the i18n layer remains the single source for every UI string so a future locale
can be added with a completeness check.

---

## Phase 7 — Workspaces: PR and Design

**Current state.** Complete for this release. PR reviews can select a model, publish
line comments after confirmation, fan out reviews, and merge findings; Design is a
live embedded-preview workspace rather than a placeholder.

### 7.1 PR review with a chosen model

**Done when.** The PR workspace carries its own model preference, so reviews run on a
review-grade model without disturbing the code workspace's default. Follows directly from
2.3.

**Size.** S. **Depends on.** 2.3.

---

### 7.2 Inline PR comments

**Gap.** `gh_pr_diff` fetches; nothing posts back except `gh_pr_create`.

**Done when.** A review produced in the PR workspace can be posted as line-anchored
comments, after an explicit confirm showing exactly what will be posted and where.
Publishing to a shared repository is not something to do silently.

**Size.** M.

---

### 7.3 Multi-model PR review

**Done when.** A PR can be reviewed by two models in parallel and their findings merged
into one list, deduplicated, with each finding attributed. This is 3.1 pointed at a diff.

**Size.** M. **Depends on.** 3.1, 3.2.

---

### 7.4 Decide what Design is

**Gap.** The third workspace ships as "coming soon". That is honest for one release and
becomes clutter after two.

**Options**, to be chosen deliberately rather than by drift:

1. **Screenshot-to-code** — drop a design, get a component, iterate visually.
2. **Live preview loop** — the embedded browser (`EmbeddedBrowser.tsx`) as a first-class
   design surface with visual diffing between runs.
3. **Remove it** until there is a real answer.

**Recommendation.** Option 2 — it reuses what exists and is genuinely differentiating.
Option 3 is strictly better than leaving a permanent placeholder.

**Size.** L.

---

## Phase 8 — Distribution and trust

**Current state.** `8.3` and `8.4` are complete. `8.1` and `8.2` remain external
certificate/purchase blockers, not code gaps; the README states the unsigned-release
constraints honestly.

### 8.1 macOS notarization

**Gap.** Builds are ad-hoc signed. First launch requires
`xattr -dr com.apple.quarantine /Applications/Pi.app`, documented in the README because
it is the only method that still works — right-click → Open was removed in Sequoia and
tightened again in Tahoe.

**Reality.** This is not an engineering problem. It requires the paid Apple Developer
Program (**$99/year**) and a Developer ID certificate. There is no free path.

**Done when.** Either the programme is bought and `notarytool` is wired into the release
workflow with the credentials as repo secrets, or this is closed as won't-do and the
README stays as the honest instruction it already is.

**Size.** S once the certificate exists. **Blocked on.** A purchase decision.

---

### 8.2 Windows code signing

**Gap.** Unsigned installers trigger SmartScreen.

**Done when.** An EV or OV certificate signs the installer, or this too is explicitly
closed. Same shape of decision as 8.1, different price.

**Size.** S. **Blocked on.** A purchase decision.

---

### 8.3 Keep the update path verified

**Gap.** The update check was broken for a long time in a way tests had enshrined — a
block-list rejected the app's own endpoint, and a test asserted the bug. Fixed in
`11ba19b` with an allow-list.

**Done when.** A release-workflow step downloads the published `latest.json` and asserts
every platform entry resolves to a real asset, so a broken update path fails the release
rather than the user.

**Size.** S.

---

### 8.4 Opt-in crash reporting

**Done when.** Off by default, one clear switch, local-first: crashes append to a local
file the support bundle already collects (`support_bundle.rs`), and uploading is a
separate deliberate action. No silent telemetry, ever.

**Size.** M.

---

## Phase 9 — External control

**Current state.** Complete for this release without adding a new UI surface. The
desktop owns a loopback-only JSONL control endpoint and the shipped binary exposes
`pi-app mcp serve` as a standard MCP stdio adapter.

### 9.1 Local MCP control plane

**Done when.** An external MCP client can inspect the app, list trusted projects and
sessions, read a trusted-project transcript, start an addressed task, wait for its
terminal/approval state, and cancel it. The control plane must reuse the existing
`SessionManager`, never open a WAN listener, and never accept an arbitrary project
path.

**Delivered.** `src-tauri/src/mcp.rs` binds only to `127.0.0.1`, rotates a random
per-launch token in a private endpoint file, scopes all session reads and task starts
to trusted projects, forces `ask` on externally created sessions, applies a
per-endpoint request rate limit, and keeps a redacted append-only audit trail.
`requestId` fingerprints are reserved before side effects and persisted with a
status so retries are idempotent and argument changes are rejected. The stdio
adapter reloads endpoint metadata with bounded reconnect attempts, and
`pi-app mcp revoke` provides runtime token revocation without a desktop restart.

**Size.** M.

### 9.2 Remote MCP / WAN access

**Decision.** Not doing in this release. T3-style remote access needs an explicit
authenticated relay, pairing/revocation, rate limits, and a threat model beyond a
desktop loopback bridge. The existing SSH remote runtime remains the supported
cross-machine path.

---

## Deliberately not doing

Pi's design is *primitives, not features*. It omits sub-agents, plan mode and permission
systems on purpose. A shell that reintroduces them as built-ins is fighting its own
runtime.

| Not doing | Why |
|---|---|
| A built-in prompt library | That is a package. `pi install` already handles it. |
| A shell-side agent framework | Pi owns agents. The GUI orchestrates sessions, not reasoning. |
| Bundled model API keys / a proxy | Keys stay Pi's. The GUI never becomes a billing intermediary. |
| A plugin API of our own | Pi packages are the extension point. Two would be one too many. |
| Silent telemetry | Not in a local-first tool. |
| Auto-accepting agent edits | The user's repository is not ours to write to unattended. |

---

## Ordering

Not a schedule — a dependency order. Each block is shippable on its own.

**First — the debts.** `0.1` and `0.2` unblock most of the document and are both
medium-sized. `0.3` follows immediately from `0.2` and turns the least trustworthy page
into the most useful one.

**Then — attribution.** `1.1 → 1.2 → 1.3`. After this the question "what did last week
cost, and to which model" has an answer.

**Then — the cheapest large wins.** `2.2` (model roles) and `6.1` (command palette) are
each medium-sized and change daily use more than their size suggests. `2.4` (fallback)
converts existing error classification into behaviour.

**Then — comparison.** `3.1 → 3.2 → 3.3 → 3.4`. This is the differentiator, and it is
also the largest sustained piece of work here. Do not start it before `0.1`.

**Continuously — `0.5`.** One hook extracted per PR, tests first, exactly as
`usePrWorkspace`, `useWorktreeDialogs` and `useTaskBatch` were done. Every phase above
adds state to `App.tsx`; the extraction has to keep pace or it never happens.

**Whenever the decision is made — `8.1` and `8.2`.** Purchase decisions, not engineering
ones. Until then the README's instruction is the honest answer, and should stay.
