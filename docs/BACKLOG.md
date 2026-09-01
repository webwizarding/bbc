# Backlog

Items deferred out of the current phase. Each says why it is deferred and what
would trigger picking it up.

## Deferred

### Bundled themes hotlink third-party CDNs

`js/themes.js` ships roughly 450 themes, one per line, each with a
`custom_cards` array of image URLs pointing at third-party hosts
(Pinterest, imgur, pusheen.com, and others). Enabling a theme causes the
browser to fetch images from those hosts.

Three separate concerns, none blocking Phase 1:

- **Privacy.** Each hotlinked host sees a request from the user's browser.
- **Reliability.** These are other people's URLs and will rot.
- **Store review.** Redistributing third-party image URLs under our own
  listing may draw questions during Chrome Web Store or AMO review.

**Trigger:** review before any store submission. Not before.

### Theme field types have drifted

Visible in the theme export attached to upstream issue #12: `cardRoundness`
and `cardSpacing` are strings (`"15"`, `"-15"`) while `cardWidth` and
`cardHeight` are numbers, and `todo_progress_rings` is `true` where current
code expects a string mode such as `"rings"`. Old exports therefore carry
values whose types no longer match what readers expect.

Relevant to the theme-validation work in Phase 3.8 and possibly to the
root cause of issue #12.

**Trigger:** Phase 1.7 (theme fields are untrusted input) and Phase 3.8.

### Version scheme

Reset to `0.1.0` at the rebrand. Upstream carried `6.4.0` in the manifest
while tagging releases `0.3.1` and `0.4.0` in commit messages — the two
never agreed. This project uses semantic versioning in `manifest.json` as
the single source of truth.

**Trigger:** document in a release process doc when one exists.

## Upstream divergence

The `upstream` remote is fetch-only (push disabled). Upstream `dev` is 19
commits ahead of the `main` we forked from and contains work worth tracking:

- **A partial client-side navigation fix.** Patches `pushState`/`replaceState`
  and `popstate`, and re-runs four page-chrome watchers. No teardown, and it
  does not reapply dashboard, to-do, sidebar, or dark-mode features. Our
  Phase 1.1 supersedes it.
- **`Link` header pagination**, implemented once for a planner fetch
  (`getAllPlannerItems`) rather than generalized into `getData`. Our Phase 1.2
  supersedes it.
- **Global Canvas search** (~530 lines) — overlaps Phase 3.9.
- **Grade analytics with a what-if calculator and heatmap** (~600 lines),
  drawn on `<canvas>` with no chart library — overlaps Phase 3.4 and 3.5.

Upstream `dev` does **not** fix: `getData` error handling, the `gradent_cards`
typo, the `setupCustomURL` domain probe, or the missing `.catch()` on any
storage write.

Whether to merge any of `dev` is an open decision. It is MIT and attribution
is already in place, so it is available to us; the cost is that it lands on
top of the pre-refactor structure.

## Inherited from the upstream dev merge

Merged at `3c5bb3d`. Both features land disabled and are Phase 3
inventory: not debugged, not refactored, bugs not fixed. Audit counts
below are what we took on, measured per function-ownership rather than
by line range.

### Global Canvas Search — 23 functions, 558 lines

| Bug class | Count |
|---|---|
| `innerHTML` assignments | 10 |
| `getData()` calls with no error path | 4 |
| `.catch()` handlers | 0 |
| stale `current_page` reads | 1 |
| `chrome.storage.sync.set` | 0 |
| MutationObservers (all disconnected) | 1 |

`GLOBAL_SEARCH_STORAGE_KEY` is declared and only ever `remove()`d,
never written — dead constant from an abandoned persistence approach.
The index is in-memory with a 10-minute TTL, so it poses no quota risk.

`onGlobalSearchShortcut` reads `window.location.pathname` directly with
a comment saying `current_page` "can be stale after Canvas' client-side
navigation" — independent corroboration of Phase 1.1 from upstream.

### Grade Analytics — 65 functions, 1,753 lines

| Bug class | Count |
|---|---|
| `innerHTML` assignments | 17 |
| `.catch()` handlers | 0 |
| `chrome.storage.sync.set` | **0** |
| `chrome.storage.local.set` | 3 |
| stale `current_page` reads | 0 |
| MutationObservers (all disconnected) | 1 |

**Storage routing is correct here.** All three writes go to `local`,
including the per-course one (`grade_analytics_final_<courseId>` via
`gaCalcStorageKey`). The other two keys, `grade_analytics_open` and
`grade_analytics_fit_y`, are small booleans. Nothing per-course reaches
`sync`, so this does not worsen Phase 1.3.

### Combined inheritance

27 new `innerHTML` sinks (Phase 1.7 total rises from 44 to 71) and 0
new `.catch()` handlers on 5 `getData()` calls.

### Defaults drift widened

The `background.js` / `popup.js` duplication that Phase 1.6 consolidates
got worse: popup-only orphaned keys went from 8 to 10 (dev added
`todo_ignore_card_colors` and `todo_remove_icons`), and value mismatches
from 3 to 4. `grade_analytics` and `global_search` are absent from
popup's `defaultOptions` entirely, so the reset button cannot re-enable
them — which is why the quarantine holds, but it is the same defect.

### --ochre-buttons is never emitted (root cause established)

`css/darkmodecss.js` uses `var(--ochre-buttons)` in three rules with no
fallback. Nothing emits it: not `OCHRE_LIGHT_DEFAULTS`, not the
`dark_preset` defaults, and no bundled theme supplies a `buttons` key.
Those three rules have never applied in the current architecture.

**It was removed, not never-defined.** `git log -S bcbuttons --all`
traces it to at least `8207ce2` (5.8.0, 2023-10-17), where dark mode
shipped as a `darkcss.json` blob containing a static `:root{...}`
declaration that did emit it, at `#262626`. When dark mode moved to
`generateDarkModeCSS()`, which builds `:root` by iterating
`dark_preset` keys, `buttons` was dropped — the presets only ever
carried background-0/1/2, borders, links, sidebar, sidebar-text, and
text-0/1/2.

Fix for Phase 1.7: emit `buttons` from both `OCHRE_LIGHT_DEFAULTS` and
the `dark_preset` defaults. The historical dark value is `#262626`; a
light value needs choosing. Decide separately whether to expose it as
an editable swatch in the dark-mode editor, which would mean adding it
to every bundled theme's export or defaulting it when absent — prefer
defaulting when absent, since themes are untrusted input anyway.

A full audit of emitted-versus-consumed variables found this is the
**only** genuine orphan. `--ochre-stop` also died in that migration but
has no remaining consumers. The four `--ochre-sidebar-{icon-size,
label-size,btn-height,btn-gap}` variables look orphaned to a static
scan but are set at runtime via `setProperty()` in
`applySidebarScaleStyles`.

Plausibly upstream of issues #7 and #11, both of which are contrast
complaints; a rule that resolves to nothing is a contrast failure by
definition.

## Phase 2 test runner requirement

Whichever runner Phase 2 adopts must fail loudly when a test body returns an
unawaited thenable. Vitest does this correctly. The hand-rolled harness in
`test/` initially did not, and an `async` test body in
`test/theme-revert.test.js` passed against unfixed code because its assertions
resolved after the try/catch had returned. The harness now rejects thenables,
but a hand-rolled harness is exactly where this class of bug lives — prefer a
real runner over extending it.

Mutation-checking every test is documented as a required step in the README's
contributing notes.

## The vm test harness must be replaced, not kept

Phase 2 adopting Vitest is a **correction for two realised failures**, not a
preference. Both were in `test/`'s hand-rolled `vm`-based harness, both
presented as ordinary results, and neither was caught by anything failing:

1. **A test that structurally could not fail.** The first round-trip test in
   `test/theme-revert.test.js` had an `async` body, so its assertions resolved
   after the harness had already recorded a pass. It passed against unfixed
   code. Caught only by mutation-checking, which came back green when it should
   have been red. The harness now rejects thenable-returning bodies.

2. **Correct values comparing as wrong.** `lifecycleCounts()` builds its result
   object inside the vm sandbox, so its prototype is that realm's
   `Object.prototype`. `assert.deepStrictEqual` rejected it despite identical
   contents, and it presented as "the counts are wrong" when the counts were
   right. Caught by reading the actual values when the diff made no sense.
   Comparisons now copy across the realm boundary.

Cross-realm identity is a standing hazard for every `vm`-loaded test here, and
it applies to more than plain objects: `instanceof`, `Array.isArray` on
sandbox arrays, and `assert.throws` matching on sandbox error types are all
affected.

**When the Phase 2 suite lands, the `vm` tests are ported to it, not kept
alongside it.** Vitest fails loudly on unawaited thenables in test bodies,
which is failure 1, and runs tests in the same realm as the code under test,
which is failure 2.

Operating rule until then: treat a surprising test result as
suspect-the-harness-first. If a failure mode does not make mechanical sense,
check the harness before checking the code.

## Standing question: who decides where a credentialed request goes?

Three instances of one bug class have now been found and fixed, all in
Phase 1, all with the same shape: **an external signal was allowed to name
the destination of a request carrying the user's Canvas session.**

| # | Where | Who named the destination | Fixed in |
|---|---|---|---|
| 1 | `setupCustomURL` domain probe | Any site the user visited, by returning a JSON array from `/api/v1/courses` | `f62a63d` |
| 2 | `domain.includes(entry)` host match | Anyone who registers `canvas.ucsc.edu.attacker.net` | `f62a63d` |
| 3 | `Link: rel="next"` following | The server, via a response header, to any origin | `59b004f` |

Each was found while working on something else, which is the point: none
presented as a security problem. #1 looked like a first-run convenience, #2
like a string comparison, #3 like the one part of the pagination problem
already solved.

**Make this a standing question for every remaining Phase 1 item: where can
this send the user's Canvas session, and who decides?**

Specifically load-bearing for:

- **1.4 host permissions.** The whole item is about which origins we attach
  to. `optional_host_permissions` plus
  `chrome.scripting.registerContentScripts()` means the user's stored custom
  domain decides where content scripts run — the same input that produced #1
  and #2. Validate it at the point it is granted, not only where it is read.
- **1.3 storage.** `custom_domain` is user-controlled data that determines
  request destinations. The migration must not widen what counts as a match.
- **3.8 theme browsing.** Fetching a theme index from
  `raw.githubusercontent.com` introduces a second remote whose content is
  parsed and applied. It must not be able to name further destinations.

### Related: inherited code that appears to solve the problem gets less scrutiny

#3 was in code merged from upstream `dev` and was on track to become the
canonical implementation precisely because it looked like the one piece of
the pagination problem already handled. Reviewing it found five defects in
eight test cases, four of them silent-truncation bugs and one the security
issue above.

Apply the same suspicion to anything else `dev` contributed that overlaps a
Phase 1 item. From the merge audit, the overlaps still unreviewed are the
`gaIf*` grade-analytics DOM mutations (which save and restore original
values, overlapping 1.1's teardown concerns) and `ensureCurrentUserId`
(which caches an API result, overlapping 1.2). Both are inside quarantined
features, so neither is urgent.

## Known smell: enumerating the cases you thought of

A recurring failure mode in this codebase. Someone writes a list or a chain of
conditions covering the cases they had in mind, and the case they did not think
of falls through silently — no error, just absent or wrong behaviour.

Instances found so far:

| Where | The enumeration | What fell through |
|---|---|---|
| `css/content.css` grades table | `td.due, td.assignment_score, td.details { white-space: normal }` | The Submitted cell, which stayed `nowrap` in a pinned column and overflowed into its neighbour |
| `css/content.css` grades table | `thead th:nth-child(1..8)` widths naming a fixed column order | Instances without the newer asset-processors column get every width from the sixth onwards on the wrong column |
| `customizeCards` | `if (img === "none") … else if (img !== "") …` | `img === ""`, so a cleared card image was never removed from the DOM |
| `importTheme` | `if (theme.custom_cards.length > 0)` | The empty array, which is what "revert to no images" looks like |
| `isTodoTaskType` (from `dev`) | `assignment`, `planner_note`, `quiz`, `discussion_topic` | Canvas also emits `wiki_page`, `calendar_event`, `assessment_request`, `sub_assignment` — unverified whether any belong |
| dev's `Link` parser | `/<([^>]+)>;\s*rel="next"/` | Space before `;`, unquoted rel, `rel="next last"`, uppercase `Rel` |

**The default response is not to audit the list for completeness.** Every one
of these was written by someone who had audited their list. The response is to
ask whether the code can be written so there is no list:

- The grades fix applies wrapping to *every* cell rather than a named set, and
  drops the positional widths entirely.
- `importTheme` writes whatever the theme says, with absence represented by the
  key being missing rather than by a length check.
- The `Link` parser was rewritten to the grammar rather than to the shapes
  Canvas currently emits.

When a conditional or list in the remaining Phase 1 work enumerates cases, ask
first whether it can be written to not enumerate. Only fall back to auditing
the list when the enumeration is genuinely irreducible — and when it is, say so
in a comment, so the next person knows it was a decision rather than an
oversight.

## Known smell: selectors that silently match nothing

Distinct from the enumeration smell, though related. A CSS selector or
`querySelector` that stops matching produces **no error and no log** — the
styling or behaviour just quietly disappears. There is no loud failure path,
so these rot undetected between the release that breaks them and the user who
notices something looks wrong.

Instances found so far:

| Where | Selector | Why it can stop matching |
|---|---|---|
| `css/darkmodecss.js` (from `c63b44a`) | `[class$="-baseButton__content"]` | Matches an emotion-generated Instructure UI class by suffix. The suffix is more stable than the hash, but it is still generated and can change on any Canvas release |
| `css/darkmodecss.js` (from `6b9653c`) | `.css-gpxu0l-view-tabs__container` fragment matching | Same, on the Global Announcements page |
| `js/content.js` `changeFavicon` | `link[rel="icon"` — **unterminated attribute selector**, missing `]` | Never matched anything. Fixed at `cff4c86`; had been silently doing nothing |
| 1.1 guard audit | Marker-class guards in `createCardAssignment`, `loadDashboardNotes`, `ensureTodoTaskMenu` | Survived the 503-identifier rebrand only because every class name is a string literal, so `sed` rewrote both sides together. A name constructed at runtime would have broken silently |
| `css/content.css` grades table (fixed) | `thead th:nth-child(6)` labelled "asset processors" | Positional, so on an instance without that column the selector matches a different column entirely — arguably worse than matching nothing |

Note the favicon one: an unterminated selector is not an exotic failure. It
parsed, it ran, it returned null on every call, and nothing anywhere said so.

### Possible cheap detection, not built

A dev-mode assertion that each of our selectors matched at least once per page
would catch most of this. Sketch:

- Collect the selectors we depend on in a table rather than inlining them.
- Behind the Phase 2 debug flag, after the route settles, run each and log the
  ones with zero matches.
- Zero matches is not always a bug — many selectors are route-specific — so it
  would need a per-selector expectation ("should match on grades pages"), which
  is itself an enumeration. Worth weighing against just accepting the risk.

A cheaper subset with no such problem: validate at load that every selector we
use is **syntactically valid**, via `document.querySelector` in a try/catch or
`CSS.supports("selector(...)")`. That would have caught the favicon bug
immediately and costs nothing at runtime. Worth doing when Phase 2 adds the
debug mode.

**Not built now.** Recorded so the decision is deliberate.
