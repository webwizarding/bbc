/*
Validate the built extension directories.

Unit tests check the source. These check the artefact: that each target's
manifest parses, that every file it references was actually emitted, that the
background entry is right for that browser, and that source-only files did not
leak into the output.

None of that is visible to a test that reads js/ -- a build script that
silently drops a file produces a green suite and a broken extension.
*/
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const EXPECTED_BACKGROUND = {
    chrome: { required: "service_worker", forbidden: "scripts" },
    firefox: { required: "scripts", forbidden: "service_worker" },
};

for (const target of ["chrome", "firefox"]) {
    const dir = path.join(ROOT, "dist", target);
    const note = (msg) => problems.push(`${target}: ${msg}`);

    let manifest;
    try {
        manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    } catch (e) {
        note(`manifest.json missing or unparseable (${e.message})`);
        continue;
    }

    const { required, forbidden } = EXPECTED_BACKGROUND[target];
    if (!manifest.background?.[required]) note(`background.${required} missing`);
    if (manifest.background?.[forbidden]) {
        note(`background.${forbidden} present; ${target} ignores it and reviewers flag it`);
    }

    const referenced = [
        ...Object.values(manifest.icons ?? {}),
        ...Object.values(manifest.action?.default_icon ?? {}),
        manifest.action?.default_popup,
        manifest.options_page,
        manifest.background?.service_worker,
        ...(manifest.background?.scripts ?? []),
        ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
    ].filter(Boolean);

    for (const rel of new Set(referenced)) {
        try {
            await access(path.join(dir, rel));
        } catch {
            note(`manifest references ${rel}, which was not emitted`);
        }
    }

    // The dark base is registered at runtime, not from the manifest, so nothing
    // above would notice it missing.
    try {
        await access(path.join(dir, "css/darkbase.css"));
    } catch {
        note("css/darkbase.css missing; the pre-paint dark style would 404");
    }

    // Source-only files must not ship.
    for (const rel of ["icon/source.png"]) {
        try {
            await access(path.join(dir, rel));
            note(`${rel} shipped; it is source artwork, not a runtime asset`);
        } catch { /* absent, which is correct */ }
    }

    if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
        note(`version "${manifest.version}" is not semver`);
    }
}

if (problems.length) {
    console.error("\n  dist validation failed:\n" + problems.map((p) => `    ${p}`).join("\n") + "\n");
    process.exit(1);
}
console.log(`  dist/chrome and dist/firefox validated`);
