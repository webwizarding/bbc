# Phase 2 module boundary plan

**Checkpoint 2 deliverable.** Nothing has moved yet.

Derived fresh against `js/content.js` at its current **9,524 lines / 312
top-level functions**, not adjusted from the Phase 0 map. That map was drawn
against 5,662 lines before the upstream `dev` merge, which added a 1,753-line
grade-analytics block and a 574-line global-search block that did not exist
then, and before Phase 1 added routing, lifecycle, API and storage layers. Its
region numbers no longer describe this file.

Two files already live outside `content.js` and are not part of this plan:
`js/storage.js` and `js/sanitize.js`, both extracted during Phase 1 because the
popup needed them too.

---

## Proposed modules

Target is ~600 lines. Sizes are the sum of each function's span, so they run
slightly under the real file total; treat them as proportions.

| Module | Fns | Lines | Notes |
|---|---:|---:|---|
| `quarantine/grade-analytics.js` | 65 | 1,753 | moved whole, untouched — see below |
| `quarantine/global-search.js` | 24 | 574 | moved whole, untouched |
| `todo/load.js` | 4 | ~310 | `loadBetterTodo`, `setupBetterTodo`, timeframe/scope helpers |
| `todo/sections.js` | 5 | ~280 | `createTodoSections`, `clearTodoList`, view-more |
| `todo/task-form.js` | 6 | ~256 | `ensureTodoTaskMenu` + the task form |
| `todo/progress.js` | 13 | 621 | the five ring renderers and the indicator |
| `todo/populate.js` | 7 | 489 | `populateAssignments`/`Announcements`, `markAs`, confetti |
| `todo/preview.js` | 7 | ~120 | hover preview |
| `cards.js` | 14 | 580 | card fetch, customization, assignments, heights |
| `backgrounds.js` | 6 | 545 | custom background, daily, NASA overlay |
| `sidebar.js` | 20 | 506 | better sidebar, badges, nav population |
| `api/canvas.js` | 20 | 442 | `canvasApi`, the data globals, `withApiData` |
| `bootstrap.js` | 7 | 413 | `startExtension`, `applyOptionsChanges`, domain gate |
| `theming/dark-mode.js` | 11 | 386 | dark CSS generation, fixer, auto-schedule |
| `notes.js` | 7 | 316 | dashboard notes and the markdown surface |
| `page-chrome.js` | 16 | 270 | footer, buttons, favicon, sequence footer |
| `gpa.js` | 4 | 248 | calculator |
| `api/planner-notes.js` | 9 | 222 | note CRUD + custom task links |
| `lifecycle.js` | 14 | 213 | registry, reconcilers, `whenSettled`, `ensureInjected` |
| `dashboard.js` | 8 | 187 | `checkDashboardReady`, update message, course order |
| `routing.js` | 21 | 178 | `getRoute`, predicates, navigation, route cycle |
| `util.js` | 9 | 164 | `makeElement`, `makeActivatable`, formatting, `logError` |
| `theming/appearance.js` | 3 | 141 | aesthetics CSS, custom font |
| `reminders.js` | 6 | 116 | browser-wide reminders |
| `quiz-safe-mode.js` | 2 | 93 | banner and gating |
| `grades.js` | 2 | 52 | dashboard grade insertion |

26 modules. Every non-quarantine module lands at or under ~620 lines.

---

## The quarantined features: isolated, not threaded through

**Recommendation: move them into their own modules wholesale, unmodified.**

They are 2,327 lines — 24% of the file — and both are disabled by default. The
argument for isolating rather than integrating:

- Threading them through the general split means reading and re-organising code
  that **cannot currently execute**, and any judgement made while doing so is
  unverifiable until someone enables the feature.
- Three Phase 1 bugs came out of the `dev` merge, all in code that looked
  solved. These two blocks are the largest unreviewed inheritance left, and
  `docs/DEV_MERGE_REVIEW.md` already lists them as unaudited. Moving them
  intact keeps that boundary honest: a later reviewer sees one file per
  feature, unchanged since the merge.
- They own 27 of the 71 `innerHTML` sinks, already deferred to Phase 3 with
  their gates verified. Splitting them across general modules would scatter
  those sinks into files that are otherwise clean.

So: `quarantine/grade-analytics.js` and `quarantine/global-search.js`, moved
verbatim, with a header saying what they are and that they are disabled. They
break the ~600-line target deliberately, and that is the point — the target
exists to make code reviewable, and these are explicitly not being reviewed
yet. When Phase 3 enables one, splitting it becomes part of that work, with a
person able to actually run it.

---

## Shared mutable state

The Phase 0 map found 12 cross-region globals. The count is now higher, and the
split turns every one into an explicit dependency. Current writers:

| State | Writers | Proposed owner |
|---|---|---|
| `options` | `isDomainCanvasPage`, `startExtension`, `applyOptionsChanges`, `saveCustomTaskLink`, `deleteCustomTaskLink`, `setAssignmentState` | `state.js`, written only by `bootstrap` |
| `assignments`, `grades`, `cardAssignments` | `getAssignments`, `getGrades`, `preloadAssignmentEls` | `api/canvas.js` |
| `announcements`, `completed`, `assignmentsDue` | `createTodoSections`, `renderProgressRings` | `todo/state.js` |
| `filter`, `betterTodoFilter`, `betterTodoTimeframe`, `betterTodoProgressFilter`, `moreAssignmentCount`, `moreAnnouncementCount`, `moreCompletedCount`, `domContainers` | across `todo/*` | `todo/state.js` |
| `lastDashboardCardSignature`, `dashboardReadyTimer`, `sidebarReadyTimer` | `checkDashboardReady`, `resetRouteState` | `dashboard.js` |
| `lifecycle`, `domReconcilers`, `currentRoute` | registry functions | `lifecycle.js`, `routing.js` |

`options` is the hard one: **60+ readers**. It becomes a module with a getter
and a single writer, so a module that mutates it fails review rather than
working by accident. Four of these globals were only discovered by enabling
`no-undef`, having been implicit globals; the split would have surfaced them
anyway, but as errors much later.

---

## Sequencing

Each step keeps the extension loadable and the suite green.

1. **`util.js`, `routing.js`, `lifecycle.js`** — few inbound dependencies, and
   the ones most heavily covered by existing tests.
2. **`api/canvas.js`, `api/planner-notes.js`, `state.js`** — turns the promise
   globals into module state with real owners.
3. **The leaf features**: `reminders`, `quiz-safe-mode`, `gpa`, `notes`,
   `grades`, `backgrounds`, `page-chrome`, `theming/*`.
4. **`cards.js`, `dashboard.js`, `sidebar.js`** — heavier DOM coupling.
5. **`todo/*`** — last, as a unit. Six modules sharing one state module; the
   most entangled cluster in the file.
6. **`bootstrap.js`** — what remains, reduced to wiring.
7. **The two quarantine modules**, moved verbatim at any point; they have no
   inbound dependencies.

## Build implications

The build currently copies rather than bundles, because these are classic
scripts sharing a global scope and the manifest loads them in order. The split
changes that: modules mean `esbuild` bundles `content.js` from an entry point,
and the manifest lists one built file instead of six. That is a change to
`tools/build.mjs` and `manifest.json`, and it should land with step 1 rather
than at the end, so every later step is exercised through the real build.

`js/storage.js` and `js/sanitize.js` are loaded by both the content script and
the popup. Once bundling exists they can be imported by both entry points
instead of being separate `<script>` tags.

## Risks

- **The extension is not browser-verified.** Everything in Phase 1 was checked
  by tests and static analysis. Moving 9,500 lines on top of an unverified base
  compounds that. A load-unpacked pass before step 1 is worth more than at the
  end.
- **`applyOptionsChanges` is a 300-line switch** calling into nearly every
  module. It becomes a registry that modules subscribe to; that is a behaviour
  change wearing a refactor's clothes and deserves its own commit and its own
  test.
- **`options` timing.** Several modules read `options` at load, not at call. A
  module boundary makes that ordering explicit and may expose reads that
  currently work only because of script order in the manifest.
