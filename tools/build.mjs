/*
Build for Orca for Canvas.

Produces a loadable, MV3-valid extension directory per target:

  dist/chrome    background.service_worker, no background.scripts
  dist/firefox   background.scripts, no service_worker

The two differ only in the background entry, but shipping a manifest that
declares both means every store review sees a key its browser ignores, and
Firefox in particular warns about it. Splitting here keeps one source manifest
and produces one correct manifest each.

Deliberately not a bundler for the content scripts. They are plain scripts
loaded in order by the manifest and they share a global scope; bundling them
into modules is the Phase 2 split, not the build step. Until then the build
copies, and esbuild is used only to minify for release. That keeps `npm run
dev` as fast as the no-build setup it replaces.

Usage:
  node tools/build.mjs                 both targets, unminified, with sourcemaps
  node tools/build.mjs --target=chrome  one target
  node tools/build.mjs --release        minified, no sourcemaps
  node tools/build.mjs --watch          rebuild on change
*/
import { build as esbuild } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const RELEASE = flag("release");
const WATCH = flag("watch");
const TARGETS = opt("target", "chrome,firefox").split(",").filter(Boolean);

/** Everything the extension ships, relative to the repo root. */
const COPY = ["icon", "_locales", "html", "css", "js"];
/** Source-only files that must not ship. */
const EXCLUDE = new Set(["icon/source.png"]);

async function collect(dir, into = []) {
    for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, entry.name);
        if (EXCLUDE.has(rel)) continue;
        if (entry.isDirectory()) await collect(rel, into);
        else into.push(rel);
    }
    return into;
}

/**
 * One manifest per target.
 *
 * Chrome ignores background.scripts and Firefox ignores service_worker, so a
 * combined manifest is always half-wrong for whoever is reading it.
 */
function manifestFor(base, target) {
    const m = structuredClone(base);
    if (target === "chrome") {
        delete m.background.scripts;
    } else {
        delete m.background.service_worker;
        // Firefox rejects an id it cannot parse, and warns on unknown keys.
        m.background.type = "module" in m.background ? m.background.type : undefined;
        if (m.background.type === undefined) delete m.background.type;
    }
    return m;
}

async function buildTarget(target) {
    const out = path.join(DIST, target);
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });

    const files = [];
    for (const dir of COPY) files.push(...(await collect(dir)));

    for (const rel of files) {
        const src = path.join(ROOT, rel);
        const dest = path.join(out, rel);
        await mkdir(path.dirname(dest), { recursive: true });
        if (RELEASE && rel.endsWith(".js")) {
            const result = await esbuild({
                entryPoints: [src],
                bundle: false,
                minify: true,
                // Classic scripts sharing one global scope. Bundling or
                // wrapping them would break that until the Phase 2 split.
                format: "iife",
                write: false,
                legalComments: "none",
                target: ["chrome109", "firefox109"],
            });
            await writeFile(dest, result.outputFiles[0].contents);
        } else if (RELEASE && rel.endsWith(".css")) {
            const result = await esbuild({
                entryPoints: [src], minify: true, write: false, loader: { ".css": "css" },
            });
            await writeFile(dest, result.outputFiles[0].contents);
        } else {
            await cp(src, dest);
        }
    }

    const base = JSON.parse(await readFile(path.join(ROOT, "manifest.json"), "utf8"));
    await writeFile(path.join(out, "manifest.json"),
        JSON.stringify(manifestFor(base, target), null, RELEASE ? 0 : 2) + "\n");

    let bytes = 0;
    for (const rel of files) bytes += (await stat(path.join(out, rel))).size;
    return { target, files: files.length, bytes };
}

async function runOnce() {
    const results = [];
    for (const t of TARGETS) results.push(await buildTarget(t));
    for (const r of results) {
        console.log(`  dist/${r.target.padEnd(8)} ${String(r.files).padStart(3)} files  ` +
                    `${(r.bytes / 1024).toFixed(0).padStart(5)} KiB${RELEASE ? "  (minified)" : ""}`);
    }
}

await runOnce();

if (WATCH) {
    const { watch } = await import("node:fs");
    let timer = null;
    const rebuild = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            runOnce().then(() => console.log("  rebuilt " + new Date().toLocaleTimeString()))
                     .catch((e) => console.error("  build failed:", e.message));
        }, 80);
    };
    for (const dir of [...COPY, "."]) {
        if (!existsSync(path.join(ROOT, dir))) continue;
        watch(path.join(ROOT, dir), { recursive: dir !== "." }, rebuild);
    }
    console.log("  watching for changes; ctrl-c to stop");
}
