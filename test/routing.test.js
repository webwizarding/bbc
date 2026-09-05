/*
Phase 1.1, commit 1: every route test reads the URL live through getRoute().

A stale route read fails silently -- the feature simply does not activate, or
activates on the wrong page -- so these are mostly source assertions. A
behavioural test cannot see the difference between "correctly decided not to
run" and "decided using a path from four navigations ago".

Run: node test/routing.test.js
*/
import { test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import vm from "vm";
import assert from "assert";

const SRC = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../js/content.js"), "utf8").replace(/\r/g, "");

/** Strip comments so source assertions test code, not prose about code. */
function code() {
    return SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("no module-level capture of the path survives", () => {
    const c = code();
    assert.ok(!/^(?:const|let|var)\s+current_page\s*=/m.test(c),
        "current_page is back as a module-level capture");
    assert.ok(!/^(?:const|let|var)\s+\w*(?:path|route)\w*\s*=\s*window\.location\.pathname/mi.test(c),
        "a module-level snapshot of window.location.pathname was reintroduced");
});

test("getRoute is the only reader of window.location.pathname", () => {
    const c = code();
    const hits = c.match(/window\.location\.pathname/g) || [];
    assert.strictEqual(hits.length, 1,
        `expected exactly 1 read (inside getRoute), found ${hits.length}; ` +
        "a second mechanism has been reintroduced");
    // and it must be the one inside getRoute
    const fn = /function getRoute\(\)\s*\{([\s\S]*?)\}/.exec(c);
    assert.ok(fn && /window\.location\.pathname/.test(fn[1]),
        "the single read is not the one inside getRoute()");
});

test("getRoute reads live, it does not cache", () => {
    const m = /function getRoute\(\)\s*\{[\s\S]*?\}/.exec(code());
    const ctx = { window: { location: { pathname: "/" } } };
    vm.createContext(ctx);
    vm.runInContext(m[0], ctx);
    assert.strictEqual(ctx.getRoute(), "/");
    ctx.window.location.pathname = "/courses/123/grades";
    assert.strictEqual(ctx.getRoute(), "/courses/123/grades",
        "getRoute returned a stale value; it must not cache");
    ctx.window.location.pathname = "/courses";
    assert.strictEqual(ctx.getRoute(), "/courses");
});

test("route predicates decide from the live URL", () => {
    const ctx = { window: { location: { pathname: "/" } } };
    vm.createContext(ctx);
    const c = code();
    for (const name of ["getRoute", "isGradesPage", "isCoursesIndexPage", "isProfilePage",
                        "isQuizPage", "getCurrentCourseId"]) {
        const re = new RegExp("^function " + name + "\\s*\\([\\s\\S]*?\\n\\}", "m");
        const m = re.exec(c);
        assert.ok(m, name + " not found");
        vm.runInContext(m[0], ctx);
    }
    const at = (p) => { ctx.window.location.pathname = p; };

    at("/courses/42/grades");
    assert.strictEqual(ctx.isGradesPage(), true, "grades page not detected");
    assert.strictEqual(ctx.getCurrentCourseId(), 42, "course id not read live");

    // Navigate away. Every predicate must change its answer.
    at("/courses");
    assert.strictEqual(ctx.isGradesPage(), false, "isGradesPage stale after navigation");
    assert.strictEqual(ctx.isCoursesIndexPage(), true);
    assert.strictEqual(ctx.getCurrentCourseId(), null, "course id stale after navigation");

    at("/profile/settings");
    assert.strictEqual(ctx.isProfilePage(), true);
    assert.strictEqual(ctx.isCoursesIndexPage(), false);

    at("/courses/7/quizzes/9");
    assert.strictEqual(ctx.isQuizPage(), true);
    assert.strictEqual(ctx.getCurrentCourseId(), 7);
});

test("dev's partial navigation layer is not reintroduced alongside ours", () => {
    const c = code();
    assert.ok(!/function setupNavigationListener/.test(c),
        "setupNavigationListener is back; there must be one navigation mechanism");
});
