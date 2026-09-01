# Teardown inventory (Phase 1.1)

What each feature creates, mutates, observes, and schedules — the input to the
teardown/reapply cycle. Line numbers are against `js/content.js` at the time of
writing and will drift.

The governing fact: **Canvas destroys and recreates the dashboard, course
content, and sidebar on client-side navigation.** Most in-place mutations on
Canvas-owned nodes therefore need no restoration — the node is gone. What
leaks across navigation is anything attached above the swapped subtree:
`document.head`, `document.documentElement`, `document.body`, and anything
holding a reference (observers, intervals, listeners).

## The classification rule

**A feature is document-scoped if it attaches above Canvas' client-side swap
boundary, and route-scoped if it lives in the subtree Canvas destroys.**

This is the rule for every feature added from here on. It is structural, not a
judgement call, and it is checkable: look at what the feature appends to. If
the attach point is `document.head`, `document.documentElement`, or
`document.body`, it survives navigation and must initialise once. If it is
inside `#content`, `#right-side`, the dashboard card container, or the course
sidebar, Canvas will destroy it and it must be reapplied.

The earlier framing — that these features "happen to be route-independent" —
was weaker and got the right answer for the wrong reason. Route-independence
is a consequence of the attach point, not a separate property to assess.

Two practical corollaries:

- A document-scoped feature must never be registered with the route cycle.
  Dark mode is the sharp case: re-injecting a stylesheet that already applies
  would produce the flash of light content it exists to prevent.
- A route-scoped feature must be idempotent at its insertion point, because
  reapply may run on a route Canvas did *not* clear.

---

## A. Injected root nodes

24 stable element ids. Removing a root removes its descendants, so only roots
matter. Grouped by attachment point, because that determines whether Canvas
clears them for us.

### A1. Attached above the swap — these leak (must be torn down)

| id | Owner | Attach point |
|---|---|---|
| `darkcss` | dark mode | `documentElement` |
| `gradientcss` | gradient cards | `documentElement` |
| `ochre-aesthetics` | aesthetics | `documentElement` |
| `ochre-background` | custom background | `documentElement` |
| `ochre-sidebar-layout-fix` | better sidebar | `documentElement` |
| `crtodoaltcss` | todo alt colours | `documentElement` |
| `ochre-hide-right-sidebar-scrollbar` | better todo | `head` |
| `ochre-hide-sequence-footer` | page chrome | `head` |
| `custom_font`, `custom_font_link` | fonts | `head` |
| `ochre-reminders` | reminders | `body` |
| `ochre-todo-preview` | todo hover preview | `body` |
| `ochre-global-search-modal` | global search *(disabled)* | `body` |

All twelve are created with a `getElementById(...) || makeElement(...)`
idempotence guard, so **they do not duplicate**. The risk is not duplication
but staleness: a `<style>` scoped to the dashboard keeps applying after
navigating to a quiz page. `ochre-reminders` and `ochre-todo-preview` are
detached UI that outlives the route that created it.

### A2. Attached inside the swapped subtree — Canvas clears these

`ochre-todo-list`, `better-todo-main` and its ~30 descendants,
`ochre-cumulative-gpa`, `ochre-nasa-info-overlay`, `ochre-update-msg`,
`ochre-grade-analytics` *(disabled)*, `ochre-gs-nav-item`,
`ochre-gs-sidebar-btn`, `ochre-global-search-header-btn` *(disabled)*,
`ochre-assignment-return`, `ochre-card-*` (per-card).

These need reapply, not teardown — but every insertion point needs an
idempotence guard, or a reapply on a route Canvas *didn't* clear duplicates
them. That is what the ten-round node count will catch.

---

## B. Observers — 11, not the 8 previously reported

The earlier count was taken pre-merge and was wrong; the merge added
disconnect logic to several. Corrected:

| # | Observer | Line | Stored where | Disconnected? |
|---|---|---|---|---|
| 1 | `profileLogoutButtonObserver` | 212 | module | yes (212, 222) |
| 2 | `sequenceFooterObserver` | 334 | module | yes (322, 336, 344) |
| 3 | `submissionPageButtonObserver` | 365 | module | **never** |
| 4 | `newCanvasButtonObserver` | 384 | module | yes (378, 387) |
| 5 | `footerObserver` | 803 | **local `const`** | **never — unreachable** |
| 6 | dashboard-ready `observer` | 1635 | **local `const`** | **never — unreachable** |
| 7 | `sidebarBadgeObserver` | 4171 | module | yes (1142, 4170) |
| 8 | `iframeObserver` | 4877 | module | yes (4846) |
| 9 | global-search placement `obs` | 6008 | local | self-disconnects + 15s cap |
| 10 | `_gsPlacementObserver` | 6065 | module | yes (6045) |
| 11 | `gaObserver` | 6945 | module | yes (6930) |

**Three need work: 3, 5, 6.** Two of them (5, 6) are `const` locals with no
surviving reference, so they cannot be disconnected without being lifted to a
registry first. Both observe `document.documentElement` with `subtree: true`,
which is the most expensive shape available.

Every observer gets a registered disconnect in commit 3 regardless of current
state, so the lifecycle is uniform rather than case-by-case.

---

## C. Timers

| Timer | Line | Cleared? |
|---|---|---|
| `setInterval(reminderWatch, 60000)` | 786 | **never — not even stored** |
| `changeColorInterval` | 4705 | yes (4634, 4710) |
| `timeCheck` (auto dark) | 4837 | yes (4834) |
| grades-table poll | 6915 | yes, self-clearing |
| `setTimeout(runDarkModeFixer, 800/4500)` | startExtension | n/a — fires once, but see §E |

The reminder interval is the one genuine leak, and it is unreferenced, so it
must be captured into a variable before it can be cleared.

---

## D. Document/window listeners

| Listener | Line | Removed? |
|---|---|---|
| `window resize` (sidebar) | 5009 | no |
| `window resize` (grade analytics) | 7991 | no |
| `document keydown` (Ctrl/Cmd+K) | 6187 | yes (6047) |
| `document DOMContentLoaded` (fonts) | 5843 | n/a — never fires again after load |

The two `resize` listeners are added at module scope and are harmless
singletons today, but they must not be re-added per navigation.

---

## E. Features that assume a cold `document_start`

The flagged risk, and it is real:

1. **Dark mode.** `toggleDarkMode()` injects `darkcss` into `documentElement`
   before first paint, which is what prevents a flash of light content. On a
   soft navigation there is no new paint to beat — the style is already
   present — so dark mode must **not** be re-injected on navigation. Reapplying
   it would remove and re-add the stylesheet, producing exactly the flash it
   exists to prevent. Dark mode is route-independent: it should initialise once
   and never participate in the reapply cycle.

2. **`runDarkModeFixer` at 800ms and 4500ms.** Guessed delays measured from
   *cold load*. On a soft navigation they either fire against the wrong route
   or not at all. These are 1.5's target; 1.1 must not multiply them by
   re-scheduling on every navigation.

3. **`loadCustomFont`** branches on `document.readyState !== 'loading'` and
   otherwise waits for `DOMContentLoaded`, which never fires again. On a soft
   navigation the else-branch would hang forever. It is idempotent and
   head-attached, so like dark mode it should initialise once.

4. **`checkDashboardReady`'s signature guard** (`lastDashboardCardSignature`)
   is module state that must be invalidated on navigation, or returning to the
   dashboard will skip setup because the signature still matches the previous
   visit.

---

## F. Lossy in-place mutations on Canvas nodes

Where teardown means restoring a value, not removing a node. Mostly moot
because Canvas rebuilds these, but they matter if a reapply runs against a
subtree Canvas did *not* replace:

| Mutation | Line | Original saved? |
|---|---|---|
| card title `textContent = cardOptions.name` | 5189 | **no** |
| `link[rel=icon].href` (tab icons) | 6729 | **no** |
| `card.style.display` (hide card) | 5170 | no — but derivable |
| `header_hero.style.opacity` / `backgroundColor` | 4663, 5175 | no — but derivable |
| `header_image.style.backgroundImage` | 5182 | marked `data-ochre-card-image` |

Only the first two are genuinely lossy. The favicon one is the worse of the
two: navigating from a course to the dashboard leaves the course's colour in
the tab, because nothing restores it.

---

## G. Proposed route scoping

| Scope | Features | Cycle |
|---|---|---|
| **Once per document** | dark mode, auto dark, custom font, aesthetics CSS, custom background, reminders, message/storage listeners | init only, never reapplied |
| **Per route** | dashboard cards, card assignments, grades, GPA, notes, better todo, better sidebar, NASA overlay, quiz banner, page-chrome buttons, favicon | teardown + reapply |
| **Disabled** | global search, grade analytics | gated off; reapply hooks registered but inert |

The "once per document" column is the answer to §E: those features are exactly
the ones that assume a cold start, and none of them are route-dependent.

---

## H. Acceptance test

Dashboard → course → grades → dashboard, ten times, then count. Every id in
§A must have a count of exactly 0 or 1; no id may grow. Observers and
intervals must return to their post-init count.

Automatable against a fake DOM by driving the route change directly; the
counts are what matter, not real Canvas markup.

---

## I. Idempotence guard audit (Phase 1.1, commit 3)

Every route-scoped insertion site was checked. **All have a guard.** They use
six different shapes, which is the problem — the shapes are not equivalent and
one was unsound.

| Site | Guard shape | Sound for reapply |
|---|---|---|
| `createNasaInfoOverlay` | module-variable ref → **now** `+ isConnected` | was **no**, now yes |
| `applyCustomBackground` | reference + `isConnected` | yes |
| `ensureRightSideWrapperScrollbarHidden` | `getElementById \|\| make` | yes |
| `injectQuizSafeModeBanner` | `getElementById` early-return | yes |
| `showUpdateMsg` | `getElementById` + branch-and-return | yes |
| `insertGrades` | `querySelector \|\| make` | yes |
| `setupCardAssignments` | container count early-return | yes |
| `createTodoSections`, `setupBetterTodo`, `setupBetterSidebar` | `querySelector` check | yes |
| `ensureProfileLogoutPageButton`, `addSubmissionPageButton` | `querySelector` check | yes |
| `setupGPACalc` | dataset marker (`ochreGpaRendered`) | yes |
| `populateSidebarFromNav` | dataset marker | yes |
| `changeFavicon` | dataset marker (`ochreOriginalHref`) | yes |
| `createCardAssignment`, `loadDashboardNotes`, `ensureTodoTaskMenu` | marker class | weak — see below |

### The unsound shape

`createNasaInfoOverlay` guarded on holding a reference (`if (nasaInfoOverlayEl)
return`), not on that node being in the document. Canvas destroys the content
subtree on navigation, so the reference outlived the node and the guard would
report "already created" forever — the overlay would never come back after the
first navigation away from the dashboard. `removeNasaInfoOverlay()`, which
nulls the variable, is only called from the options-change handler, never on
navigation. Fixed by checking `isConnected`.

This is the shape that only fails once client-side navigation exists, which is
why it survived until now.

### Marker-class guards: checked, not broken

Three sites guard on a marker class. That shape fails silently if a class name
changes on one side only — which is exactly what the rebrand did to 503
identifiers. **Checked: none are broken.** Every class and id name in the file
is a string literal; there is no dynamic construction (`className = "a" + b`,
`classList.add(prefix + x)`), so the rename rewrote creation and check
together. They remain the shape most likely to break silently in future,
which is the argument for migrating them to `ensureInjected`.

### `ensureInjected`

Added as the shared, sound-by-construction helper: it looks the node up by id
and treats a **detached** node as absent, removing the leftover before
recreating. New per-route injection should use it.

**Not yet migrated:** the sites above keep their own guards for now. All were
verified sound, so migrating them is cleanup rather than a fix, and doing it
inside the routing commit would have mixed a wide mechanical change into the
commit that introduces the behaviour it would be testing. Tracked for Phase 2.
