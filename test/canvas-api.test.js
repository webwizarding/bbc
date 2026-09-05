/*
Phase 1.2: the canvasApi layer.

getData() fetched, called response.json(), and returned. It never checked
response.ok, so an auth redirect returning HTML threw an opaque SyntaxError;
it never followed the Link header, so list endpoints silently truncated; and
it had no timeout, no retry, and no error type a caller could branch on.

Run: node test/canvas-api.test.js
*/
import { test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import vm from "vm";
import assert from "assert";

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../js/content.js"), "utf8").replace(/\r/g, "");
const code = () => SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---------------- harness ---------------- */
function load({ responses = [], now = () => Date.now() } = {}) {
    const c = code();
    const pieces = [];
    for (const re of [
        /class CanvasApiError extends Error \{[\s\S]*?\n\}/,
        /^const CANVAS_API_TIMEOUT_MS[\s\S]*?^const CANVAS_API_CACHE_TTL_MS = \d+;/m,
        /^function parseLinkHeader\([\s\S]*?\n\}/m,
        /^function getNextPageUrl\([\s\S]*?\n\}/m,
        /^const canvasApiCache = new Map\(\);/m,
        /^function cacheGet\([\s\S]*?\n\}/m,
        /^function clearCanvasApiCache\(\)[^\n]*\n/m,
        /^const sleep = [^\n]*\n/m,
        /^async function canvasFetchOnce\([\s\S]*?\n\}/m,
        /^async function canvasFetch\([\s\S]*?\n\}/m,
        /^function canvasGet\([\s\S]*?\n\}/m,
        /^async function canvasGetAll\([\s\S]*?\n\}/m,
        /^async function canvasMutate\([\s\S]*?\n\}/m,
        /^function unwrapXray\([\s\S]*?\n\}/m,
        /^const canvasApi = \{[\s\S]*?\n\};/m,
    ]) {
        const m = re.exec(c);
        assert.ok(m, "could not extract: " + re);
        pieces.push(m[0]);
    }

    const calls = [];
    let i = 0;
    const ctx = {
        console: { warn() {}, log() {}, error() {} },
        setTimeout, clearTimeout, Date, URL, Math, JSON, Number, Array, String, Promise,
        AbortController,
        domain: "https://canvas.example.edu",
        CSRFtoken: () => "tok",
        fetch: async (url, init) => {
            calls.push({ url, init });
            const spec = responses[Math.min(i++, responses.length - 1)];
            if (typeof spec === "function") return spec(url, init);
            if (spec instanceof Error) throw spec;
            return {
                ok: spec.status === undefined ? true : spec.status < 400,
                status: spec.status ?? 200,
                headers: { get: (h) => (spec.headers || {})[h] ?? (spec.headers || {})[h.toLowerCase()] ?? null },
                text: async () => spec.body !== undefined ? spec.body : JSON.stringify(spec.json ?? []),
            };
        },
    };
    vm.createContext(ctx);
    vm.runInContext(pieces.join("\n"), ctx);
    ctx.__calls = calls;
    return ctx;
}

/* ---------------- Link header parsing ---------------- */
const linkCases = [
    ['canonical Canvas', '<https://canvas.example.edu/a?page=2>; rel="next",<https://canvas.example.edu/a?page=1>; rel="first"', "https://canvas.example.edu/a?page=2"],
    ['next not first in list', '<https://canvas.example.edu/a?page=1>; rel="current",<https://canvas.example.edu/a?page=2>; rel="next"', "https://canvas.example.edu/a?page=2"],
    ['space before semicolon', '<https://canvas.example.edu/a?page=2> ; rel="next"', "https://canvas.example.edu/a?page=2"],
    ['unquoted rel', '<https://canvas.example.edu/a?page=2>; rel=next', "https://canvas.example.edu/a?page=2"],
    ['multiple rel values', '<https://canvas.example.edu/a?page=2>; rel="next last"', "https://canvas.example.edu/a?page=2"],
    ['uppercase Rel', '<https://canvas.example.edu/a?page=2>; Rel="next"', "https://canvas.example.edu/a?page=2"],
    ['single-quoted rel', "<https://canvas.example.edu/a?page=2>; rel='next'", "https://canvas.example.edu/a?page=2"],
    ['no next', '<https://canvas.example.edu/a?page=5>; rel="last"', null],
    ['empty header', '', null],
];
for (const [name, header, want] of linkCases) {
    test(`Link: ${name}`, () => {
        const ctx = load();
        assert.strictEqual(ctx.getNextPageUrl(header), want);
    });
}

test("Link: cross-origin rel=next is refused", () => {
    const ctx = load();
    assert.strictEqual(ctx.getNextPageUrl('<https://evil.example/steal>; rel="next"'), null,
        "following a cross-origin pagination link would send the Canvas session to it");
});

test("Link: relative rel=next resolves against the Canvas origin", () => {
    const ctx = load();
    assert.strictEqual(ctx.getNextPageUrl('</api/v1/x?page=3>; rel="next"'),
        "https://canvas.example.edu/api/v1/x?page=3");
});

/* ---------------- error typing ---------------- */
test("auth redirect returning HTML is typed, not an opaque parse error", async () => {
    const ctx = load({ responses: [{ status: 200, body: "<!DOCTYPE html><html>sign in</html>" }] });
    await assert.rejects(() => ctx.canvasGet("https://canvas.example.edu/api/v1/x"), (e) => {
        assert.strictEqual(e.name, "CanvasApiError");
        assert.strictEqual(e.kind, "auth", `expected kind=auth, got ${e.kind}`);
        return true;
    });
});

test("401 is typed as auth", async () => {
    const ctx = load({ responses: [{ status: 401, body: "" }] });
    await assert.rejects(() => ctx.canvasGet("https://canvas.example.edu/api/v1/x"),
        (e) => e.kind === "auth" && e.status === 401);
});

test("429 is typed and carries Retry-After", async () => {
    const ctx = load({ responses: [{ status: 429, headers: { "Retry-After": "2" }, body: "" }] });
    await assert.rejects(() => ctx.canvasGet("https://canvas.example.edu/api/v1/x", { force: true }),
        (e) => e.kind === "ratelimit" && e.retryAfter === 2);
});

test("a 500 is retried once, then reported", async () => {
    const ctx = load({ responses: [{ status: 500, body: "" }, { status: 500, body: "" }] });
    await assert.rejects(() => ctx.canvasGet("https://canvas.example.edu/api/v1/x"),
        (e) => e.kind === "http" && e.status === 500);
    assert.strictEqual(ctx.__calls.length, 2, "a 5xx should be retried exactly once");
});

test("a 500 followed by success returns the data", async () => {
    const ctx = load({ responses: [{ status: 500, body: "" }, { status: 200, json: [{ id: 1 }] }] });
    const data = await ctx.canvasGet("https://canvas.example.edu/api/v1/x");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(data)), [{ id: 1 }]);
});

test("a 404 is NOT retried", async () => {
    const ctx = load({ responses: [{ status: 404, body: "" }] });
    await assert.rejects(() => ctx.canvasGet("https://canvas.example.edu/api/v1/x"), (e) => e.status === 404);
    assert.strictEqual(ctx.__calls.length, 1, "4xx must not be retried");
});

/* ---------------- pagination ---------------- */
test("getAll follows Link rel=next across pages", async () => {
    const ctx = load({ responses: [
        { json: [1, 2], headers: { Link: '<https://canvas.example.edu/api/v1/x?page=2>; rel="next"' } },
        { json: [3, 4], headers: { Link: '<https://canvas.example.edu/api/v1/x?page=3>; rel="next"' } },
        { json: [5] },
    ]});
    const all = await ctx.canvasGetAll("https://canvas.example.edu/api/v1/x");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(all)), [1, 2, 3, 4, 5]);
    assert.strictEqual(ctx.__calls.length, 3);
});

test("getAll stops at the page cap", async () => {
    const ctx = load({ responses: [
        (url) => ({ ok: true, status: 200,
            headers: { get: (h) => h === "Link" ? '<https://canvas.example.edu/api/v1/x?page=n>; rel="next"' : null },
            text: async () => "[1]" }),
    ]});
    const all = await ctx.canvasGetAll("https://canvas.example.edu/api/v1/x", { maxPages: 3 });
    assert.strictEqual(all.length, 3, "should have stopped after 3 pages");
});

test("getAll THROWS on a mid-pagination failure instead of truncating", async () => {
    const ctx = load({ responses: [
        { json: [1, 2], headers: { Link: '<https://canvas.example.edu/api/v1/x?page=2>; rel="next"' } },
        { status: 500, body: "" }, { status: 500, body: "" },
    ]});
    await assert.rejects(() => ctx.canvasGetAll("https://canvas.example.edu/api/v1/x"),
        (e) => e.name === "CanvasApiError",
        "a failure on page 2 must not look like a complete 2-item result");
});

/* ---------------- cache ---------------- */
test("a repeated GET within the TTL is served from cache", async () => {
    const ctx = load({ responses: [{ json: [{ id: 1 }] }] });
    const url = "https://canvas.example.edu/api/v1/users/self/colors";
    await ctx.canvasGet(url);
    await ctx.canvasGet(url);
    await ctx.canvasGet(url);
    assert.strictEqual(ctx.__calls.length, 1, "three calls should have produced one request");
});

test("a failed GET is not cached", async () => {
    const ctx = load({ responses: [{ status: 404, body: "" }, { json: [{ id: 7 }] }] });
    const url = "https://canvas.example.edu/api/v1/x";
    await assert.rejects(() => ctx.canvasGet(url));
    const data = await ctx.canvasGet(url);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(data)), [{ id: 7 }],
        "a rejected response must not poison the cache");
});

/* ---------------- mutate ---------------- */
test("mutate sends the CSRF token", async () => {
    const ctx = load({ responses: [{ json: { id: 1 } }] });
    await ctx.canvasMutate("https://canvas.example.edu/api/v1/planner_notes",
        { bodies: [{ headers: { "content-type": "application/json" }, body: "{}" }] });
    assert.strictEqual(ctx.__calls[0].init.headers["X-CSRF-Token"], "tok");
});

test("mutate falls through body encodings until one is accepted", async () => {
    const ctx = load({ responses: [
        { status: 400, body: "" }, { status: 422, body: "" }, { json: { id: 9 } },
    ]});
    const out = await ctx.canvasMutate("https://canvas.example.edu/api/v1/planner_notes", {
        bodies: [{ body: "a" }, { body: "b" }, { body: "c" }],
    });
    assert.strictEqual(JSON.parse(JSON.stringify(out)).id, 9);
    assert.strictEqual(ctx.__calls.length, 3, "should have tried all three encodings");
    assert.strictEqual(ctx.__calls[2].init.body, "c");
});

test("mutate does NOT keep trying encodings after an auth failure", async () => {
    const ctx = load({ responses: [{ status: 401, body: "" }] });
    await assert.rejects(() => ctx.canvasMutate("https://canvas.example.edu/api/v1/x",
        { bodies: [{ body: "a" }, { body: "b" }, { body: "c" }] }), (e) => e.kind === "auth");
    assert.strictEqual(ctx.__calls.length, 1, "401 means signed out, not wrong encoding");
});

/* ---------------- source assertions ---------------- */
test("no consumer of the promise-typed globals is left without a failure path", () => {
    const c = code();
    const raw = c.match(/(?<!\w)(assignments|grades|cardAssignments)\.then\(/g) || [];
    // preloadAssignmentEls legitimately transforms and propagates; it is not terminal.
    assert.ok(raw.length <= 1,
        `${raw.length} raw .then() consumers remain; they must go through withApiData`);
});

test("preloadAssignmentEls does not swallow rejection in a promise wrapper", () => {
    const c = code();
    const m = /function preloadAssignmentEls\(\)\s*\{[\s\S]*?\n\}/.exec(c);
    assert.ok(m, "preloadAssignmentEls not found");
    assert.ok(!/new Promise\(/.test(m[0]),
        "the new Promise wrapper never called reject(), so a rejected `assignments` " +
        "left the returned promise pending forever");
});

test("the failure path is visible to the user, not console-only", () => {
    const c = code();
    const m = /function showApiError\([\s\S]*?\n\}/.exec(c);
    assert.ok(m, "showApiError not found");
    assert.ok(/ensureInjected|appendChild/.test(m[0]), "showApiError must render something");
    assert.ok(/Retry/.test(m[0]), "the user needs a way to retry without reloading");
});
