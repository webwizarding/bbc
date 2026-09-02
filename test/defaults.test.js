/*
Phase 1.6: one source of truth for default option values.

There were two -- default_options in background.js, which seeds storage on
install, and defaultOptions in popup.js, which backed the "reset storage"
button and the popup's display fallbacks. They had drifted, so resetting
produced a different profile from a fresh install, and 10 user-facing options
had no install-time default at all.

Run: node test/defaults.test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r/g, "");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") throw new Error("test body must be synchronous");
        console.log(`  PASS  ${name}`);
    } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

function loadDefaults() {
    const ctx = {};
    vm.createContext(ctx);
    // `const` at the top level of a vm script is script-scoped and never
    // appears on the context object, so read the binding back explicitly.
    vm.runInContext(read("js/defaults.js") + "\n;globalThis.__d = OCHRE_DEFAULTS;", ctx);
    return ctx.__d;
}

console.log("\ndefaults\n");

test("there is exactly one defaults object", () => {
    const d = loadDefaults();
    assert.ok(d && d.sync && d.local, "OCHRE_DEFAULTS must expose sync and local");
    for (const [file, marker] of [["js/background.js", "let default_options = {"],
                                  ["js/popup.js", "const defaultOptions = {"]]) {
        assert.ok(!strip(read(file)).includes(marker),
            `${file} still declares its own defaults object`);
    }
});

test("both consumers reference the shared object", () => {
    assert.ok(/let default_options = OCHRE_DEFAULTS;/.test(strip(read("js/background.js"))));
    assert.ok(/const defaultOptions = OCHRE_DEFAULTS;/.test(strip(read("js/popup.js"))));
});

test("reset and fresh install now produce the same profile", () => {
    // The whole point: these were different objects, so the reset button wrote
    // 3 values that disagreed with install and omitted 13 keys entirely.
    const d = loadDefaults();
    assert.ok(Object.keys(d.sync).length > 90, "sanity: sync defaults should be substantial");
});

test("the gradent_cards typo is gone and the real key has a default", () => {
    // background.js is excluded: its migration has to name the typo in order
    // to carry the value across and delete the key.
    for (const f of ["js/defaults.js", "js/popup.js", "js/content.js"]) {
        assert.ok(!read(f).includes("gradent_cards"), `${f} still references the typo`);
    }
    const d = loadDefaults();
    assert.ok("gradient_cards" in d.sync,
        "gradient_cards is what every reader uses and it must have a default");
});

test("a value stored under the typo is migrated, then removed", () => {
    const bg = strip(read("js/background.js"));
    assert.ok(/sync\["gradent_cards"\] !== undefined/.test(bg), "no migration for the typo");
    assert.ok(/newSyncOptions\["gradient_cards"\] = sync\["gradent_cards"\]/.test(bg),
        "the value must be carried across, not just deleted");
    assert.ok(/remove\("gradent_cards"\)/.test(bg), "the orphaned key should not linger");
});

test("every option the popup can toggle has a default", () => {
    // A switch with no default reads as undefined until the user touches it,
    // which is the bug gradent_cards caused for gradient_cards.
    const pop = strip(read("js/popup.js"));
    const d = loadDefaults();
    const all = { ...d.sync, ...d.local };
    const names = (re) => {
        const m = re.exec(pop);
        return m ? (m[1].match(/["']([a-zA-Z_0-9]+)["']/g) || []).map(x => x.slice(1, -1)) : [];
    };
    const switches = names(/const syncedSwitches = \[([\s\S]*?)\];/);
    const subs = names(/const syncedSubOptions = \[([\s\S]*?)\];/);
    assert.ok(switches.length > 10 && subs.length > 10, "sanity: option lists should be populated");
    const missing = [...switches, ...subs].filter(k => !(k in all));
    assert.deepStrictEqual(missing, [],
        `these are user-togglable but have no default, so they read as undefined: ${missing.join(", ")}`);
});

test("the ten previously-orphaned options are seeded", () => {
    const d = loadDefaults();
    const wasOrphaned = ["cardPadding", "card_blur", "card_opacity", "card_transparency",
        "center_cards", "sidebar_scale", "todo_alternate_colors", "todo_ignore_card_colors",
        "todo_remove_icons", "todo_timeframe"];
    const missing = wasOrphaned.filter(k => !(k in d.sync) && !(k in d.local));
    assert.deepStrictEqual(missing, [],
        `defined only in popup.js before, so never seeded at install: ${missing.join(", ")}`);
});

test("install-time values won the three conflicts", () => {
    const d = loadDefaults();
    // background.js seeded true for these; popup.js's copy said false.
    for (const k of ["gpa_calc", "dashboard_grades", "todo_full_height"]) {
        assert.strictEqual(d.sync[k], true,
            `${k} should keep the install-time value, which is what users are running`);
    }
});

test("quarantined features stay off", () => {
    const d = loadDefaults();
    for (const k of ["global_search", "grade_analytics", "card_letter"]) {
        assert.strictEqual(d.sync[k], false, `${k} must stay disabled`);
    }
});

test("all three contexts load the defaults file", () => {
    const m = JSON.parse(read("manifest.json"));
    assert.ok(m.content_scripts[0].js.includes("js/defaults.js"), "not a content script");
    assert.ok(m.background.scripts.includes("js/defaults.js"), "not in background.scripts (Firefox)");
    assert.ok(/importScripts\("\/js\/defaults\.js"\)/.test(read("js/background.js")),
        "the Chrome service worker ignores background.scripts and needs importScripts");
    assert.ok(read("html/popup.html").includes("js/defaults.js"), "not loaded by the popup");
    // Load order matters: defaults must precede its consumers.
    const cs = m.content_scripts[0].js;
    assert.ok(cs.indexOf("js/defaults.js") < cs.indexOf("js/content.js"), "defaults must load first");
    const html = read("html/popup.html");
    assert.ok(html.indexOf("js/defaults.js") < html.indexOf("js/popup.js"), "defaults must load first");
});

console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
