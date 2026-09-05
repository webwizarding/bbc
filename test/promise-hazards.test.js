/*
Promise shapes that hang instead of failing.

A rejected promise is discoverable -- it logs an unhandled rejection. A promise
that never settles produces no output at all, so callers wait forever and
nothing anywhere says so. Three instances were found in this codebase, all with
the same shape: a `new Promise` wrapper whose reject path was never wired up.

Run: node test/promise-hazards.test.js
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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function extract(src, name) {
    const re = new RegExp("^(?:async )?function " + name + "\\s*\\([\\s\\S]*?\\n\\}", "m");
    const m = re.exec(strip(src));
    assert.ok(m, name + " not found");
    return m[0];
}

/** Reject if a promise has not settled shortly -- a hang, not a failure. */
function withTimeout(p, ms = 250) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error("promise never settled (hang)")), ms)),
    ]);
}

test("sendFromPopup settles when tabs.query rejects", async () => {
    const ctx = {
        console: { warn() {} },
        chrome: { tabs: { query: async () => { throw new Error("no permission"); }, sendMessage: async () => null } },
    };
    vm.createContext(ctx);
    vm.runInContext(extract(read("js/popup.js"), "sendFromPopup"), ctx);
    const res = await withTimeout(ctx.sendFromPopup("getcolors"));
    assert.strictEqual(res, null, "should resolve null, not hang");
});

test("sendFromPopup settles when every tab rejects", async () => {
    const ctx = {
        console: { warn() {} },
        chrome: { tabs: {
            query: async () => [{ id: 1 }, { id: 2 }],
            sendMessage: async () => { throw new Error("no content script"); },
        } },
    };
    vm.createContext(ctx);
    vm.runInContext(extract(read("js/popup.js"), "sendFromPopup"), ctx);
    assert.strictEqual(await withTimeout(ctx.sendFromPopup("x")), null);
});

test("sendFromPopup returns the first tab that answers", async () => {
    const ctx = {
        console: { warn() {} },
        chrome: { tabs: {
            query: async () => [{ id: 1 }, { id: 2 }],
            sendMessage: async (id) => id === 2 ? "answer" : null,
        } },
    };
    vm.createContext(ctx);
    vm.runInContext(extract(read("js/popup.js"), "sendFromPopup"), ctx);
    assert.strictEqual(await withTimeout(ctx.sendFromPopup("x")), "answer");
});

test("sendFromPopup does not wrap a promise in new Promise", () => {
    const src = extract(read("js/popup.js"), "sendFromPopup");
    assert.ok(!/new Promise/.test(src),
        "wrapping a promise in new Promise loses its rejection; the previous " +
        "version declared reject and never called it, so a tabs.query failure " +
        "hung the popup forever");
});

test("getCards resolves on both storage outcomes", () => {
    const c = strip(read("js/content.js"));
    // Both card-fetch paths resolve inside a storage write's .then(). A
    // rejected write -- which is what a quota failure is -- must not leave the
    // caller pending.
    // Every `.then(() => resolve())` must be immediately preceded by a
    // `.catch(...)`. Matching the whole call with a wildcard does not work --
    // the wildcard happily spans the .catch, so the check passes either way.
    const all = [...c.matchAll(/\.then\(\(\) => resolve\(\)\)/g)];
    assert.ok(all.length > 0, "expected to find the resolve-after-write sites");
    // A substring check, not a regex: `.catch(() => {})` contains a nested
    // paren, and a character class excluding ")" cannot span it -- an earlier
    // regex here reported the fixed code as broken.
    const unguarded = all.filter(m => !c.slice(Math.max(0, m.index - 40), m.index).includes(".catch("));
    assert.strictEqual(unguarded.length, 0,
        `${unguarded.length} of ${all.length} site(s) resolve only on a successful ` +
        "write; a rejected write leaves the caller's promise pending forever");
});

test("preloadAssignmentEls still propagates rejection", () => {
    const src = extract(read("js/content.js"), "preloadAssignmentEls");
    assert.ok(!/new Promise/.test(src));
});
