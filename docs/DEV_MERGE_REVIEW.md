# Unreviewed inheritance from the upstream `dev` merge

The merge at `3c5bb3d` brought 19 commits from `upstream/dev`. They were
audited for *bug classes* (innerHTML sinks, storage routing, missing catches)
but not read as *changes*. Three Phase 1 bugs have since come out of them, all
found the same way — a user hit them:

| Bug | Commit | Found |
|---|---|---|
| `Link: rel="next"` regex mishandled 5/8 header shapes, one a cross-origin credential leak | `ca072f2` | While writing 1.2 |
| Deleted the issue #12 card-height fix, replacing it with a content-sized model | `3e6a592` | While resolving merge conflicts |
| Grades table Due/Submitted column collision | `9ab7d16` | User click-through |

All three shared a shape: **they looked like solved problems**, so they
attracted less scrutiny than code that obviously still needed work.

This is the list of what else came in. Nothing here is fixed; this exists so
we stop discovering it one user-visible bug at a time.

---

## CSS-touching commits (6)

| Commit | Date | What it actually changed | Risk |
|---|---|---|---|
| `933a5a5` | 08-26 | +103 lines of global-search CSS (modal, nav button, header trigger) | **Low** — all `.ochre-gs-*` scoped, and the feature is disabled |
| `6fdf813` | 08-27 | Reworked 16 of those global-search lines | **Low** — same scoping, disabled |
| `462186b` | 08-29 | +1 line each in `content.css` / `popup.css` | **Low** |
| `9ab7d16` | 08-29 | **The grades table override.** Fixed on `main` at `db52492` | **Was high** — resolved |
| `b859108` | 08-30 | Dashboard *list view*: `:has()` rules striking through completed planner items, dimming rows | **Medium** — targets Canvas' own `.planner-item` / `.PlannerItem-styles__*`, not our nodes |
| `d715feb` | 08-30 | Planner header buttons: forces `color`/`background` on `.PlannerHeader-styles__root button` and `#planner-today-btn` | **Medium** — same, plus `!important` on Canvas controls |
| `6b9653c` | 08-30 | +62 lines theming the **Global Announcements** page (`#currentTab`, `#pastTab`, `.notification_account_content`) | **Medium** — a whole Canvas page themed by hand |
| `c63b44a` | 08-30 | +104 lines dark mode, incl. `[class$="-baseButton__content"]` attribute-suffix selectors against Instructure UI internals | **Medium** — dark-gated, but see below |

### Why the dark-mode group matters for #7 and #11

Issues #7 and #11 are both contrast/visibility complaints, and #11 is
specifically about **light mode**, which the maintainer said he "made assuming
everyone has dark mode on" and fixed incorrectly. `9ab7d16` is literally titled
"light mode fixes" and has already produced one user-visible bug.

The four dark-mode commits (`b859108`, `d715feb`, `6b9653c`, `c63b44a`) add
roughly 230 lines of CSS that override Canvas' own controls with `!important`,
much of it aimed at Instructure UI components. Two structural concerns:

1. ~~They force dark-tuned colours that also apply in light mode.~~
   **Checked, and this is not the case.** `DARKMODE_CSS` is only emitted when
   `generateDarkModeCSS()` sees `dark_mode` or `device_dark` on — it returns
   early otherwise — so every rule in `darkmodecss.js` is dark-gated. The one
   commit in this group that also wrote to the unconditional `content.css`
   (`b859108`) added only `opacity` and `text-decoration`, with zero theme
   variable references, so those are colour-neutral and safe in light mode.

   Recorded because the first draft of this document asserted the opposite as
   a "worth checking" item. It was checkable in two commands, and it was
   wrong. The #11 mechanism is not present in these four commits.

2. **They depend on Instructure UI internals.** `[class$="-baseButton__content"]`
   and `.css-gpxu0l-view-tabs__container` are emotion-generated. The commit
   messages say the hashes were deliberately avoided in favour of stable
   fragments, which is the right instinct — but a suffix match on a generated
   class name is still a silent-failure selector: when it stops matching,
   nothing errors, the styling just goes away.

---

## Non-CSS commits overlapping Phase 1 or the open issues

| Commit | Overlaps | Read |
|---|---|---|
| `97b2612` "fixed return to assignment button" | **1.1 routing** | Rewrote the submission-page button to a rAF-throttled persistent observer. Reviewed during the merge (hunks 1–2) and kept. Its observer is now on the lifecycle registry. |
| `11bdfb0` "lots of stuff" | **1.6 defaults** | Among other things, **deleted the `hide_feedback` default** from `background.js`. Verified clean: 0 readers remain in `content.js`, and it is absent from `syncedSwitches`. A real removal, not an orphan. |
| `47ce60b` "more fixes" | To-do list | Extracted `applyTodoTimeframe()` out of inline filtering. Behaviour-preserving refactor as far as the diff shows. |
| `713f871` "todo list bug fixes" | To-do list | Added `isTodoTaskType()` — **an enumeration**: `assignment`, `planner_note`, `quiz`, `discussion_topic`. Canvas also emits `wiki_page`, `calendar_event`, `assessment_request`, and `sub_assignment` as planner types. If any of those should appear in the to-do list, they are silently filtered out. See the enumeration smell in BACKLOG.md. |
| `eaa2a85` "minor fixes and small features" | i18n | Reformatted all 11 locale files (509 lines each) plus 3 new keys. Mechanical. |
| `3e6a592` "more minor fixes" | **#12** | The card-height revert. Resolved at merge, pinned with a comment at `cff4c86`. Also added `imageRoundness`. |
| `ca072f2`, `67c7c2e`, `5a7c965`, `4184b71`, `462186b`, `933a5a5` | **3.4 / 3.5 / 3.9** | The two quarantined features. ~2,300 lines, disabled by default, not reviewed as changes. Deliberately out of scope until Phase 3. |

---

## Suggested order if this gets picked up

1. **`9ab7d16`'s remaining 116 lines of `content.js`.** Its CSS produced a
   user-visible bug; the JS from the same commit has not been read at all.
2. ~~Whether the four dark-mode commits' rules are dark-scoped.~~ Checked:
   they are. Removed from this list.
3. **`isTodoTaskType`'s excluded planner types.** Cheap to check, plausibly a
   real omission.
4. The quarantined features, at Phase 3.
