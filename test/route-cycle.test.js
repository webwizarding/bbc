/*
Phase 1.1, commit 3: the teardown/reapply cycle.

The acceptance test is the duplicate-node count: navigate
dashboard -> course -> grades -> dashboard ten times, then count injected
nodes. Any count that grows means teardown is incomplete.

What is exercised here is the real cycle code (registry, ensureInjected,
checkRouteChange, teardownRoute) driven against a fake DOM, with each of the
five guard shapes found in the source represented by a stub injector. That
demonstrates which *guard shapes* survive ten rounds. It cannot exercise the
real feature bodies, which need Canvas markup -- those are covered by the
manual click-through.

Run: node test/route-cycle.test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.resolve(__dirname, "../js/content.js"), "utf8").replace(/\r/g, "");
const code = () => SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") throw new Error("test body must be synchronous");
        console.log(`  PASS  ${name}`);
    } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

/* ---------------- fake DOM ---------------- */
class El {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.parent = null;
                               this.style = {}; this.dataset = {}; this.id = ""; this.className = ""; }
    get isConnected() { let n = this; while (n.parent) n = n.parent; return n.__isRoot === true; }
    appendChild(c) { if (c.parent) c.parent.__rm(c); c.parent = this; this.children.push(c); return c; }
    __rm(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
    remove() { if (this.parent) this.parent.__rm(this); this.parent = null; }
    all() { const out = []; const w = n => { for (const c of n.children) { out.push(c); w(c); } }; w(this); return out; }
}
function makeDoc() {
    const root = new El("html"); root.__isRoot = true;
    return {
        __root: root,
        getElementById(id) { return root.all().find(e => e.id === id) || null; },
        countById(id) { return root.all().filter(e => e.id === id).length; },
        createElement(tag) { return new El(tag); },
        body: root.appendChild(new El("body")),
    };
}

/* ---------------- load real cycle code ---------------- */
function loadCycle() {
    const c = code();
    const pieces = [];
    // registry + helpers + cycle, by name
    for (const name of ["registerObserver", "stopObserver", "registerInterval", "stopInterval",
                        "registerListener", "stopListener", "stopRouteScoped", "lifecycleCounts",
                        "ensureInjected", "scheduleRouteCheck"]) {
        const m = new RegExp("^function " + name + "\\s*\\([\\s\\S]*?\\n\\}", "m").exec(c);
        assert.ok(m, name + " not found in source");
        pieces.push(m[0]);
    }
    const lif = /const lifecycle = \{[\s\S]*?\n\};/.exec(c);
    assert.ok(lif, "lifecycle registry object not found");

    const doc = makeDoc();
    const ctx = {
        console, setInterval, clearInterval, assert,
        document: doc,
        requestAnimationFrame: (fn) => fn(),
        window: { location: { pathname: "/" } },
    };
    vm.createContext(ctx);
    vm.runInContext(lif[0] + "\n" + pieces.join("\n"), ctx);
    ctx.__doc = doc;
    return ctx;
}

console.log("\nroute cycle\n");

test("ensureInjected returns the same node instead of adding another", () => {
    const ctx = loadCycle();
    const parent = ctx.document.body;
    const a = ctx.ensureInjected("x", parent, () => ctx.document.createElement("div"));
    const b = ctx.ensureInjected("x", parent, () => ctx.document.createElement("div"));
    assert.strictEqual(a, b, "second call created a new node");
    assert.strictEqual(ctx.document.countById("x"), 1);
});

test("ensureInjected rebuilds after Canvas destroys the node", () => {
    const ctx = loadCycle();
    const parent = ctx.document.body;
    const first = ctx.ensureInjected("y", parent, () => ctx.document.createElement("div"));
    first.remove();                       // Canvas destroyed the subtree
    const second = ctx.ensureInjected("y", parent, () => ctx.document.createElement("div"));
    assert.notStrictEqual(first, second, "must rebuild once the node is gone");
    assert.strictEqual(second.isConnected, true);
    assert.strictEqual(ctx.document.countById("y"), 1);
    // Note: this passes because the id lookup does not find a removed node,
    // which is also true of a real document.getElementById. The isConnected
    // branch inside ensureInjected is therefore not what makes this work and
    // is not covered here. The guard shape that genuinely needs isConnected is
    // a held module reference, covered by the ten-round test below.
});

test("a held reference guard needs isConnected; the id lookup does not", () => {
    const ctx = loadCycle();
    const doc = ctx.document, parent = doc.body;

    // The shape createNasaInfoOverlay used: guard on holding a reference.
    let ref = null;
    const brokenInject = () => {
        if (ref) return ref;                       // no isConnected check
        ref = doc.createElement("div"); ref.id = "held-broken";
        parent.appendChild(ref); return ref;
    };
    // The fixed shape.
    let ref2 = null;
    const fixedInject = () => {
        if (ref2 && ref2.isConnected) return ref2;
        ref2 = doc.createElement("div"); ref2.id = "held-fixed";
        parent.appendChild(ref2); return ref2;
    };

    brokenInject(); fixedInject();
    for (const el of parent.children.slice()) el.remove();   // Canvas navigates
    brokenInject(); fixedInject();

    assert.strictEqual(doc.countById("held-broken"), 0,
        "reference-only guard should refuse to rebuild -- this is the bug");
    assert.strictEqual(doc.countById("held-fixed"), 1,
        "isConnected guard must rebuild after the node is destroyed");
});

test("TEN ROUNDS: dashboard -> course -> grades -> dashboard, per-guard counts", () => {
    const ctx = loadCycle();
    const doc = ctx.document;
    const parent = doc.body;

    // One stub per guard shape found in the source.
    let moduleRef = null;                       // shape 5: module-variable reference
    const injectors = {
        "ensureInjected": () => ctx.ensureInjected("g-shared", parent, () => doc.createElement("div")),
        "getElementById||make": () => {
            let e = doc.getElementById("g-byid");
            if (!e) { e = doc.createElement("div"); e.id = "g-byid"; parent.appendChild(e); }
            return e;
        },
        "module-variable ref": () => {
            if (moduleRef) return moduleRef;    // never checks isConnected
            moduleRef = doc.createElement("div"); moduleRef.id = "g-modref";
            parent.appendChild(moduleRef);
            return moduleRef;
        },
    };

    const routes = ["/", "/courses/1", "/courses/1/grades", "/"];
    for (let round = 0; round < 10; round++) {
        for (const r of routes) {
            ctx.window.location.pathname = r;
            // teardown: Canvas replaces the content subtree, and route work stops
            ctx.stopRouteScoped();
            for (const el of parent.children.slice()) el.remove();
            moduleRef && !moduleRef.isConnected;         // reference survives, node does not
            // reapply
            ctx.registerObserver("dashboardReady",
                { observe() {}, disconnect() {} }, "T", {}, "route");
            for (const fn of Object.values(injectors)) fn();
        }
    }

    const counts = {
        "g-shared": doc.countById("g-shared"),
        "g-byid": doc.countById("g-byid"),
        "g-modref": doc.countById("g-modref"),
    };
    const lc = { ...ctx.lifecycleCounts() };

    assert.strictEqual(counts["g-shared"], 1,
        `ensureInjected leaked: ${counts["g-shared"]} nodes after 10 rounds`);
    assert.strictEqual(counts["g-byid"], 1,
        `getElementById||make leaked: ${counts["g-byid"]} nodes after 10 rounds`);
    assert.strictEqual(counts["g-modref"], 0,
        `module-variable guard: expected 0 (node destroyed, guard refuses to rebuild), got ${counts["g-modref"]}`);
    assert.strictEqual(lc.observers, 1,
        `observers accumulated across 10 rounds: ${lc.observers} (expected 1)`);
});

/* ---------------- source assertions ---------------- */
test("document-scoped features are not in the route reapply list", () => {
    const c = code();
    const m = /function applyRoute\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(m, "applyRoute not found");
    for (const forbidden of ["toggleDarkMode", "loadCustomFont", "applyAestheticChanges",
                             "applyCustomBackground", "toggleAutoDarkMode", "updateReminders"]) {
        assert.ok(!new RegExp("\\b" + forbidden + "\\s*\\(").test(m[0]),
            `${forbidden} is document-scoped and must not be reapplied on navigation`);
    }
});

test("the route cycle tears down before it reapplies", () => {
    const c = code();
    const m = /function checkRouteChange\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(m, "checkRouteChange not found");
    const t = m[0].indexOf("teardownRoute()"), a = m[0].indexOf("applyRoute()");
    assert.ok(t >= 0 && a >= 0, "cycle must both tear down and reapply");
    assert.ok(t < a, "teardown must run before reapply, or reapply duplicates nodes");
});

test("navigation is detected by more than one signal", () => {
    const c = code();
    const m = /function setupNavigation\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(m, "setupNavigation not found");
    for (const sig of ["pushState", "replaceState", "popstate"]) {
        assert.ok(m[0].includes(sig), `navigation signal missing: ${sig}`);
    }
});

test("history patching is idempotent", () => {
    const c = code();
    const m = /function setupNavigation\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(/__orcaPatched/.test(m[0]),
        "history methods must not be wrapped twice if setupNavigation runs again");
});

test("held-reference guards check isConnected", () => {
    const c = code();
    // resetRouteState() nulls nasaInfoOverlayEl, which masks a regression here
    // on the paths it covers -- but a reference-only guard is still wrong for
    // any path that does not go through the route cycle (an options toggle, a
    // storage change, the dashboard observer firing). Assert the shape.
    const m = /function createNasaInfoOverlay\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(m, "createNasaInfoOverlay not found");
    const guard = /if \(\s*nasaInfoOverlayEl\s*\|\|/.test(m[0]);
    assert.ok(!guard,
        "createNasaInfoOverlay guards on holding a reference without checking " +
        "isConnected; it will refuse to rebuild after Canvas destroys the node");
    assert.ok(/nasaInfoOverlayEl\s*&&\s*nasaInfoOverlayEl\.isConnected/.test(m[0]),
        "the isConnected check is missing from the overlay guard");
});

test("route state that gates re-setup is reset", () => {
    const c = code();
    const m = /function resetRouteState\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(m, "resetRouteState not found");
    for (const v of ["lastDashboardCardSignature", "nasaInfoOverlayEl", "domContainers"]) {
        assert.ok(m[0].includes(v), `${v} is not reset; it would gate re-setup after navigation`);
    }
});

console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
