# `js/content.js` — structural map

5,662 lines, 168 top-level functions, 1 top-level statement (`isDomainCanvasPage()` at
line 536). Everything shares one module scope. No exports, no IIFE, no namespacing.

This document is Phase 0 output: the seams for the Phase 2 split. Line ranges are
inclusive and were derived from the top-level `function` declarations.

---

## Regions

| # | Region | Lines | ~LOC | Functions | Proposed module |
|---|--------|-------|------|-----------|-----------------|
| 1 | Route predicates | 1–57 | 57 | `getCurrentCourseId`, `getSidebarLayoutMode`, `isGradesPage`, `isCoursesIndexPage`, `isGroupsIndexPage`, `isConversationsPage`, `isAccountsPage`, `isProfilePage`, `isQuizPage`, `isQuizTakePage`, `isQuizPreTakePage`, `quizSafeModeActive` | `routing.js` |
| 2 | Page-chrome injectors | 58–226 | 169 | `getSubmissionAssignmentLink`, `addSubmissionPageButton`, `addProfileLogoutPageButton`, `ensureProfileLogoutPageButton`, `watchProfileLogoutPageButton`, `ensureSubmissionPageButton`, `isAssignmentPage`, `removeSequenceFooter`, `watchSequenceFooter`, `watchSubmissionPageButton`, `removeNewCanvasButton`, `watchNewCanvasButton` | `page-chrome.js` |
| 3 | Backgrounds | 227–380 | 154 | `getActiveCustomBackground`, `getDailyBackgroundPreset`, `getNasaDailyBackground`, `isDashboardPage`, `createNasaInfoOverlay`, `removeNasaInfoOverlay` | `backgrounds.js` |
| 4 | Sidebar expand state | 381–398 | 18 | `getSidebarStateMode`, `getSidebarStateKey`, `getSidebarExpandedState`, `setSidebarExpandedState` | `sidebar.js` |
| 5 | **Global state decls** | 399–432 | 34 | — (17 `let`/`const`) | `state.js` |
| 6 | Reminders | 433–537 | 105 | `insertReminders`, `hideReminder`, `createReminder`, `reminderWatch`, `updateReminders`, `showExampleReminder` | `reminders.js` |
| 7 | **Bootstrap** | 536–625 | 90 | `isDomainCanvasPage`, `startExtension` | `main.js` |
| 8 | **Options dispatch** | 626–842 | 217 | `applyOptionsChanges` (one switch, ~80 cases) | `options-dispatch.js` |
| 9 | Sidebar layout + bg apply | 843–1200 | 358 | `resetBetterSidebarLayout`, `ensureBetterSidebar`, `applyCustomBackground`, `applyBetterSidebarLayoutFix`, `clearBetterSidebarLayoutFix` | `sidebar.js` / `backgrounds.js` |
| 10 | Dashboard-ready observer | 1201–1300 | 100 | `resetTimer`, `checkDashboardReady` | `lifecycle.js` |
| 11 | Messaging + color utils | 1301–1461 | 161 | `recieveMessage`, `hexToRgb`, `inspectDarkMode`, `getCardColors`, `getCardsFromDashboard` | `messaging.js` + `color.js` |
| 12 | Card fetch | 1462–1542 | 81 | `getCards`, `convertToDueDate` | `cards.js` |
| 13 | Todo: progress rings | 1543–2100 | 558 | `updateIndicator`, `progressFilterDim`, `attachProgressFilterClick`, `formatDateForInput`, `formatTimeForInput`, `getProgressRingMode`, `progressRingsEnabled`, `courseRingColor`, `courseRingLabel`, `renderProgressRingsMode`, `renderProgressRainbow`, `renderProgressLines`, `renderProgressOneLine`, `renderProgressRings` | `todo/rings.js` |
| 14 | Planner-note API + task links | 2101–2367 | 267 | `buildPlannerNotePayload`, `createCanvasPlannerNote`, `getCustomTaskLinks`, `getCustomTaskLinkId`, `normalizeTaskLink`, `customTaskHref`, `saveCustomTaskLink`, `deleteCustomTaskLink`, `updateCanvasPlannerNote`, `deleteCanvasPlannerNote`, `scrollTodoIntoView` | `api/planner-notes.js` |
| 15 | Todo task form | 2368–2612 | 245 | `fillTaskCourseOptions`, `updateTaskCourseSelectColor`, `ensureTodoTaskMenu`, `resetTaskFormToCreate`, `openTaskForEdit` | `todo/task-form.js` |
| 16 | Todo section render | 2613–2870 | 258 | `createTodoSections`, `ensureRightSideWrapperScrollbarHidden`, `clearTodoList` | `todo/render.js` |
| 17 | Todo colors + hover preview | 2871–3005 | 135 | `applyTodoAlternateColors`, `stripHtmlPreview`, `getTodoPreviewEl`, `positionTodoPreview`, `getTodoPreviewText`, `hideTodoPreview`, `showTodoPreview`, `attachTodoHoverPreview` | `todo/preview.js` |
| 18 | Todo populate | 3006–3451 | 446 | `populateAssignments`, `populateAnnouncements`, `createConfettiBurst`, `markAs`, `createTodoViewMore`, `setupBetterTodo` | `todo/populate.js` |
| 19 | Better sidebar | 3452–3826 | 375 | `getSidebarScale`, `applySidebarScaleStyles`, `applyBetterSidebarContentPanel`, `setupBetterSidebar`, `createSidebarButton`, `getNavBadgeCount`, `addSidebarButtonBadge`, `syncSidebarBadges`, `scheduleSidebarBadgeSync`, `watchSidebarBadges`, `populateSidebarFromNav`, `updateSidebar` | `sidebar.js` |
| 20 | Todo loader | 3827–4065 | 239 | `loadBetterTodo` | `todo/load.js` |
| 21 | Dark mode | 4066–4305 | 240 | `changeColorPreset`, `generateDarkModeCSS`, `toggleDarkMode`, `runDarkModeFixer`, `autoDarkModeCheck`, `toggleAutoDarkMode`, `runiframeChecker` | `dark-mode.js` |
| 22 | Dashboard cards | 4306–4625 | 320 | `insertGrades`, `createCardAssignment`, `equalizeCardHeights`, `preloadAssignmentEls`, `loadCardAssignments`, `setupCardAssignments`, `getCardId`, `customizeCards`, `getCustomLinkImage` | `cards.js` |
| 23 | GPA | 4626–4872 | 247 | `calculateGPA2`, `changeGPASettings`, `createGPACalcCourse`, `setupGPACalc` | `gpa.js` |
| 24 | Dashboard notes | 4873–5188 | 316 | `delayDashboardNotesStorage`, `crRenderMarkdownFallback`, `renderDashboardNotesPreview`, `notesApplyFormat`, `toggleDashboardNoteTask`, `wireDashboardNotes`, `loadDashboardNotes` | `notes.js` |
| 25 | Fonts + aesthetics | 5189–5295 | 107 | `loadCustomFont`, `debouncedApplyAestheticChanges`, `applyAestheticChanges` | `theming.js` |
| 26 | Quiz safe mode | 5296–5373 | 78 | `setupQuizSafeModeBanner`, `injectQuizSafeModeBanner` | `quiz-safe-mode.js` |
| 27 | Gradient cards + update msg | 5374–5441 | 68 | `changeGradientCards`, `showUpdateMsg`, `readUpdate` | `cards.js` / `updates.js` |
| 28 | Assignment merge | 5442–5474 | 33 | `combineAssignments`, `cleanCustomAssignments` | `assignments.js` |
| 29 | **API layer** | 5475–5553 | 79 | `setupCustomURL`, `getGrades`, `getColors`, `changeFavicon`, `getAssignments`, `getApiData` | `api/canvas.js` |
| 30 | Utilities | 5540–5662 | 123 | `makeElement`, `getData`, `rgbToHex`, `rgbToHsl`, `getRelativeDate`, `formatTodoDate`, `formatCardDue`, `logError`, `CSRFtoken` | `util/*.js` |

Only three regions exceed the ~600-line target: none, actually — the largest single
region is #13 (558). The split is therefore natural. The `todo/*` group totals ~1,880
lines across 6 modules, which is the one cluster needing internal discipline.

---

## Shared mutable state

Declared at lines 399–432 and 1201, 1575–1584, 2871–2892, 3823–3826, 4064–4065, 4196,
4262, 4368–4372, 4872. Twelve of these are genuinely cross-region:

| Global | Line | Type | Written by | Read by | Notes |
|--------|------|------|-----------|---------|-------|
| `options` | 404 | object | `isDomainCanvasPage`, `startExtension`, `applyOptionsChanges`, `saveCustomTaskLink`, `deleteCustomTaskLink` | **60 functions** | The god object. Mirror of `chrome.storage.sync`, refreshed by merge (`{...options, ...result}`) in 3 places and mutated in-place by the storage-change listener. |
| `assignments` | 399 | **Promise** | `getAssignments`, `populateAssignments` | 14 | Holds an unresolved promise, not data. 7 consumers call `.then()` on it. **Zero have `.catch()`.** |
| `grades` | 400 | **Promise** | `getGrades` | 5 | Same pattern. |
| `cardAssignments` | 4368 | Promise | `getAssignments`, `applyOptionsChanges` | 2 | Set from `preloadAssignmentEls()`. |
| `announcements` | 401 | array | `createTodoSections` | 3 | |
| `completed` | 402 | array | `renderProgressRings`, `createTodoSections` | 6 | |
| `assignmentsDue` | 403 | array | `createTodoSections` | 1 | |
| `domContainers` | 1584 | object | `createTodoSections`, `updateIndicator` | 2 | Cache of todo DOM nodes; stale after teardown. |
| `filter` | 3826 | string | `populateAnnouncements`, `updateSidebar` | 7 | Todo tab selection. |
| `betterTodoTimeframe` | 1575 | string | `createTodoSections`, `updateIndicator` | 1 | |
| `betterTodoProgressFilter` | 1583 | any | `createTodoSections`, `updateIndicator`, `attachProgressFilterClick`, `renderProgressOneLine` | 3 | |
| `lastDashboardCardSignature` | 417 | string | `checkDashboardReady` | 1 | The reflow-loop guard. |

Plus 6 observer handles that are assigned but **never disconnected**:
`submissionPageButtonObserver` (64), `profileLogoutButtonObserver` (65),
`newCanvasButtonObserver` (66), `sidebarBadgeObserver` (418), `iframeObserver` (4262),
and the anonymous `footerObserver` created inside `startExtension` (line ~578).

### Ownership proposal

`state.js` exports a single store with explicit setters. `options` becomes read-only to
consumers, with one writer (`options-dispatch.js`). `assignments`/`grades`/`cardAssignments`
stop being promise-typed globals and move behind `api/canvas.js`'s response cache, which
gives callers a real error path instead of an unhandled rejection.

---

## Seams and coupling notes

**Clean seams** (few or no inbound references, safe to lift first):
- Region 3 backgrounds, region 6 reminders, region 23 GPA, region 26 quiz safe mode,
  region 30 utilities. These are the low-risk opening moves for Phase 2.

**Hard seams**:
- Region 8 `applyOptionsChanges` is a single ~217-line switch that calls into *every*
  other region. It is the dependency hub. It should become a registry that regions
  subscribe to, rather than a switch that imports everything.
- Region 7 `startExtension` calls 17 initializers in a fixed order with no teardown.
  This is where the Phase 1.1 lifecycle work lands.
- The `todo/*` cluster (regions 13–18, 20) shares `domContainers`, `filter`,
  `completed`, `announcements`, `assignmentsDue`, `betterTodoTimeframe`, and
  `betterTodoProgressFilter`. Split it last, and split it as a unit with its own
  internal state object.

**Cross-cutting concerns that are not regions** and must be extracted before the split:
- `current_page` (20 references, all stale — Phase 1.1).
- `getData` (region 30) is called by regions 12, 14, 22, 29 — Phase 1.2.
- `chrome.storage.sync.set` appears 17 times in this file, none with `.catch()` — Phase 1.3.
- `innerHTML` appears 35 times in this file — Phase 1.7.

---

## Observer inventory

Seven independent `MutationObserver`s, none with a coordinated lifecycle:

| Observer | Created in | Target | Disconnected? |
|----------|-----------|--------|---------------|
| footer | `startExtension` (~578) | `document.documentElement`, subtree | **No** |
| new-canvas button | `watchNewCanvasButton` (195) | varies | **No** |
| sequence footer | `watchSequenceFooter` (149) | varies | **No** |
| submission button | `watchSubmissionPageButton` (170) | varies | **No** |
| profile logout button | `watchProfileLogoutPageButton` (106) | varies | **No** |
| sidebar badges | `watchSidebarBadges` (3657) | varies | **No** |
| dashboard ready | `checkDashboardReady` (1214) | varies | **No** |
| iframe checker | `runiframeChecker` (4263) | varies | **No** |

All observe on a long-lived target and run for the life of the page. Phase 1.5 replaces
these with one coordinated observer plus an explicit lifecycle registry.
