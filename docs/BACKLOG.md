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
