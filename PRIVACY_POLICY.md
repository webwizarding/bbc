# Privacy Policy

**Extension:** Orca for Canvas
**Last updated:** September 1, 2026

## Summary

Orca for Canvas has no backend. There are no servers, no accounts, no
analytics, and no telemetry. Everything the extension stores stays in your
browser's own extension storage on your device.

This is a design constraint, not a current-state description. The extension is
built so that it cannot phone home.

## What is stored, and where

All storage uses the browser's `chrome.storage` API. Nothing is written
anywhere else.

**Your preferences** — dark mode colours and themes, dashboard layout
options, feature toggles, custom fonts, GPA grade boundaries, and similar
settings.

**Your own content** — dashboard notes you type, custom tasks you create, and
reminders you set.

**Cached Canvas data** — course names, colours, assignment titles and due
dates, announcements, and grades, kept so the interface can render without
refetching on every page load.

Two storage areas are used. `chrome.storage.local` never leaves your device.
`chrome.storage.sync` is replicated by your browser across profiles where you
have signed in and enabled browser sync — that replication is performed by
your browser vendor (Google or Mozilla) under their privacy policy, not by
this extension.

## What is never collected

- No name, email address, student ID, or other identifying information.
- No browsing history or activity on any site.
- No usage analytics, event tracking, crash reporting, or metrics.
- Nothing is transmitted to the developer or to any third party.

## Network activity

The extension makes network requests only in these cases, all of them from
your browser directly:

1. **Your Canvas instance.** Standard Canvas REST API calls, using your
   existing Canvas session, for data you already have access to. Same-origin
   with the page you are on.
2. **Google Fonts** (`fonts.googleapis.com`), only if you enable a custom
   font, and only to fetch that font file.
3. **NASA's public APOD API** (`api.nasa.gov`), only if you turn on the
   NASA daily background.
4. **Image URLs you supply**, if you set a custom background or custom card
   image. Your browser fetches those from wherever you pointed it.

Items 2 through 4 are off by default and are each controlled by a setting you
choose to enable. Nothing about you is sent in these requests beyond what any
ordinary browser request for a file includes.

## Permissions

- **`storage`** — to save your settings and content on your device.
- **Content scripts on Canvas pages** — to read and modify the Canvas
  interface, which is the entire function of the extension.
- **Background service worker** — to apply defaults on install and to run
  scheduled work such as reminders.

## Your control

- Every setting is visible and editable in the extension popup.
- Settings can be exported, imported, and reset from the popup.
- Uninstalling removes all extension storage.
- Your Canvas records belong to your institution and are unaffected by
  installing or removing this extension.

## Third parties

None. No analytics SDK, no error-reporting service, no advertising, no
bundled API keys, and no remotely hosted code.

## Changes

Material changes to this policy will be noted in the repository's release
notes and in this file's "Last updated" date.

## Contact

Open an issue on the project's GitHub repository.

<!-- TODO: add contact address and repository URL once the origin remote is set. -->
