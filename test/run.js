/*
Runs every *.test.js in this directory. Dependency-free until Phase 2 picks a
real runner.  Usage: node test/run.js
*/
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort();
let failed = 0;
for (const f of files) {
    try {
        process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" }));
    } catch (e) {
        failed++;
        process.stdout.write(e.stdout || "");
        process.stderr.write(e.stderr || "");
    }
}
console.log(failed === 0 ? `${files.length} file(s), all passed\n` : `${failed} of ${files.length} file(s) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
