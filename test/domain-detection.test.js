/*
Security regression test: how Ochre decides a page is Canvas.

The rule is that Canvas is identified only two ways -- a built-in pattern for
Instructure-hosted instances, and domains the user typed into the popup. It is
never inferred from a network response.

The removed implementation fetched /api/v1/courses with the user's cookies
against every HTTPS origin visited and adopted whichever returned a non-empty
JSON array. Two consequences, both covered below: any site could nominate
itself as the user's Canvas, and the host match itself was a substring test
(domain.includes(entry)), so "canvas.ucsc.edu.attacker.net" satisfied a
"canvas.ucsc.edu" entry.

Loads the real functions from js/content.js rather than copying them.
Run: node test/domain-detection.test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js/content.js"), "utf8").replace(/\r/g, "");

function extract(name, kind = "function") {
    if (kind === "const") {
        const m = new RegExp("^const " + name + " = \\[", "m").exec(SRC);
        if (!m) throw new Error(name + " not found");
        const end = SRC.indexOf("];", m.index) + 2;
        return SRC.slice(m.index, end);
    }
    const m = new RegExp("^(?:async )?function " + name + "\\s*\\(", "m").exec(SRC);
    if (!m) throw new Error(name + " not found");
    let d = 0;
    for (let j = SRC.indexOf("{", m.index); j < SRC.length; j++) {
        if (SRC[j] === "{") d++;
        else if (SRC[j] === "}") { d--; if (d === 0) return SRC.slice(m.index, j + 1); }
    }
    throw new Error("unbalanced " + name);
}

const ctx = { console, URL };
vm.createContext(ctx);
vm.runInContext(extract("CANVAS_BUILTIN_HOST_PATTERNS", "const"), ctx);
for (const f of ["normalizeDomainEntry", "hostMatchesConfiguredDomain", "isBuiltInCanvasHost"]) {
    vm.runInContext(extract(f), ctx);
}

let failures = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") throw new Error("test body must be synchronous");
        console.log(`  PASS  ${name}`);
    } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

console.log("\ndomain detection\n");

/* ---- the probe must be gone ---- */
test("the credentialed auto-detect probe no longer exists", () => {
    assert.ok(!/function setupCustomURL/.test(SRC), "setupCustomURL still defined");
    assert.ok(!/custom_domain:\s*\[domain\]/.test(SRC),
        "something still writes the visited origin into custom_domain");
});

test("nothing writes custom_domain from a network response", () => {
    // The whole content script must not set custom_domain at all; only the
    // popup (explicit user input) and the background migration may.
    assert.ok(!/set\(\s*\{\s*custom_domain/.test(SRC),
        "content.js writes custom_domain, which should only come from user action");
});

/* ---- built-in pattern ---- */
for (const [host, want] of [
    ["instructure.com", true],
    ["canvas.instructure.com", true],
    ["myschool.instructure.com", true],
    ["a.b.instructure.com", true],
    ["evilinstructure.com", false],
    ["instructure.com.attacker.net", false],
    ["instructure.co", false],
    ["notinstructure.com", false],
    ["canvas.ucsc.edu", false],
]) {
    test(`built-in: ${host} -> ${want}`, () => {
        assert.strictEqual(ctx.isBuiltInCanvasHost(host), want);
    });
}

/* ---- configured domains ---- */
test("exact configured hostname matches", () => {
    assert.strictEqual(ctx.hostMatchesConfiguredDomain("canvas.ucsc.edu", ["canvas.ucsc.edu"]), true);
});

test("subdomain of a configured hostname matches", () => {
    assert.strictEqual(ctx.hostMatchesConfiguredDomain("sub.canvas.ucsc.edu", ["canvas.ucsc.edu"]), true);
});

test("suffix-spoofing host does NOT match (the old includes() bypass)", () => {
    assert.strictEqual(
        ctx.hostMatchesConfiguredDomain("canvas.ucsc.edu.attacker.net", ["canvas.ucsc.edu"]), false,
        "attacker.net must not satisfy a canvas.ucsc.edu entry");
});

test("prefix-spoofing host does NOT match", () => {
    assert.strictEqual(
        ctx.hostMatchesConfiguredDomain("notcanvas.ucsc.edu", ["canvas.ucsc.edu"]), false);
});

test("unrelated host does not match", () => {
    assert.strictEqual(ctx.hostMatchesConfiguredDomain("example.com", ["canvas.ucsc.edu"]), false);
});

test("empty / unset configuration matches nothing", () => {
    for (const cfg of [[], [""], ["   "], null, undefined]) {
        assert.strictEqual(ctx.hostMatchesConfiguredDomain("anything.com", cfg), false,
            `config ${JSON.stringify(cfg)} should match nothing`);
    }
});

/* ---- format migration: both stored shapes keep working ---- */
test("origin-format entries from the old probe still match", () => {
    assert.strictEqual(
        ctx.hostMatchesConfiguredDomain("canvas.ucsc.edu", ["https://canvas.ucsc.edu"]), true,
        "users whose domain was set by the probe must not have to re-enter it");
});

for (const [input, want] of [
    ["canvas.ucsc.edu", "canvas.ucsc.edu"],
    ["https://canvas.ucsc.edu", "canvas.ucsc.edu"],
    ["https://canvas.ucsc.edu/", "canvas.ucsc.edu"],
    ["https://canvas.ucsc.edu/courses/1", "canvas.ucsc.edu"],
    ["HTTPS://Canvas.UCSC.edu", "canvas.ucsc.edu"],
    ["canvas.ucsc.edu:443", "canvas.ucsc.edu"],
    ["  canvas.ucsc.edu  ", "canvas.ucsc.edu"],
    ["", ""],
    ["   ", ""],
]) {
    test(`normalize ${JSON.stringify(input)} -> ${JSON.stringify(want)}`, () => {
        assert.strictEqual(ctx.normalizeDomainEntry(input), want);
    });
}

test("non-string entries are ignored, not crashed on", () => {
    assert.strictEqual(ctx.normalizeDomainEntry(null), "");
    assert.strictEqual(ctx.normalizeDomainEntry(undefined), "");
    assert.strictEqual(ctx.normalizeDomainEntry(42), "");
    assert.strictEqual(ctx.hostMatchesConfiguredDomain("x.com", [null, 42, "x.com"]), true);
});

console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
