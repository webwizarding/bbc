# Claude Code Prompt — Canvas Refined: harden, refactor, extend

Paste this as the opening message in a Claude Code session started inside a fresh clone
of `https://github.com/GuySandler/CanvasRefined`.

---

## Mission

You are working on **Canvas Refined**, an MIT-licensed browser extension for Instructure
Canvas LMS. It is a fork of `UseBetterCanvas/bettercanvas` taken from before that project
relicensed and became the freemium "BetterCampus."

Three goals, strictly in this order:

1. **Make the existing features work reliably.** This is the priority. The extension has
   real correctness and lifecycle bugs that cause features to silently stop applying.
2. **Restructure the codebase** so further work is tractable and regressions are catchable.
3. **Add new capability** in the spirit of what BetterCampus now charges for, implemented
   independently and entirely locally.

Do not start on goal 3 until goals 1 and 2 have landed.

---

## Ground rules — read before writing any code

**Licensing.** The fork is MIT and legitimately so. Keep `LICENSE-MIT`, keep both copyright
lines (ksucpea 2024, Guy Sandler 2026), and keep attribution to the original authors in
`README.md`. Any file you create carries the same license.

**Clean-room boundary.** BetterCampus's current code is not ours to use. You must not:
- download, unpack, decompile, or read BetterCampus's shipped extension bundle;
- copy code, CSS, asset files, or string content from it;
- port anything from `UseBetterCanvas/bettercanvas` commits made *after* their license change.

You **may** implement features that BetterCampus also has, working only from publicly
published feature descriptions (their marketing site, store listing, user reviews). Features
and ideas are not copyrightable; expression is. Write every line yourself.

**No paywall circumvention.** Nothing in this project touches BetterCampus's accounts,
servers, entitlement checks, or Pro gating. We build our own local equivalents from scratch.
If any task starts to look like defeating their licensing, stop and say so.

**Local-first, no telemetry.** The extension has no backend and gains none. No analytics, no
phone-home, no bundled third-party API keys, no remote code execution. Everything stays in
`chrome.storage`. The existing `PRIVACY_POLICY.md` promise ("stays fully local") is a hard
constraint, not a nicety. If a feature genuinely cannot work without a network call, it must
be opt-in, off by default, and use a credential the user supplies themselves.

**Store policy.** Chrome Web Store MV3 forbids remotely hosted code and requires that
requested permissions be justified by actual functionality. Firefox AMO reviews source. Both
matter here — see the permissions work in Phase 1.

---

## Phase 0 — Recon (do this first, report before changing anything)

Do not trust the findings below. They came from a read-through and may be stale or wrong.
Verify each one against the current tree and tell me which hold.

```
Repo layout (main branch):
  manifest.json          MV3, version 6.4.0, permissions: ["storage"] only
  js/content.js          ~5,662 lines — the monolith
  js/popup.js            ~2,404 lines
  js/background.js       ~233 lines — service worker + defaults
  js/themes.js           ~468 lines — hardcoded theme array
  js/markdown.js         ~204 lines — hand-rolled markdown renderer
  js/backgrounds.js      ~31 lines
  css/darkmodecss.js     ~1,209 lines — dark mode CSS as a JS-injected string
  css/{content,popup,options}.css
  html/popup.html        ~1,208 lines
  html/options.html      ~56 lines
  _locales/              11 locales
```

Read `README.md` in full — it documents the project's own contribution conventions for
adding a feature (`syncedSwitches` in `popup.js`, `syncedOptions` + `default_options` in
`background.js`, a switch case in `applyOptionsChanges()`, and placement rules for whether
the work belongs in `checkDashboardReady()`, `applyAestheticChanges()`, or `startExtension()`).
**Follow those conventions for every new option you add.** They are the closest thing this
project has to an architecture doc.

Also check the `dev` branch — there is active alpha work there. Report anything in flight so
we do not collide with it.

Then produce a written map of `content.js`: what each region does, what state it shares, and
where the seams are for splitting it up. I want to see this map before you refactor.

---

## Phase 1 — Correctness and stability

These are the specific defects I found. Confirm each, then fix. Each gets its own commit.

### 1.1 SPA navigation — the big one

`content.js` opens with:

```js
const domain = window.location.origin;
const current_page = window.location.pathname;
```

Both are captured once at `document_start` and never recomputed. Every route check in the
file (`isDashboardPage`, `isGradesPage`, `isQuizPage`, `getSidebarLayoutMode`,
`getCurrentCourseId`, `getApiData`, and the rest) reads the stale `current_page`. When Canvas
navigates client-side, these all still describe the page you landed on.

Build a real navigation layer:
- a `getRoute()` accessor that reads live location, replacing every `current_page` reference;
- a navigation observer combining `popstate`, patched `pushState`/`replaceState`, and a
  fallback `MutationObserver` or the Navigation API where available;
- a teardown/reapply cycle so features that decorated the old page clean up and the right
  features initialize for the new one. Reapplying without teardown will duplicate injected
  nodes — verify by navigating back and forth ten times and counting them.

I expect this alone to resolve a large share of the "works sometimes" reports.

### 1.2 API layer

`getData()` currently fetches, calls `response.json()`, and returns. It:
- never checks `response.ok`, so an auth redirect returning HTML throws an opaque parse error;
- never follows the `Link: rel="next"` header, so `courses?per_page=100` and
  `planner/items?per_page=75` silently truncate for students with heavy loads;
- has no timeout, no retry, and no caller-visible error type.

Write a proper `canvasApi` module: `ok` checking, automatic `Link` pagination with a page
cap, `AbortController` timeout, one retry with backoff on 5xx, respect for `429` and any
`Retry-After`, a typed error, and a short in-memory response cache so a single page load does
not refetch `/users/self/colors` several times. Have every existing call site go through it.

Note the CSRF pattern already in the tree: `CSRFtoken()` reads the `_csrf_token` cookie and
mutating calls send it as `X-CSRF-Token`. `createCanvasPlannerNote()` tries three body
encodings in sequence because Canvas instances disagree. Preserve that fallback behavior when
you consolidate — it exists for a reason. Move it into the API module rather than duplicating
it at each of the six-ish call sites.

### 1.3 Storage quota

`chrome.storage.sync` allows 8,192 bytes per item and 102,400 bytes total. These all live in
sync today and all grow with usage: `custom_cards`, `custom_cards_2`, `custom_cards_3`
(per-course image URLs), `assignments_done`, `assignment_states`, `custom_assignments`,
`custom_task_links`, `reminders`. Not one `chrome.storage.sync.set()` in the codebase has a
`.catch()`, so a quota rejection is a silent data loss.

- Write a storage abstraction that routes each key to sync or local by policy.
- Sync keeps only small, genuinely portable preferences.
- Bulk and per-course state moves to `chrome.storage.local`.
- Add a versioned migration that runs on update and moves existing users' data across without
  losing it. Test the migration against a seeded profile — do not ship a migration you have
  not run.
- Handle `QUOTA_BYTES_PER_ITEM` and `QUOTA_BYTES` explicitly with a visible message.

### 1.4 Host permissions and injection scope

The manifest matches `https://*/*` and injects four scripts at `document_start` on every
HTTPS site the user visits. On non-Canvas pages `isDomainCanvasPage()` falls through to a
reminder poller (`setTimeout` 2s, then `setInterval` every 60s, forever).

This is a privacy problem, a performance problem, and a review-risk problem. The upstream
project has bounced this permission repeatedly across versions, which suggests reviewers push
back on it.

Rework to: a narrow static content script for known Canvas host patterns, plus
`optional_host_permissions` and `chrome.scripting.registerContentScripts()` for the
user-supplied custom domain, requested at the moment the user adds their domain. Keep the
first-run flow good — if permission is refused, explain what breaks rather than failing
silently. Preserve the existing `custom_domain` setting and migrate it.

### 1.5 Race conditions and timing hacks

```js
setTimeout(() => runDarkModeFixer(false), 800);
setTimeout(() => runDarkModeFixer(false), 4500);
```

Replace guessed delays with actual readiness signals. Audit `checkDashboardReady()` — its own
comment describes an infinite reflow loop that was patched with a card-set signature guard,
which suggests the observer strategy is fragile. Consider a single coordinated observer with
explicit lifecycle rather than several independent ones (footer, new-canvas button, sequence
footer, submission button, profile logout button each run their own).

### 1.6 The `gradent_cards` typo

`background.js` `default_options.sync` defines `"gradent_cards": false`. Every reader —
`popup.js` `syncedSwitches`, `applyOptionsChanges()` case, `changeGradientCards()`, and every
theme export in `themes.js` — uses `gradient_cards`. The default is orphaned; the real key has
no default. Fix the key, migrate any user data under the misspelling, and grep the whole tree
for other key mismatches of the same shape.

### 1.7 XSS and injection surface

35 `innerHTML` assignments. User-controlled values reach the DOM and CSS: `custom_font.family`
and `.link`, `customBackgroundLink`, dashboard notes text via the hand-rolled `markdown.js`,
theme fields including `sidebar` values that already contain `linear-gradient(...) url(...)`
strings, and custom task links.

Audit every sink. Escape or use `textContent`/DOM construction. Validate URL schemes against
an allowlist (`https:` only; reject `javascript:`, `data:` where it can execute). Review
`markdown.js` specifically for HTML passthrough. Consider a stricter `content_security_policy`
in the manifest.

### 1.8 Accessibility

Open issues #7, #11, #12 all concern accessibility, largely around the better todo list and a
scroll trap. Read them, reproduce them, fix them. Then sweep the injected UI generally:
keyboard reachability, visible focus, ARIA on custom controls (the radio-pair-plus-slider
toggle pattern in `popup.html` needs checking), and contrast — the dark mode presets and
theme palettes should be measured against WCAG AA, not eyeballed.

### 1.9 Smaller items

- NASA APOD uses `api_key=DEMO_KEY` — 30 requests/hour and 50/day *shared across every user of
  the extension*. This will fail constantly. Add an optional user-supplied key field and
  degrade gracefully with an honest message when rate-limited.
- `manifest.json` says `6.4.0`; the store listing says `0.3.1`. Pick one scheme and document it.
- `background` declares both `scripts` and `service_worker`. Verify the Firefox and Chrome
  paths both actually work and that `chrome.*` vs `browser.*` namespacing is handled.
- Dark mode ships as a ~1,200-line CSS-in-JS string in `css/darkmodecss.js`. Check for
  flash-of-light-content on load and move to a real stylesheet with CSS custom properties if
  that is what it takes to kill the flash.

---

## Phase 2 — Architecture

Only after Phase 1 is green.

**Split `content.js`.** Target modules along the seams your Phase 0 map identified — roughly:
routing, storage, API, dark mode/theming, dashboard cards, todo list, sidebar, GPA, notes,
backgrounds, reminders. Shared mutable globals (`options`, `assignments`, `grades`,
`cardAssignments`) become an explicit state module with defined ownership. No module over
~600 lines.

**Add a build.** ESBuild or Vite, one config, producing MV3-valid Chrome and Firefox bundles.
Keep `npm run dev` fast. The current no-build setup is genuinely nice for hacking — do not
introduce a toolchain heavier than the project can carry. Source maps in dev, none shipped.

**Add tests.** Vitest for pure logic — GPA math, date formatting, the markdown renderer,
pagination, storage routing, migrations. Playwright against a fixture Canvas page for the
DOM-touching paths. Aim for coverage of the bug classes above, not a coverage percentage.

**Add lint and CI.** ESLint plus Prettier matching the existing style (4-space indent; note
the file has mixed CRLF/LF and mixed tabs/spaces — normalize in one isolated commit so it does
not pollute review of real changes). GitHub Actions running lint, tests, and a build on PRs.

**Add a debug mode.** A hidden setting that logs feature lifecycle events. Ninety percent of
"it stopped working" reports become diagnosable if the user can paste a log.

---

## Phase 3 — New features

Independent implementations of capabilities BetterCampus now gates behind Pro. Local-only,
clean-room, each behind its own toggle following the README's option conventions. Ordered by
value; do not batch them — one feature per PR, each shippable alone.

### 3.1 Full-page planner view

The single loudest complaint in BetterCampus reviews is the removal of the full-screen
to-do list. Build a dedicated view — an extension page or an injected route — showing every
assignment and task across all courses with filtering by course, date range, and completion,
plus sorting and a keyboard-driven quick-add.

Data comes from `/api/v1/planner/items` (properly paginated now) merged with the existing
`custom_assignments`. Much of the rendering logic already exists in the better-todo code
(`createTodoSections`, the progress ring renderers) — reuse rather than reimplement.

### 3.2 Recurring tasks and subtasks

Canvas `planner_notes` have no recurrence or subtask fields. The codebase already solves an
identical gap for links: `custom_task_links` stores a user link in extension storage keyed by
note id. Follow that pattern.

Store an RRULE-subset recurrence rule and a subtask array in local storage keyed by planner
note id, and materialize occurrences client-side. Reconcile on load — notes deleted in Canvas
must not leave orphaned recurrence metadata. `createCanvasPlannerNote`,
`updateCanvasPlannerNote`, and `deleteCanvasPlannerNote` already exist; extend them.

### 3.3 Calendar export

BetterCampus does Google/Microsoft calendar sync via their backend. We have no backend, so do
the version that needs none:
- generate a valid `.ics` client-side from planner items and custom tasks and offer a download;
- build "Add to Google Calendar" and Outlook template URLs for individual items;
- surface and explain Canvas's own native calendar feed, which already provides real
  subscription sync and which most students do not know exists.

That covers the actual user need without OAuth, a server, or storing anyone's tokens.

### 3.4 What-if grades and target calculator

Already on the project's planned list. Fetch
`/api/v1/courses/:id/assignment_groups?include[]=assignments&include[]=submission`, respect
group weights and grading periods, let the user edit hypothetical scores, and answer the
question students actually ask: what do I need on the remaining work to finish at X.

Handle the awkward cases: ungraded assignments, excused submissions, letter and pass/fail
schemes, dropped-lowest rules where detectable. Reuse `gpa_calc_bounds`.

Related and cheap: the community-suggested "if you get a zero on this, your grade becomes Y"
readout on the assignment page.

### 3.5 Grade history graph

From submission history. Local, no new permissions.

### 3.6 Course notes

Generalize the existing markdown dashboard notes to per-course notes, with search across
them. The renderer and editor already exist in `loadDashboardNotes` / `wireDashboardNotes`;
this is mostly a storage-keying and UI-surface change. Watch the storage routing from 1.3 —
notes belong in local, not sync.

### 3.7 Flashcards and quizzes — without the AI

Local decks with spaced repetition (SM-2 or FSRS), manual authoring, and import/export.
No account, no server, no cost.

**If and only if** you add AI generation on top: it is opt-in, off by default, the user pastes
their own API key, the key is stored locally and never transmitted anywhere but the provider,
the settings UI states plainly what is sent and where, and the feature is fully functional
without it. Do not bundle a key. Do not proxy through anything.

### 3.8 Theme browsing without a backend

The fork lost theme search when it lost upstream's server; `themes.js` is now a hardcoded
array. Restore browsing by hosting a theme index as JSON in the repo, fetched from
`raw.githubusercontent.com`, with new themes submitted by pull request. Fully FOSS,
no infrastructure, no moderation queue to run.

Validate every theme field on load — a theme is untrusted input and feeds directly into the
CSS sinks from 1.7.

### 3.9 Lower priority

Global Canvas search; inbox/mail improvements; goals and streaks; an opt-in breathing widget.
All local. Do these last.

---

## How to work

- **One concern per commit**, conventional-commit style. Formatting and normalization
  commits stay separate from behavioral ones.
- **Before each fix**, state your reproduction. Before each feature, state the data source
  and the storage keys you will add.
- **After each change**, tell me exactly what to click to verify it, and what the failure
  looked like before.
- **Test on a real instance.** `canvas.ucsc.edu` is the target deployment. Canvas instances
  vary a great deal in enabled features and API availability — if something depends on an
  optional Canvas feature, degrade gracefully rather than throwing.
- **Ask before**: adding any dependency, adding any permission, changing any existing storage
  key's meaning, or anything that touches the network.
- **Update `README.md`** as features land. Move items out of "Planned Features" as you go.

## When you are done with a phase

Report: what changed, what you verified and how, what you could not verify without a live
Canvas session, and what you deliberately left alone. Flag anything you found that I did not
list — my read-through was not exhaustive and `content.js` is 5,662 lines.

## One more thing

This is an active upstream project with a responsive maintainer and only three open issues.
Before building any Phase 1 fix, check whether it is already fixed on `dev`. The Phase 1 work
in particular — the SPA routing fix, pagination, storage quota, the permissions narrowing —
is exactly the kind of contribution that belongs upstream as PRs rather than in a private
fork. Structure the commits so they are cleanly submittable.
