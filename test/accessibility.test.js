/*
Phase 1.8: accessibility.

Covers the measurable parts of open issues #7 and #11, both of which are
contrast and visibility reports, plus keyboard reachability of injected
controls.

Contrast is computed, not eyeballed: the WCAG relative-luminance formula
against the AA threshold of 4.5:1 for normal text.

Run: node test/accessibility.test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r/g, "");

let failures = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") throw new Error("test body must be synchronous");
        console.log(`  PASS  ${name}`);
    } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

/* ---------------- WCAG contrast ---------------- */
function channel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(hex) {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.split("").map(x => x + x).join("") : h.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

test("the contrast helper matches known reference values", () => {
    // Guard against a broken formula silently passing everything.
    assert.strictEqual(Math.round(contrast("#000000", "#ffffff")), 21);
    assert.strictEqual(Math.round(contrast("#ffffff", "#ffffff")), 1);
    assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.05,
        "#767676 on white is the canonical 4.5:1 boundary case");
});

function lightPreset() {
    const src = read("js/content.js");
    const m = /const OCHRE_LIGHT_DEFAULTS = \{[\s\S]*?\n\};/.exec(src);
    assert.ok(m, "OCHRE_LIGHT_DEFAULTS not found");
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + "\n;globalThis.__p = OCHRE_LIGHT_DEFAULTS;", ctx);
    return ctx.__p;
}
function darkPreset() {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(read("js/defaults.js") + "\n;globalThis.__d = OCHRE_DEFAULTS;", ctx);
    return ctx.__d.sync.dark_preset;
}

// Every text colour over every surface the generated CSS can pair it with.
const PAIRS = [
    ["text-0", "background-0"], ["text-0", "background-1"], ["text-0", "background-2"],
    ["text-1", "background-0"], ["text-1", "background-1"], ["text-1", "background-2"],
    ["text-2", "background-0"], ["text-2", "background-1"], ["text-2", "background-2"],
    ["links", "background-0"], ["links", "background-1"], ["links", "background-2"],
    ["sidebar-text", "sidebar"],
];

for (const [name, get] of [["light", lightPreset], ["dark", darkPreset]]) {
    test(`the ${name} preset meets WCAG AA on every text/surface pairing`, () => {
        const p = get();
        const bad = [];
        for (const [fg, bg] of PAIRS) {
            if (!p[fg] || !p[bg]) continue;
            const r = contrast(p[fg], p[bg]);
            if (r < 4.5) bad.push(`${fg} on ${bg} = ${r.toFixed(2)} (${p[fg]}/${p[bg]})`);
        }
        assert.deepStrictEqual(bad, [],
            `below the 4.5:1 AA threshold:\n          ${bad.join("\n          ")}`);
    });
}

test("issue #11: the light-mode link colour is the one that was failing", () => {
    // Recorded so the regression is named. #418df1 measured 3.33 on white,
    // 2.36 on background-2 and 1.97 on background-1.
    const p = lightPreset();
    assert.notStrictEqual(p.links, "#418df1", "the failing link colour is back");
    assert.ok(contrast(p.links, "#ffffff") >= 4.5);
    assert.ok(contrast(p.links, "#c7c7c7") >= 4.5, "background-1 is the worst surface for links");
});

test("--ochre-buttons is emitted by both presets", () => {
    // Consumed by three rules in darkmodecss.js and emitted by nobody, so those
    // rules had never applied. A rule that resolves to nothing is a contrast
    // failure by definition.
    assert.ok("buttons" in lightPreset(), "light preset does not emit buttons");
    assert.ok("buttons" in darkPreset(), "dark preset does not emit buttons");
    const consumed = (read("css/darkmodecss.js").match(/var\(--ochre-buttons/g) || []).length;
    assert.ok(consumed > 0, "sanity: something should consume it");
});

test("every custom property consumed by the CSS is emitted by a preset", () => {
    // The general form of the --ochre-buttons bug.
    const css = read("css/darkmodecss.js") + read("css/content.css");
    const consumed = new Set((css.match(/var\(\s*--ochre-([a-z0-9-]+)/g) || [])
        .map(m => m.replace(/var\(\s*--ochre-/, "")));
    const emitted = new Set([...Object.keys(lightPreset()), ...Object.keys(darkPreset())]);
    // Set at runtime rather than from a preset.
    for (const k of (read("js/content.js").match(/setProperty\("--ochre-([a-z0-9-]+)"/g) || [])
        .map(m => m.replace(/setProperty\("--ochre-/, "").replace(/"$/, ""))) emitted.add(k);
    const orphans = [...consumed].filter(k => !emitted.has(k));
    assert.deepStrictEqual(orphans, [],
        `consumed but never emitted, so these rules never apply: ${orphans.join(", ")}`);
});

/* ---------------- keyboard reachability ---------------- */
test("makeActivatable puts a non-button control in the tab order", () => {
    const src = read("js/content.js");
    const m = /function makeActivatable\([\s\S]*?\n\}/.exec(src);
    assert.ok(m, "makeActivatable not found");
    const el = {
        tagName: "DIV", dataset: {}, attrs: {}, listeners: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        hasAttribute(k) { return k in this.attrs; },
        addEventListener(t, f) { this.listeners[t] = f; },
        clicked: 0,
        click() { this.clicked++; },
    };
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + "\n;globalThis.__f = makeActivatable;", ctx);
    ctx.__f(el, { label: "Do the thing" });
    assert.strictEqual(el.attrs.tabindex, "0", "not reachable by Tab");
    assert.strictEqual(el.attrs.role, "button", "announced as nothing without a role");
    assert.strictEqual(el.attrs["aria-label"], "Do the thing");
    assert.ok(el.listeners.keydown, "no keyboard handler");
    let prevented = 0;
    for (const key of ["Enter", " "]) {
        el.listeners.keydown({ key, preventDefault: () => prevented++ });
    }
    assert.strictEqual(el.clicked, 2, "Enter and Space should both activate it");
    assert.strictEqual(prevented, 2, "Space must be prevented or it scrolls the page");
    el.listeners.keydown({ key: "a", preventDefault: () => { throw new Error("should not prevent"); } });
    assert.strictEqual(el.clicked, 2, "other keys must not activate it");
});

test("makeActivatable is idempotent and leaves native controls alone", () => {
    const src = read("js/content.js");
    const m = /function makeActivatable\([\s\S]*?\n\}/.exec(src);
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(m[0] + "\n;globalThis.__f = makeActivatable;", ctx);
    const mk = (tag) => ({
        tagName: tag, dataset: {}, attrs: {}, handlers: 0,
        setAttribute(k, v) { this.attrs[k] = v; }, hasAttribute(k) { return k in this.attrs; },
        addEventListener() { this.handlers++; }, click() {},
    });
    const div = mk("DIV");
    ctx.__f(div); ctx.__f(div); ctx.__f(div);
    assert.strictEqual(div.handlers, 1, "reconcilers re-run; handlers must not stack");
    const btn = mk("BUTTON");
    ctx.__f(btn, { label: "x" });
    assert.strictEqual(btn.attrs.tabindex, undefined, "a button is already focusable");
    assert.strictEqual(btn.handlers, 0, "a button already handles Enter and Space");
    assert.strictEqual(btn.attrs["aria-label"], "x", "the label should still be applied");
});

test("the mouse-only to-do controls are now activatable", () => {
    const src = read("js/content.js");
    for (const id of ["better-todo-announcement", "better-todo-assignments", "better-todo-completed"]) {
        assert.ok(new RegExp(`makeActivatable\\(document\\.getElementById\\("${id}"\\)`).test(src),
            `${id} is a <div> with a click handler and no keyboard path`);
    }
    assert.ok(/makeActivatable\(assignment\.querySelector\("\.better-todo-assignment-checkmark"\)/.test(src),
        "the completion checkmark is an <svg> with a click handler");
});

test("focus is visible on injected controls", () => {
    const css = read("css/content.css");
    assert.ok(/\[data-ochre-activatable="1"\]:focus-visible/.test(css),
        "activatable controls have no visible focus ring");
    assert.ok(/outline:/.test(css.slice(css.indexOf('[data-ochre-activatable="1"]:focus-visible'))),
        "the focus rule should draw an outline");
});

console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
