/*
Mutation check runner.

Contributing notes require every test to be mutation-checked: write the test,
revert the fix, confirm red, restore. This runs that as a batch so it can be
repeated -- after porting the suite to a new runner, after a refactor, or in
CI on demand.

A mutation that does NOT turn the suite red is reported as a failure of the
check, not ignored. It means either the reverted code is dead or the test is
hollow, and both have happened in this repository.

Usage:
  node tools/mutate.mjs           run every mutation
  node tools/mutate.mjs routing   run those whose id contains "routing"
*/
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each mutation names the defect it re-introduces, so a failure reads as
 * "this protection is no longer tested" rather than "string not found".
 */
const MUTATIONS = [
    { id: "routing/stale-capture", file: "js/content.js",
      from: "function getRoute() {\n    return window.location.pathname;\n}",
      to: "const _cp = window.location.pathname;\nfunction getRoute() {\n    return _cp;\n}" },

    { id: "routing/second-reader", file: "js/content.js",
      from: "    return /^\\/courses\\/\\d+\\/grades(?:\\/|$)/.test(getRoute());",
      to: "    return /^\\/courses\\/\\d+\\/grades(?:\\/|$)/.test(window.location.pathname);" },

    { id: "lifecycle/unreachable-observer", file: "js/content.js",
      from: '    registerReconciler("footer", removeFooter);',
      to: '    const footerObserver = new MutationObserver(removeFooter);\n    footerObserver.observe(document.documentElement, { childList: true, subtree: true });' },

    { id: "lifecycle/discarded-interval", file: "js/content.js",
      from: '        registerInterval("reminderWatch", reminderWatch, 60000, "document");',
      to: "        setInterval(reminderWatch, 60000);" },

    { id: "route-cycle/reapply-first", file: "js/content.js",
      from: "    teardownRoute();\n    applyRoute();",
      to: "    applyRoute();\n    teardownRoute();" },

    { id: "route-cycle/dark-mode-reapplied", file: "js/content.js",
      from: "    try { checkDashboardReady(); } catch (e) { logError(e); }",
      to: "    try { toggleDarkMode(); } catch (e) { logError(e); }\n    try { checkDashboardReady(); } catch (e) { logError(e); }" },

    { id: "api/link-regex", file: "js/content.js",
      from: "    const next = parseLinkHeader(linkHeader).next;",
      to: '    const _m = linkHeader && linkHeader.match(/<([^>]+)>;\\s*rel="next"/);\n    const next = _m ? _m[1] : null;' },

    { id: "api/cross-origin-pagination", file: "js/content.js",
      from: "    if (parsed.origin !== expectedOrigin) {",
      to: "    if (false) {" },

    { id: "api/no-ok-check", file: "js/content.js",
      from: "    if (!response.ok) {",
      to: "    if (false) {" },

    { id: "storage/bulk-to-sync", file: "js/storage.js",
      from: '    "custom_cards", "custom_cards_2", "custom_cards_3",',
      to: "" },

    { id: "storage/swallow-quota", file: "js/storage.js",
      from: "            .catch(e => { reportStorageFailure(area, Object.keys(batch), e); throw e; })",
      to: "            .catch(() => {})" },

    { id: "storage/no-coercion", file: "js/storage.js",
      from: "    const batches = splitByArea(coerceStoredValues(items));",
      to: "    const batches = splitByArea(items);" },

    { id: "defaults/typo-returns", file: "js/defaults.js",
      from: '"gradient_cards": false,', to: '"gradent_cards": false,' },

    { id: "defaults/popup-own-copy", file: "js/popup.js",
      from: "const defaultOptions = ORCA_DEFAULTS;",
      to: "const defaultOptions = { sync: {}, local: {} };" },

    { id: "permissions/broad-match", file: "manifest.json",
      from: '"https://*.instructure.com/*"', to: '"https://*/*"' },

    { id: "permissions/wildcard-host", file: "js/background.js",
      from: '    if (!host.includes(".") || host.includes("*")) return null;\r\n', to: "" },

    { id: "sanitize/font-unchecked", file: "js/content.js",
      from: "const family = sanitizeFontFamily(options.custom_font.family);",
      to: "const family = options.custom_font.family;" },

    { id: "sanitize/breakout-backstop", file: "js/sanitize.js",
      from: "const ORCA_CSS_BREAKOUT = /[;{}<>\\\\]|@import|expression\\s*\\(/i;",
      to: "const ORCA_CSS_BREAKOUT = /$^/;" },

    { id: "a11y/failing-link-colour", file: "js/content.js",
      from: '"links": "#26538e",', to: '"links": "#418df1",' },

    { id: "a11y/no-keydown", file: "js/content.js",
      from: '        el.addEventListener("keydown", (e) => {',
      to: '        if (false) el.addEventListener("keydown", (e) => {' },

    { id: "misc/hardcoded-demo-key", file: "js/background.js",
      from: '    const key = (typeof nasa_api_key === "string" && nasa_api_key.trim()) || "DEMO_KEY";',
      to: '    const key = "DEMO_KEY";' },

    { id: "misc/dark-base-not-removed", file: "js/background.js",
      from: "            await chrome.scripting.unregisterContentScripts({ ids: [ORCA_DARK_BASE_ID] }).catch(() => {});\r\n",
      to: "" },

    { id: "promise/new-promise-wrapper", file: "js/popup.js",
      from: "    let tabs;", to: "    let tabs; const _u = new Promise(() => {});" },

    { id: "settle/guessed-delay", file: "js/content.js",
      from: "        whenSettled(() => runDarkModeFixer(false));",
      to: "        setTimeout(() => runDarkModeFixer(false), 800);" },

    { id: "theme/empty-array-guard", file: "js/popup.js",
      from: "                        const live = sync[\"custom_cards\"] || {};",
      to: "                        const live = sync[\"custom_cards\"] || {};\n                        if (theme[\"custom_cards\"].length === 0) break;" },

    { id: "theme/card-image-not-restored", file: "js/content.js",
      from: '                    container.dataset.orcaCardImage = existing ? "reused" : "created";',
      to: '                    container.dataset.orcaCardImage = "reused";' },

    { id: "grades/nth-child-enumeration", file: "css/content.css",
      from: "    #grades_summary { table-layout: fixed; width: 100%; }",
      to: "    #grades_summary { table-layout: fixed; width: 100%; }\n    #grades_summary thead th:nth-child(2) { width: 12%; }" },
];

const filter = process.argv[2];
const selected = filter ? MUTATIONS.filter((m) => m.id.includes(filter)) : MUTATIONS;

async function suitePasses() {
    try {
        // The local binary directly, not npx: resolution overhead dominates
        // when the suite is run once per mutation.
        await run(path.join(ROOT, "node_modules/.bin/vitest"),
            ["run", "--reporter=dot"], { cwd: ROOT, timeout: 180000 });
        return true;
    } catch {
        return false;
    }
}

console.log(`\nmutation check: ${selected.length} mutation(s)\n`);

let survived = 0;
let notApplied = 0;
for (const m of selected) {
    const abs = path.join(ROOT, m.file);
    const original = await readFile(abs, "utf8");
    if (!original.includes(m.from)) {
        console.log(`  SKIP  ${m.id}\n        anchor not found in ${m.file}; the code moved and this ` +
                    `mutation no longer reverts anything`);
        notApplied++;
        continue;
    }
    await writeFile(abs, original.replace(m.from, m.to));
    let passed;
    try {
        passed = await suitePasses();
    } finally {
        await writeFile(abs, original);
    }
    if (passed) {
        survived++;
        console.log(`  SURVIVED  ${m.id}\n            the suite still passes with this defect ` +
                    `re-introduced -- the code is dead or the test is hollow`);
    } else {
        console.log(`  killed    ${m.id}`);
    }
}

const bad = survived + notApplied;
console.log(`\n  ${selected.length - bad}/${selected.length} killed` +
            (survived ? `, ${survived} SURVIVED` : "") +
            (notApplied ? `, ${notApplied} not applicable` : "") + "\n");
process.exit(bad === 0 ? 0 : 1);
