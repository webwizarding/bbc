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

## Install from source

- Clone this repository.
- Chrome or another Chromium browser: open `chrome://extensions`, enable
  **Developer mode**, click **Load unpacked**, and select the repository root.
- Firefox: open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on**, and select `manifest.json`.

Then open your institution's Canvas site and click the extension icon to
configure it.

### Regenerating icons

```
python3 tools/make-icons.py
```

Uses only the Python standard library.

## Contributing

### Add a new feature

To add a new feature, please follow these guidelines.

#### Identifier

- Should be a unqiue one/two word storage identifier to indicate its status. (ie "dark_mode" or "dashboard_grades")
- If it has sub options (options that are specific to the main feature) these will also each need a unique identifier.
- All options are synced and have a 8kb storage limit, so if your feature needs more than this please contact me.

#### Changes to html/popup.html

- Add the appropriate HTML into this file. The corresponding id and name (see below) should be the identifier.
- If it has no sub options, it should be put in the same container as the other options with no sub options:

```
<div class="option" id="<identifier>">
    <input type="radio" id="off" name="<identifier>">
    <input type="radio" id="on" name="<identifier>">
    <div class="slider">
        <div class="sliderknob"></div>
        <div class="sliderbg"></div>
    </div>
    <span class="option-name"><option name></span>
</div>
```

- If it does have sub options it becomes it's own container:

```
<div class="option-container">
  <div class="option" id="<identifier>">
    <input type="radio" id="off" name="<identifier>">
    <input type="radio" id="on" name="<identifier>">
    <div class="slider">
      <div class="sliderknob"></div>
      <div class="sliderbg"></div>
    </div>
    <span class="option-name"><option name></span>
  </div>
  <div class="sub-options">
    <div class="sub-option">
      <input type="checkbox" id="<sub identifier>" name="<sub identifier>">
      <label for="<sub identifier>" class="sub-text"><option name></label>
    </div>
  </div>
</div>
```

#### Changes to js/popup.js

- Add the main identifier into the `syncedSwitches` array.
- If you have sub-options:
  - Add these identifiers to the array found under the comment that says `//checkboxes`.

#### Changes to js/background.js

- Add all identifiers into the `syncedOptions` array.
- Add a default value for your option to the `default_options` array.
  - Preferably this value should be `false` for booleans or ` ""` for strings (`null` can also be used if Canvas has a default for this option already)

#### Changes to js/content.js

- There should be a function(s) included in the this file that does the work. The name should clearly indicate it's purpose.
- Under `applyOptionsChanges()`, add a switch case to call this function when the menu toggle is changed.
- Depending on what your feature does, it needs to be told when to fire.
  - If the function changes any aspect of the dashboard, it should be put inside `checkDashboardReady()`.
  - If the function only adds css, it should be added to `applyAestheticChanges()`, and in this case should not be a separate function, instead add the css to the existing styles found in this function.
  - Anything else should be put under `startExtension()` and should be placed no higher than the `checkDashboardReady` function found here.

## License

MIT. See [LICENSE-MIT](LICENSE-MIT).

Copyright (c) 2024 ksucpea
Copyright (c) 2026 Guy Sandler
Copyright (c) 2026 webwizarding
