/*
Phase 1.1, commit 2: the lifecycle registry.

Two observers used to be held in `const` locals inside the functions that
created them, so no reference survived and they could never be disconnected --
both observing document.documentElement with subtree:true. One interval was
not assigned to a variable at all. Those failures are silent by nature (work
accumulates, nothing errors), so several of these are source assertions.

Run: node test/lifecycle.test.js
*/
import { test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import vm from "vm";
import assert from "assert";

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../js/content.js"), "utf8").replace(/\r/g, "");
const code = () => SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---------- load the registry ---------- */
function loadRegistry() {
    const c = code();
    const start = c.indexOf("const lifecycle = {");
    const end = c.indexOf("function lifecycleCounts()");
    const tail = c.slice(end);
    const body = c.slice(start, end) + tail.slice(0, tail.indexOf("\n}") + 2);
    const ctx = { console, setInterval, clearInterval };
    vm.createContext(ctx);
    vm.runInContext(body, ctx);
    return ctx;
}

/** Copy a value out of the vm realm so deepStrictEqual compares by shape, not prototype. */
function counts(ctx) {
    return { ...ctx.lifecycleCounts() };
}

function fakeObserver() {
    return { observed: [], disconnected: 0,
             observe(t, o) { this.observed.push([t, o]); },
             disconnect() { this.disconnected++; } };
}

test("registerObserver observes and records", () => {
    const ctx = loadRegistry();
    const o = fakeObserver();
    ctx.registerObserver("a", o, "TARGET", { childList: true }, "route");
    assert.strictEqual(o.observed.length, 1, "observe() not called");
    assert.deepStrictEqual(o.observed[0], ["TARGET", { childList: true }]);
    assert.strictEqual(ctx.lifecycleCounts().observers, 1);
});

test("stopObserver disconnects and forgets", () => {
    const ctx = loadRegistry();
    const o = fakeObserver();
    ctx.registerObserver("a", o, "T", {}, "route");
    assert.strictEqual(ctx.stopObserver("a"), true);
    assert.strictEqual(o.disconnected, 1, "disconnect() not called");
    assert.strictEqual(ctx.lifecycleCounts().observers, 0);
    assert.strictEqual(ctx.stopObserver("a"), false, "second stop should be a no-op");
});

test("re-registering the same name replaces, it does not accumulate", () => {
    const ctx = loadRegistry();
    const first = fakeObserver(), second = fakeObserver();
    ctx.registerObserver("dup", first, "T", {}, "route");
    ctx.registerObserver("dup", second, "T", {}, "route");
    assert.strictEqual(first.disconnected, 1, "the replaced observer must be disconnected");
    assert.strictEqual(ctx.lifecycleCounts().observers, 1,
        "re-registering must not leave two observers running");
});

test("stopRouteScoped stops route work and leaves document work running", () => {
    const ctx = loadRegistry();
    const routeObs = fakeObserver(), docObs = fakeObserver();
    ctx.registerObserver("r", routeObs, "T", {}, "route");
    ctx.registerObserver("d", docObs, "T", {}, "document");
    ctx.registerInterval("ri", () => {}, 10000, "route");
    ctx.registerInterval("di", () => {}, 10000, "document");
    let removed = [];
    const target = { addEventListener() {}, removeEventListener(t) { removed.push(t); } };
    ctx.registerListener("rl", target, "resize", () => {}, undefined, "route");
    ctx.registerListener("dl", target, "keydown", () => {}, undefined, "document");

    ctx.stopRouteScoped();

    assert.strictEqual(routeObs.disconnected, 1, "route observer not stopped");
    assert.strictEqual(docObs.disconnected, 0, "document observer must survive navigation");
    assert.deepStrictEqual(counts(ctx), { observers: 1, intervals: 1, listeners: 1 },
        "exactly the document-scoped entries should remain");
    assert.deepStrictEqual(removed, ["resize"], "only the route listener should be removed");
});

test("repeated route cycles do not accumulate", () => {
    const ctx = loadRegistry();
    for (let i = 0; i < 10; i++) {
        ctx.registerObserver("cycle", fakeObserver(), "T", {}, "route");
        ctx.registerInterval("cycle", () => {}, 10000, "route");
        ctx.stopRouteScoped();
    }
    assert.deepStrictEqual(counts(ctx), { observers: 0, intervals: 0, listeners: 0 },
        "ten register/stop cycles must leave nothing behind");
});

/* ---------- source assertions ---------- */
test("no MutationObserver is held in an unreachable const local", () => {
    const c = code();
    const bad = c.match(/^\s*const\s+\w*[Oo]bserver\w*\s*=\s*new MutationObserver/gm) || [];
    assert.strictEqual(bad.length, 0,
        `${bad.length} observer(s) held in a const local and so undisconnectable: ${bad.join(", ")}`);
});

test("no setInterval result is discarded", () => {
    const c = code();
    // A bare `setInterval(...)` statement, i.e. not assigned and not registered.
    const bad = c.match(/^\s*setInterval\(/gm) || [];
    assert.strictEqual(bad.length, 0,
        `${bad.length} setInterval call(s) whose id is discarded and can never be cleared`);
});

test("the four previously-uncontrollable entries are controllable", () => {
    const c = code();
    // Asserts the property, not the mechanism. Phase 1.5 folded five
    // documentElement/subtree observers into one shared watcher, so the footer
    // and the page-chrome buttons are reconcilers on "domWatcher" rather than
    // observers of their own. They are still stoppable -- via
    // unregisterReconciler, or by stopping the watcher itself -- which is what
    // this is really about.
    const controllable = (name) =>
        new RegExp(`registerObserver\\("${name}"`).test(c) ||
        new RegExp(`registerReconciler\\("${name}"`).test(c);
    for (const name of ["footer", "dashboardReady", "submissionPageButton"]) {
        assert.ok(controllable(name), `"${name}" is neither a registered observer nor a reconciler`);
    }
    assert.ok(/registerObserver\("domWatcher"/.test(c),
        "the shared watcher must itself be on the registry, or nothing can stop it");
    assert.ok(/registerInterval\("reminderWatch"/.test(c),
        "the reminder poller interval is not registered");
});

test("reconcilers run on one shared observer, not one each", () => {
    const c = code();
    const reconcilers = new Set((c.match(/registerReconciler\("([^"]+)"/g) || []));
    assert.ok(reconcilers.size >= 5,
        `expected the page-chrome watchers to be reconcilers, found ${reconcilers.size}`);
    // The five that each ran their own documentElement/subtree observer.
    for (const name of ["footer", "newCanvasButton", "sequenceFooter",
                        "submissionPageButton", "profileLogoutButton"]) {
        assert.ok(new RegExp(`registerReconciler\\("${name}"`).test(c),
            `"${name}" should be a reconciler on the shared watcher`);
    }
});

test("no feature polls for an element with a retry ladder", () => {
    const c = code();
    // Two of these existed: a 300/800/1600/3000/5000 ladder for the submission
    // button, and a 20x500ms poll for the nav menu. Both gave up after a fixed
    // budget and did nothing if Canvas rebuilt the node afterwards.
    assert.ok(!/for \(const ms of \[\s*\d+\s*,/.test(c),
        "a retry ladder of guessed delays is back");
    assert.ok(!/Retries\+\+ < \d+\) setTimeout/.test(c),
        "a bounded poll for an element is back; register a reconciler instead");
});

test("dark mode is not route-scoped and cannot join the route cycle", () => {
    const c = code();
    // darkcss must never be registered as route work, and nothing may remove it.
    assert.ok(!/registerObserver\("dark|registerInterval\("dark/.test(c),
        "dark mode registered with the lifecycle; it must initialise once");
    const removals = c.match(/getElementById\("darkcss"\)[^\n]*\.remove\(\)/g) || [];
    assert.strictEqual(removals.length, 0,
        "something removes the dark mode stylesheet; re-injecting it causes the " +
        "flash of light content it exists to prevent");
});
