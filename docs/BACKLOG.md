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
