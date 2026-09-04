# Ochre for Canvas

A browser extension that improves the [Instructure Canvas](https://www.instructure.com/canvas)
interface: dark mode, themes, dashboard card customization, an improved to-do
list, a GPA calculator, and dashboard notes.

Everything runs locally. There is no backend, no account, and no telemetry.
See [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

> **Status: pre-release (0.1.0).** Not yet published to any extension store.
> Install from source using the steps below.

## Attribution and independence

This is an independent project. It is a fork of
[Canvas Refined](https://github.com/GuySandler/CanvasRefined) by Guy Sandler
(MIT), which is itself a fork of the MIT-licensed release of
[BetterCanvas](https://github.com/UseBetterCanvas/bettercanvas) by ksucpea.
The fork point is Canvas Refined `main` at commit `e1fdfcd`.

It is **not affiliated with, endorsed by, or supported by** Canvas Refined,
BetterCanvas, BetterCampus, or Instructure. "Canvas" is a trademark of
Instructure, Inc., used here only to describe what this extension works with.

Please do not report issues with this extension to any of those projects.

### Credits

The great majority of the original work is theirs, not mine:

- **[ksucpea](https://github.com/ksucpea)** — original author of BetterCanvas
- **[Guy Sandler](https://github.com/guysandler)** — Canvas Refined, and most
  of the features this fork inherits
- Original contributors: [fudgeu](https://github.com/fudgeu),
  [Tibo Geeraerts](https://github.com/tibogeeraerts),
  [Jacob Mungle](https://github.com/Jelgnum),
  [FireIsGood](https://github.com/FireIsGood)

## Features

Inherited from Canvas Refined:

- Fully customizable dark mode, with scheduling and a system-theme option
- Dashboard card colour palettes, gradients, and advanced card styling
  (image size, roundness, spacing, width, height)
- Custom backgrounds, including presets, your own URL, and daily rotation
- Improved to-do list with progress rings, hover previews, and custom tasks
- Improved sidebar
- Dashboard grades and an assignments-due list
- GPA calculator with presets, weighting, and cumulative GPA
- Dashboard notes with Markdown
- Custom fonts, condensed cards, tab icons
- Quiz safe mode
- Browser-wide assignment reminders
- Themes

Changes made in this fork so far are listed in the commit history; this
section will be updated as the roadmap below lands.

## Roadmap

Work is sequenced in three phases. Detail lives in
[docs/CONTENT_JS_MAP.md](docs/CONTENT_JS_MAP.md) and
[docs/BACKLOG.md](docs/BACKLOG.md).

1. **Correctness.** Client-side navigation handling, a real API layer with
   pagination and error typing, storage quota routing, narrowed host
   permissions, observer lifecycle, and accessibility fixes.
2. **Architecture.** Splitting `js/content.js` into modules, a build step,
   tests, lint, and CI.
3. **Features.** A full-page planner view, recurring tasks and subtasks,
   calendar export, what-if grades, grade history, per-course notes,
   flashcards with spaced repetition, and theme browsing.

## Versioning

`manifest.json` is the single source of truth for the version, and it follows
semantic versioning. Upstream carried `6.4.0` in the manifest while tagging
releases `0.3.1` and `0.4.0` in commit messages; the two never agreed, and the
store listing disagreed with both. This fork reset to `0.1.0` at the rebrand
and has one number.

## Install from source

- Clone this repository.
- Chrome or another Chromium browser: open `chrome://extensions`, enable
  **Developer mode**, click **Load unpacked**, and select the repository root.
- Firefox: open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on**, and select `manifest.json`.

Then open your institution's Canvas site and click the extension icon to
configure it.

### Running tests

```
node test/run.js
```

Dependency-free for now; a real runner arrives with Phase 2.

### Regenerating icons

```
python3 tools/make-icons.py
```

Uses only the Python standard library.

## Contributing

### Adding a new option

Every user-facing option is a key in `chrome.storage`. Wiring one up touches
five places. The list below describes what the code actually does as of
`0.1.0` — verify against the source before relying on it.

#### 1. Choose an identifier

A unique `snake_case` key, e.g. `dark_mode`, `dashboard_grades`. Sub-options
(settings that only matter when a parent feature is on) each need their own
key too.

Note the storage limits: `chrome.storage.sync` allows 8,192 bytes per item and
102,400 bytes in total. Anything that grows with usage belongs in
`chrome.storage.local` instead.

#### 2. `html/popup.html`

Add the control. The element `id` and the input `name` are both the
identifier. A plain toggle goes in the same container as the other plain
toggles:

```html
<div class="option" id="<identifier>">
    <input type="radio" id="off" name="<identifier>">
    <input type="radio" id="on" name="<identifier>">
    <div class="slider">
        <div class="sliderknob"></div>
        <div class="sliderbg"></div>
    </div>
    <span class="option-name" data-i18n="<message_key>">Label</span>
</div>
```

A toggle that owns sub-options becomes its own container:

```html
<div class="option-container">
  <div class="option" id="<identifier>">
    ... same as above ...
  </div>
  <div class="sub-options">
    <div class="sub-option">
      <input type="checkbox" id="<sub identifier>" name="<sub identifier>">
      <label for="<sub identifier>" class="sub-text"
             data-i18n="<message_key>">Label</label>
    </div>
  </div>
</div>
```

Add the `data-i18n` message key to `_locales/en/messages.json`. The other ten
locales fall back to the inline text when a key is missing, so translations
can follow later.

#### 3. `js/popup.js`

- A main toggle goes in the `syncedSwitches` array at the top of the file.
- **Every** sub-option goes in `syncedSubOptions`, whatever control renders
  it — checkbox, slider, select, or time input.
- A sub-option rendered as a **checkbox** additionally goes in
  `menu.checkboxes`, inside `setup()`. That array wires up checkbox UI only;
  sliders and selects are handled elsewhere and must not be added to it.
- If the option should travel with an exported theme, add it to the relevant
  `export*` array (`exportLayout`, `exportTodo`, `exportGpa`,
  `exportBackground`, and so on).

Missing `syncedSubOptions` is the usual cause of a control that renders
correctly but does not persist.

#### 4. `js/background.js`

Add a default to `default_options.sync`, or to `default_options.local` for
anything bulky or per-course. `onInstalled` seeds only keys that are not
already present, so an option with no default here is simply `undefined` for
every user until they touch the control.

> There is no `syncedOptions` array. Earlier revisions of this document
> instructed contributors to add one; it has never existed in the code.

> **Known defect.** `js/popup.js` carries a second, separate `defaultOptions`
> object that backs the "reset storage" button and the popup's display
> fallbacks. It has drifted from `background.js`: the two disagree on three
> values and each defines keys the other lacks. Until that is consolidated,
> a new option needs a default in **both** places.

#### Fixing a bug

Every bug fix lands with a test, and **every test is mutation-checked before it
is committed**. This is a required step, not a matter of judgement:

1. Write the test against the fixed code and watch it pass.
2. Revert the fix.
3. Confirm the test now **fails**, and fails for the reason you expect.
4. Restore the fix and confirm it passes again.

A test that has never been observed failing has not been shown to test
anything. Three real incidents in this repository, none caught by anything
failing:

- A test body written `async`, so its assertions resolved after the harness
  had already recorded a pass. It passed against unfixed code.
- Correct values comparing as unequal across a `vm` realm boundary, which
  presented as "the counts are wrong" when the counts were right.
- A code comment that overclaimed what a branch did, and a test written to
  match the comment rather than the code — so it asserted something the code
  never did.

**The first two are harness defects and a real test runner fixes them. The
third is not, and no tooling change catches it.** A test written against a
mistaken belief about the code will pass, look reasonable, and cover nothing.
Only reverting the code and watching the test fail distinguishes that from a
real test. So mutation-checking stays a required step after the harness is
replaced; it is not `vm`-era ceremony.

**A mutation that does not fail is information, not a nuisance.** It means
either the code you reverted is dead, or the test is hollow. Both are worth
knowing, and both are worth chasing down before moving on rather than
adjusting the mutation until it goes red.

#### 5. `js/content.js`

Write the function that does the work; name it for what it does. Then:

- Add a `case` for the identifier in `applyOptionsChanges()` so toggling the
  control takes effect without a reload.
- Decide when it fires:
  - Changes anything on the dashboard — call it from `checkDashboardReady()`.
  - Pure CSS — fold it into the existing styles in `applyAestheticChanges()`
    rather than adding a function.
  - Anything else — call it from `startExtension()`, no earlier than the
    `checkDashboardReady()` call already there.

Read values from the module-level `options` object, which mirrors
`chrome.storage.sync`.

## License

MIT. See [LICENSE-MIT](LICENSE-MIT).

Copyright (c) 2024 ksucpea
Copyright (c) 2026 Guy Sandler
Copyright (c) 2026 webwizarding
