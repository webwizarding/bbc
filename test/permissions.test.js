/*
Phase 1.4: narrow host permissions.

The extension used to match every HTTPS origin and inject four scripts at
document_start on every page the user visited. It now ships matching only
Instructure-hosted Canvas, and asks for one host at a time when the user names
their own institution's domain.

The domain input decides where a script carrying the user's Canvas session
runs, so several of these are about validating it at the point of granting --
the third instance of that bug class in Phase 1.

Run: node test/permissions.test.js
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
const manifest = () => JSON.parse(read("manifest.json"));

/** Extract a function by brace matching. A non-greedy regex truncates it at
    the first line-initial "}", which for a function with nested blocks yields
    unbalanced source and a confusing "Unexpected end of input". */
function extractFn(src, name) {
    const re = new RegExp("^(?:async )?function " + name + "\\s*\\(", "m");
    const start = re.exec(src);
    if (!start) return null;
    let depth = 0;
    for (let i = src.indexOf("{", start.index); i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start.index, i + 1); }
    }
    return null;
}

function loadFn(file, name) {
    // Extract from RAW source, not stripped. strip() removes /* ... *​/ blocks
    // with a regex, which also matches the "/*" inside a template literal such
    // as `https://${host}/*` -- it then deletes through to the next "*​/",
    // unbalancing the braces and making the function unextractable.
    const m = [extractFn(read(file), name)];
    assert.ok(m[0], name + " not found in " + file);
    const ctx = { URL, console: { warn() {} } };
    vm.createContext(ctx);
    vm.runInContext(m[0] + `\n;globalThis.__f = ${name};`, ctx);
    return ctx.__f;
}

test("the static content script no longer matches every HTTPS site", () => {
    const m = manifest();
    const matches = m.content_scripts.flatMap(c => c.matches);
    assert.ok(!matches.includes("https://*/*"),
        "injecting into every HTTPS page is a privacy problem, a performance " +
        "problem, and the thing store reviewers push back on");
    assert.deepStrictEqual(matches, ["https://*.instructure.com/*"]);
});

test("broad access is optional, so install asks for nothing extra", () => {
    const m = manifest();
    assert.deepStrictEqual(m.optional_host_permissions, ["https://*/*"]);
    assert.ok(!m.host_permissions, "broad access must not be required at install");
});

test("scripting permission is declared, since registration needs it", () => {
    assert.ok(manifest().permissions.includes("scripting"));
});

test("dynamic registration injects the same files as the static entry", () => {
    // Two lists that must agree. If they drift, a custom domain silently gets a
    // different subset of the extension than an instructure.com one.
    const m = manifest();
    const bg = strip(read("js/background.js"));
    const block = /const ORCA_CONTENT_FILES = \{[\s\S]*?\n\};/.exec(bg);
    assert.ok(block, "ORCA_CONTENT_FILES not found");
    const listed = (block[0].match(/"([^"]+\.(?:js|css))"/g) || []).map(x => x.slice(1, -1));
    const staticFiles = [...m.content_scripts[0].js, ...m.content_scripts[0].css];
    assert.deepStrictEqual(listed.sort(), staticFiles.sort(),
        "the dynamic registration and the manifest entry inject different files");
});

/* ---------------- domain validation ---------------- */
for (const file of ["js/background.js", "js/popup.js"]) {
    const fn = () => loadFn(file, "domainToMatchPattern");

    test(`${file}: a plain hostname becomes an exact origin pattern`, () => {
        assert.strictEqual(fn()("canvas.ucsc.edu"), "https://canvas.ucsc.edu/*");
    });

    test(`${file}: a full URL is reduced to its host`, () => {
        assert.strictEqual(fn()("https://canvas.ucsc.edu/courses/1"), "https://canvas.ucsc.edu/*");
    });

    test(`${file}: a wildcard host is refused`, () => {
        // "*.edu" would grant access to every university in the world.
        assert.strictEqual(fn()("*.edu"), null);
        assert.strictEqual(fn()("https://*/*"), null);
    });

    test(`${file}: a dotless host is refused`, () => {
        // "com" or "localhost" would widen the grant well past what was typed.
        assert.strictEqual(fn()("com"), null);
        assert.strictEqual(fn()("localhost"), null);
    });

    test(`${file}: empty and non-string entries are refused`, () => {
        for (const v of ["", "   ", null, undefined, 42, {}]) {
            assert.strictEqual(fn()(v), null, `${JSON.stringify(v)} should be refused`);
        }
    });

    test(`${file}: the host is lowercased, so grants cannot be duplicated by case`, () => {
        assert.strictEqual(fn()("Canvas.UCSC.edu"), "https://canvas.ucsc.edu/*");
    });
}

/* ---------------- flow ---------------- */
test("access is requested on change, not on every keystroke", () => {
    const pop = strip(read("js/popup.js"));
    assert.ok(/addEventListener\('change', function \(\) \{\s*requestCustomDomainAccess/.test(pop),
        "a permission prompt per keystroke would be unusable");
    const inputHandler = /#customDomain'\)\.addEventListener\('input'[\s\S]*?\n    \}\);/.exec(pop);
    assert.ok(inputHandler && !/permissions\.request/.test(inputHandler[0]),
        "the input handler must not request permission");
});

test("a refusal explains what stops working", () => {
    const fnSrc = /async function requestCustomDomainAccess\([\s\S]*?\n\}/.exec(strip(read("js/popup.js")))[0];
    assert.ok(/displayAlert\(true,/.test(fnSrc), "a refusal must say something");
    assert.ok(/dark mode|to-do list|card styling/.test(fnSrc),
        "the message should name what breaks, not just report failure");
    assert.ok(/settings are saved/.test(fnSrc),
        "the user should know their settings survived the refusal");
});

test("instructure.com domains are not asked for twice", () => {
    for (const f of ["js/popup.js", "js/background.js"]) {
        assert.ok(/instructure\\\.com/.test(read(f)),
            `${f} should skip hosts the static entry already covers`);
    }
});

test("registration re-syncs when the domain list or grants change", () => {
    const bg = strip(read("js/background.js"));
    assert.ok(/storage\.onChanged\.addListener[\s\S]*?custom_domain[\s\S]*?syncDynamicContentScripts/.test(bg),
        "changing the domain should re-register");
    assert.ok(/permissions\.onAdded\.addListener/.test(bg) && /permissions\.onRemoved\.addListener/.test(bg),
        "granting or revoking access should re-register");
    assert.ok(/onStartup\.addListener/.test(bg),
        "registrations do not always survive an update");
});
