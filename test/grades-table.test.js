/*
The grades-table layout override.

Inherited from upstream dev (9ab7d16, "light mode fixes"), unreviewed at merge
time. It forced table-layout:fixed at every viewport width with hand-enumerated
percentage column widths, which made the Due and Submitted dates collide.

Two enumerations, both incomplete, both silent when wrong -- so these are
source assertions.

Run: node test/grades-table.test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const CSS = fs.readFileSync(path.resolve(__dirname, "../css/content.css"), "utf8").replace(/\r/g, "");
const code = () => CSS.replace(/\/\*[\s\S]*?\*\//g, "");

let failures = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") throw new Error("test body must be synchronous");
        console.log(`  PASS  ${name}`);
    } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

console.log("\ngrades table layout\n");

test("no positional column-width enumeration", () => {
    const c = code();
    const hits = c.match(/#grades_summary\s+thead\s+th:nth-child\(\d+\)/g) || [];
    assert.strictEqual(hits.length, 0,
        `${hits.length} nth-child width rule(s) remain. These name a fixed column ` +
        "order including the newer asset-processors column; on an instance without " +
        "it, every width from the sixth onwards lands on the wrong column.");
});

test("wrapping is not restricted to an enumerated set of cells", () => {
    const c = code();
    // The old form listed td.due, td.assignment_score, td.details and missed
    // the Submitted cell, which stayed nowrap inside a constrained column.
    const enumerated = /#grades_summary\s+td\.\w+\s*,\s*\n?\s*#grades_summary\s+td\.\w+/.test(c);
    assert.ok(!enumerated,
        "wrapping is applied to a hand-listed set of cells again; the previous " +
        "list missed td.submitted, which is what overlapped");
    assert.ok(/#grades_summary\s+td\s*\{[^}]*white-space:\s*normal/.test(c) ||
              /#grades_summary\s+th,\s*\n?\s*#grades_summary\s+td\s*\{[^}]*white-space:\s*normal/.test(c),
        "every grades cell should be allowed to wrap, not a named subset");
});

test("table-layout:fixed is scoped to narrow viewports", () => {
    const c = code();
    const idx = c.indexOf("table-layout: fixed");
    assert.ok(idx > 0, "the narrow-window override is missing entirely");
    // Walk back to find the enclosing at-rule.
    const before = c.slice(0, idx);
    const lastMedia = before.lastIndexOf("@media");
    const lastClose = before.lastIndexOf("}");
    assert.ok(lastMedia > lastClose,
        "table-layout:fixed is applied at every width. Constraining columns " +
        "Canvas had sized to their content is what made Due and Submitted collide; " +
        "the override belongs only below Canvas' ~780px layout floor.");
});

test("the override still exists for narrow windows", () => {
    const c = code();
    assert.ok(/@media\s*\(max-width:\s*\d+px\)\s*\{[\s\S]*?#grades_summary/.test(c),
        "the narrow-window fix was removed rather than scoped; Canvas overflows " +
        "the page below ~780px without it");
});

console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
