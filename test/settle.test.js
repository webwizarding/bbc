/*
Phase 1.5: the settle signal replacing guessed delays.

runDarkModeFixer walks every element's computed style looking for colours dark
mode missed. It was scheduled at 800ms and again at 4500ms after
startExtension -- both measured from a cold page load, so on a client-side
navigation there is no load event to measure from and the passes fire against
whatever happens to be on screen.

Run: node test/settle.test.js
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

/**
 * Extract a function by brace matching.
 *
 * Skips the parameter list before counting. A destructured default such as
 * `function whenSettled(fn, { quietMs = 600 } = {})` puts a "{" in the params,
 * and starting the count there returns the parameter fragment instead of the
 * body -- which fails later as a bare "Unexpected token ';'".
 */
function extractFn(src, name) {
    const start = new RegExp("^(?:async )?function " + name + "\\s*\\(", "m").exec(src);
    if (!start) return null;
    let i = src.indexOf("(", start.index), paren = 0;
    for (; i < src.length; i++) {
        if (src[i] === "(") paren++;
        else if (src[i] === ")") { paren--; if (paren === 0) { i++; break; } }
    }
    let depth = 0;
    for (let j = src.indexOf("{", i); j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start.index, j + 1); }
    }
    return null;
}

/** A controllable fake document + MutationObserver. */
function harness({ readyState = "complete" } = {}) {
    const listeners = {};
    let observerCb = null;
    const ctx = {
        console: { warn() {} },
        setTimeout, clearTimeout,
        document: { readyState, documentElement: {} },
        window: {
            addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
        },
        MutationObserver: class {
            constructor(cb) { observerCb = cb; this.disconnected = false; }
            observe() {}
            disconnect() { this.disconnected = true; }
        },
    };
    vm.createContext(ctx);
    vm.runInContext(extractFn(read("js/content.js"), "whenSettled") + "\n;globalThis.__f = whenSettled;", ctx);
    return {
        whenSettled: ctx.__f,
        mutate: () => observerCb && observerCb(),
        fireLoad: () => (listeners.load || []).forEach(f => f()),
    };
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

test("runs once the DOM has been quiet for the quiet window", async () => {
    const h = harness();
    let runs = 0;
    h.whenSettled(() => runs++, { quietMs: 40, capMs: 2000 });
    assert.strictEqual(runs, 0, "should not run immediately");
    await wait(80);
    assert.strictEqual(runs, 1, "should have run after the quiet window");
});

test("a mutation restarts the quiet window", async () => {
    const h = harness();
    let runs = 0;
    h.whenSettled(() => runs++, { quietMs: 60, capMs: 3000 });
    await wait(30); h.mutate();
    await wait(30); h.mutate();
    assert.strictEqual(runs, 0, "still churning, should not have run");
    await wait(100);
    assert.strictEqual(runs, 1, "should run once it finally goes quiet");
});

test("runs exactly once, however much churn there is", async () => {
    const h = harness();
    let runs = 0;
    h.whenSettled(() => runs++, { quietMs: 30, capMs: 2000 });
    await wait(60);
    for (let i = 0; i < 10; i++) { h.mutate(); await wait(10); }
    await wait(80);
    assert.strictEqual(runs, 1, "the two old setTimeouts ran twice; this runs once");
});

test("a page that never settles still gets one pass, at the cap", async () => {
    const h = harness();
    let runs = 0;
    h.whenSettled(() => runs++, { quietMs: 1000, capMs: 60 });
    const churn = setInterval(() => h.mutate(), 10);
    await wait(140);
    clearInterval(churn);
    assert.strictEqual(runs, 1, "a live-updating dashboard must not starve the callback forever");
});

test("waits for load before arming when the document is still loading", async () => {
    const h = harness({ readyState: "loading" });
    let runs = 0;
    h.whenSettled(() => runs++, { quietMs: 30, capMs: 5000 });
    await wait(70);
    assert.strictEqual(runs, 0, "should not have started measuring quiet before load");
    h.fireLoad();
    await wait(70);
    assert.strictEqual(runs, 1, "should run once loaded and quiet");
});

test("a callback that throws does not break the caller", async () => {
    const h = harness();
    h.whenSettled(() => { throw new Error("boom"); }, { quietMs: 20, capMs: 500 });
    await wait(60);   // an unhandled throw here would surface as a crash
});

test("the guessed dark-mode delays are gone", () => {
    const c = read("js/content.js").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/setTimeout\(\(\) => runDarkModeFixer\(false\), \d+\)/.test(c),
        "runDarkModeFixer is scheduled on a fixed delay again; those were measured " +
        "from a cold load and are meaningless after a client-side navigation");
    assert.ok(/whenSettled\(\(\) => runDarkModeFixer\(false\)\)/.test(c),
        "the dark-mode fixer should run on the settle signal");
});
