/*
Port the hand-rolled vm test files to Vitest.

A port, not a rewrite. Every assertion, every helper and every comment is left
exactly as written -- those assertions caught four real defects (an async body
that could not fail, a cross-realm comparison, an overclaiming comment, and a
migration ordering bug), and rewriting them risks losing whichever detail did
the catching.

What changes is only the scaffolding around them:
  - the hand-rolled `test()` / `testAsync()` harness  -> Vitest's `test`
  - CommonJS `require`                                -> ESM `import`
  - the trailing pass/fail tally and `process.exit`   -> removed

The harness's guard against async test bodies is dropped on purpose: it existed
because the hand-rolled runner recorded a pass before an async body's
assertions resolved. Vitest awaits the returned promise, which is the whole
reason for moving.

Run once:  node tools/port-tests-to-vitest.mjs
*/
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "test");

const REQUIRE = /^const (\w+) = require\("([^"]+)"\);$/gm;
const REQUIRE_DESTRUCTURED = /^const \{([^}]+)\} = require\("([^"]+)"\);$/gm;
const REQUIRE_INLINE_PATH = /^const (\w+) = require\(path\.resolve\(__dirname, "([^"]+)"\)\);$/gm;

function port(src, name) {
    let out = src;

    // 1. requires -> imports
    out = out.replace(REQUIRE_INLINE_PATH, (m, id, rel) => `import ${id} from "${rel}";`);
    out = out.replace(REQUIRE_DESTRUCTURED, (m, names, mod) => `import {${names}} from "${mod}";`);
    out = out.replace(REQUIRE, (m, id, mod) => `import ${id} from "${mod}";`);

    // 1b. an inline `...require("x")` inside an object literal. Not matched by
    // the line-anchored patterns above, and it fails at runtime in ESM rather
    // than at parse time -- the spread just yields undefined and the test looks
    // like a behaviour failure.
    out = out.replace(/\.\.\.require\("\.\.\/js\/sanitize\.js"\),/g, "...sanitizers,");
    if (/\.\.\.sanitizers,/.test(out) && !/import \* as sanitizers/.test(out)) {
        out = out.replace(/^import assert from "assert";$/m,
            'import assert from "assert";\nimport * as sanitizers from "../js/sanitize.js";');
    }

    // 2. drop "use strict" -- modules are strict already
    out = out.replace(/^"use strict";\n/m, "");

    // 3. the hand-rolled harness
    out = out.replace(/let failures = 0;\n/, "");
    out = out.replace(
        /function test\(name, fn\) \{[\s\S]*?\n\}\n/,
        ""
    );
    out = out.replace(/const asyncTests = \[\];\n/, "");
    out = out.replace(/(?:const|function) testAsync[^\n]*\n/, "");
    out = out.replace(/^const testAsync = \(name, fn\) => asyncTests\.push\(\[name, fn\]\);\n/m, "");

    // 4. testAsync(...) is just test(...) now
    out = out.replace(/\btestAsync\(/g, "test(");

    // 5. trailing tally / runner
    out = out.replace(/\nconsole\.log\(`\\n\$\{failures === 0[\s\S]*$/, "\n");
    out = out.replace(/\n\(async \(\) => \{[\s\S]*?\}\)\(\);\s*$/, "\n");
    out = out.replace(/\nconsole\.log\(""\);\s*$/, "\n");
    out = out.replace(/^console\.log\("\\n[^"]*\\n"\);\n/m, "");

    // 6. __dirname is not defined in ESM
    if (/__dirname/.test(out)) {
        // The originals used require("path"), not require("node:path"), so
        // match either specifier.
        out = out.replace(
            /^import path from "(node:)?path";$/m,
            (m) => `${m}\nimport { fileURLToPath } from "node:url";`
        );
        out = out.replace(
            /^const ROOT = path\.resolve\(__dirname, "\.\."\);$/m,
            'const __dirname = path.dirname(fileURLToPath(import.meta.url));\nconst ROOT = path.resolve(__dirname, "..");'
        );
        out = out.replace(/path\.resolve\(__dirname, "\.\.\/([^"]+)"\)/g,
            'path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../$1")');
    }

    // 7. the import Vitest needs
    const firstImport = out.search(/^import /m);
    const insertAt = firstImport === -1 ? out.search(/^const /m) : firstImport;
    out = out.slice(0, insertAt) + 'import { test } from "vitest";\n' + out.slice(insertAt);

    return out.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const files = (await readdir(DIR)).filter((f) => f.endsWith(".test.js"));
for (const f of files) {
    const src = await readFile(path.join(DIR, f), "utf8");
    await writeFile(path.join(DIR, f), port(src, f));
    console.log(`  ported ${f}`);
}
console.log(`\n  ${files.length} files ported`);
