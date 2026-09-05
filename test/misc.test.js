/*
Phase 1.9: the smaller items.

  - NASA APOD used DEMO_KEY, a shared credential limited to 30 requests an hour
    across every project that ships it, so it fails most of the time.
  - Dark mode was injected from an async storage callback, so the page painted
    light first.
  - The version number disagreed between the manifest, the commit tags and the
    store listing.

Run: node test/misc.test.js
*/
import { test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import vm from "vm";
import assert from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r/g, "");
const exists = (f) => fs.existsSync(path.join(ROOT, f));

/* ---------------- NASA key ---------------- */
test("a user-supplied NASA key is read and used", () => {
    const bg = read("js/background.js");
    assert.ok(/storage\.sync\.get\("nasa_api_key"\)/.test(bg), "the key is never read");
    assert.ok(/\|\| "DEMO_KEY"/.test(bg), "there should still be a fallback when no key is set");
    assert.ok(/encodeURIComponent\(key\)/.test(bg),
        "the key is interpolated into a URL and must be encoded");
});

test("the NASA key has a default and a settings control", () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(read("js/defaults.js") + "\n;globalThis.__d = ORCA_DEFAULTS;", ctx);
    assert.strictEqual(ctx.__d.sync.nasa_api_key, "", "no default, so it reads as undefined");
    assert.ok(read("html/popup.html").includes('id="nasa_api_key"'), "no input in the popup");
    assert.ok(/setupNasaApiKey/.test(read("js/popup.js")), "the input is not wired to storage");
    const subs = /const syncedSubOptions = \[([\s\S]*?)\];/.exec(read("js/popup.js"))[1];
    assert.ok(subs.includes("nasa_api_key"), "not in syncedSubOptions, so it will not persist");
});

test("rate limiting is reported to the user, not swallowed", () => {
    const bg = read("js/background.js");
    const content = read("js/content.js");
    assert.ok(/error: "ratelimited"/.test(bg),
        "the worker should surface the rate limit rather than returning null");
    assert.ok(/result\.error === "ratelimited"/.test(content), "the content script ignores it");
    assert.ok(/api\.nasa\.gov key/.test(content),
        "the message should tell the user how to fix it, not just that it failed");
});

test("a rejected key is distinguished from being over quota", () => {
    const bg = read("js/background.js");
    // Same 403, different cause, different fix. Telling a user with their own
    // key to "add a key" would be useless advice.
    assert.ok(/"badkey"/.test(bg), "a rejected key is not distinguished");
    assert.ok(/key === "DEMO_KEY" \? "ratelimited" : "badkey"/.test(bg),
        "the distinction should depend on whether a user key was in use");
});

/* ---------------- dark mode first paint ---------------- */
test("a pre-paint dark base exists and is registered at document_start", () => {
    assert.ok(exists("css/darkbase.css"), "no pre-paint stylesheet");
    const bg = read("js/background.js");
    assert.ok(/css: \["css\/darkbase\.css"\]/.test(bg), "it is never registered");
    assert.ok(/runAt: "document_start"/.test(bg.slice(bg.indexOf("ORCA_DARK_BASE_ID"))),
        "registering it after document_start would not prevent the flash");
});

test("the dark base is removed when dark mode is off", () => {
    const bg = read("js/background.js");
    const fn = /async function syncDarkBaseStyle\(\)[\s\S]*?\n\}/.exec(bg);
    assert.ok(fn, "syncDarkBaseStyle not found");
    assert.ok(/unregisterContentScripts\(\{ ids: \[ORCA_DARK_BASE_ID\] \}\)/.test(fn[0]),
        "a light-mode user would get a dark page");
    assert.ok(/dark_mode === true \|\| device_dark === true/.test(fn[0]),
        "the system-theme option should count as dark mode too");
});

test("the dark base re-syncs when the setting changes", () => {
    const bg = read("js/background.js");
    assert.ok(/changes\.dark_mode \|\| changes\.device_dark/.test(bg),
        "toggling dark mode would not take effect until the next browser start");
});

test("the dark base never applies where the extension does not run", () => {
    const bg = read("js/background.js");
    const fn = /async function syncDarkBaseStyle\(\)[\s\S]*?\n\}/.exec(bg)[0];
    assert.ok(/instructure\.com/.test(fn), "should start from the static match set");
    assert.ok(/permissions\.contains/.test(fn),
        "a custom domain must be permission-checked before styling it");
});

/* ---------------- version ---------------- */
test("the manifest is the single source of the version", () => {
    const m = JSON.parse(read("manifest.json"));
    assert.ok(/^\d+\.\d+\.\d+$/.test(m.version), "not a semantic version");
    assert.ok(/## Versioning/.test(read("README.md")), "the scheme is not documented");
});

/* ---------------- browser namespacing ---------------- */
test("one extension namespace is used throughout", () => {
    // Mixing chrome.* and browser.* is how a Firefox-only or Chrome-only
    // failure gets introduced without anyone noticing on the other browser.
    let browserRefs = 0;
    for (const f of ["js/content.js", "js/popup.js", "js/background.js", "js/storage.js",
                     "js/defaults.js", "js/sanitize.js"]) {
        browserRefs += (read(f).match(/(?:^|[^.\w])browser\.\w/g) || []).length;
    }
    assert.strictEqual(browserRefs, 0,
        "browser.* appears alongside chrome.*; Firefox supports chrome.* with " +
        "promises in MV3, so one namespace is enough");
});

test("both browsers have a background entry point", () => {
    const m = JSON.parse(read("manifest.json"));
    assert.ok(m.background.service_worker, "Chrome MV3 needs service_worker");
    assert.ok(Array.isArray(m.background.scripts) && m.background.scripts.length,
        "Firefox MV3 needs background.scripts");
    // Chrome ignores background.scripts, so anything the worker needs from
    // there has to be imported explicitly.
    assert.ok(/importScripts\("\/js\/defaults\.js"\)/.test(read("js/background.js")),
        "defaults.js is in background.scripts but Chrome would never load it");
});
