/*
Phase 1.3: storage routing, quota handling, coercion, and the sync -> local
migration.

Ten keys that grow with usage lived in chrome.storage.sync (8,192 bytes per
item, 102,400 total) and not one of the 68 storage.set() calls in the codebase
had a rejection handler, so hitting either quota lost data silently.

Run: node test/storage.test.js
*/
import { test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import vm from "vm";
import assert from "assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// The storage layer lives in js/storage.js, shared by the content script and
// the popup. The background worker keeps its own copy of the key list.
const CONTENT = fs.readFileSync(path.join(ROOT, "js/storage.js"), "utf8").replace(/\r/g, "");
const BG = fs.readFileSync(path.join(ROOT, "js/background.js"), "utf8").replace(/\r/g, "");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------ fake chrome.storage with real quota semantics ------------ */
function fakeChrome({ perItem = 8192, total = 102400 } = {}) {
    const mk = (limits) => {
        const data = {};
        return {
            data,
            async get(keys) {
                if (keys === null || keys === undefined) return { ...data };
                const list = Array.isArray(keys) ? keys : [keys];
                const out = {};
                for (const k of list) if (k in data) out[k] = data[k];
                return out;
            },
            async set(items) {
                if (limits) {
                    for (const [k, v] of Object.entries(items)) {
                        if (JSON.stringify(v).length > limits.perItem) {
                            throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded for '${k}'`);
                        }
                    }
                    const merged = { ...data, ...items };
                    if (JSON.stringify(merged).length > limits.total) {
                        throw new Error("QUOTA_BYTES quota exceeded");
                    }
                }
                Object.assign(data, items);
            },
            async remove(keys) {
                for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k];
            },
        };
    };
    return { storage: { sync: mk({ perItem, total }), local: mk(null) }, runtime: { lastError: null } };
}

function loadStorage(chrome) {
    const c = strip(CONTENT);
    const pieces = [];
    for (const re of [
        /^const ORCA_LOCAL_KEYS = new Set\(\[[\s\S]*?\]\);/m,
        /^const ORCA_STORAGE_VERSION = \d+;/m,
        /^const ORCA_LOCAL_KEY_PREFIXES = \[[\s\S]*?\];/m,
        /^function storageAreaFor\([\s\S]*?\n\}/m,
        /^function splitByArea\([\s\S]*?\n\}/m,
        /^const ORCA_NUMERIC_KEYS = new Set\(\[[\s\S]*?\]\);/m,
        /^const ORCA_ENUM_KEYS = \{[\s\S]*?\n\};/m,
        /^function coerceStoredValue\([\s\S]*?\n\}/m,
        /^function coerceStoredValues\([\s\S]*?\n\}/m,
        /^let quotaNoticeShown = false;/m,
        /^function reportStorageFailure\([\s\S]*?\n\}/m,
        /^function storageSet\([\s\S]*?\n\}/m,
        /^function storageGet\([\s\S]*?\n\}/m,
        /^function storageGetAll\([\s\S]*?\n\}/m,
        /^function storageRemove\([\s\S]*?\n\}/m,
        /^const orcaStorage = \{[\s\S]*?\n\};/m,
    ]) {
        const m = re.exec(c);
        assert.ok(m, "could not extract " + re);
        pieces.push(m[0]);
    }
    const notices = [];
    const ctx = {
        chrome, console: { warn() {}, log() {} }, Promise, Object, Array, JSON, Number, Set,
        showApiError: (e, o) => notices.push({ e, o }),
        CanvasApiError: class extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } },
    };
    vm.createContext(ctx);
    vm.runInContext(pieces.join("\n"), ctx);
    ctx.__notices = notices;
    return ctx;
}

function loadMigration(chrome) {
    const b = strip(BG);
    const pieces = [
        /^const ORCA_LOCAL_KEYS = \[[\s\S]*?\];/m.exec(b)[0],
        /^const ORCA_STORAGE_VERSION = \d+;/m.exec(b)[0],
        /^async function migrateStorage\(\)[\s\S]*?\n\}/m.exec(b)[0],
    ];
    const ctx = { chrome, console: { warn() {}, log() {} }, Promise, Object };
    vm.createContext(ctx);
    vm.runInContext(pieces.join("\n"), ctx);
    return ctx;
}

/* ---------------- routing ---------------- */
test("keys that grow with usage route to local", () => {
    const ctx = loadStorage(fakeChrome());
    for (const k of ["custom_cards", "custom_cards_2", "custom_cards_3", "assignment_states",
                     "assignments_done", "custom_assignments", "custom_task_links", "reminders",
                     "custom_styles", "dashboard_notes_text", "dark_mode_fix"]) {
        assert.strictEqual(ctx.storageAreaFor(k), "local", `${k} should be local`);
    }
});

test("small portable preferences stay in sync", () => {
    const ctx = loadStorage(fakeChrome());
    for (const k of ["dark_mode", "gpa_calc", "better_todo", "cardWidth", "custom_font", "dark_preset"]) {
        assert.strictEqual(ctx.storageAreaFor(k), "sync", `${k} should be sync`);
    }
});

test("an unknown key defaults to sync", () => {
    const ctx = loadStorage(fakeChrome());
    assert.strictEqual(ctx.storageAreaFor("some_future_toggle"), "sync");
});

test("the content and background key lists agree", () => {
    const a = /^const ORCA_LOCAL_KEYS = new Set\(\[([\s\S]*?)\]\);/m.exec(strip(CONTENT))[1];
    const b = /^const ORCA_LOCAL_KEYS = \[([\s\S]*?)\];/m.exec(strip(BG))[1];
    const keys = (t) => new Set((t.match(/"([^"]+)"/g) || []).map(x => x.slice(1, -1)));
    const A = keys(a), B = keys(b);
    assert.deepStrictEqual([...A].sort(), [...B].sort(),
        "the migration would move a different set of keys than the runtime reads from");
});

test("no key that was in local before the refactor now routes to sync", () => {
    // Routing by key means a key not named anywhere silently defaults to sync.
    // Several keys were already in chrome.storage.local before this layer
    // existed -- per-course grade-analytics state, cached daily images,
    // per-mode sidebar state -- and moving those INTO sync would be the exact
    // opposite of what 1.3 is for. Derived from the previous revision rather
    // than hand-listed.
    const ctx = loadStorage(fakeChrome());
    const previouslyLocal = [
        "previous_colors", "previous_theme", "errors",
        "quiz_safe_mode_reminder_dismissed",
        "grade_analytics_open", "grade_analytics_fit_y", "grade_analytics_final_12345",
        "better_sidebar_expanded_dash", "better_sidebar_expanded_course",
        "picsum_daily_2026-09-01", "nasa_apod_2026-09-01", "nasa_apod_meta_2026-09-01",
        "orca_global_search_index",
    ];
    const regressed = previouslyLocal.filter(k => ctx.storageAreaFor(k) !== "local");
    assert.deepStrictEqual(regressed, [],
        `these were in local and would now be written to sync: ${regressed.join(", ")}`);
});

test("prefix routing covers keys generated per course", () => {
    const ctx = loadStorage(fakeChrome());
    for (let id = 1; id <= 5; id++) {
        assert.strictEqual(ctx.storageAreaFor(`grade_analytics_final_${id}`), "local",
            "per-course keys grow with the number of courses and must not use sync");
    }
});

/* ---------------- writes ---------------- */
test("a write splits across areas by key", async () => {
    const chrome = fakeChrome();
    const ctx = loadStorage(chrome);
    await ctx.storageSet({ dark_mode: true, custom_cards: { 1: { img: "x" } } });
    assert.deepStrictEqual(Object.keys(chrome.storage.sync.data), ["dark_mode"]);
    assert.deepStrictEqual(Object.keys(chrome.storage.local.data), ["custom_cards"]);
});

test("a per-item quota rejection is reported, not swallowed", async () => {
    const chrome = fakeChrome({ perItem: 50 });
    const ctx = loadStorage(chrome);
    await assert.rejects(() => ctx.storageSet({ dark_preset: { a: "x".repeat(200) } }));
    assert.strictEqual(ctx.__notices.length, 1, "the user should be told storage is full");
    assert.match(ctx.__notices[0].o.feature, /storage is full/i);
});

test("the quota notice is shown once, not per failed write", async () => {
    const chrome = fakeChrome({ perItem: 50 });
    const ctx = loadStorage(chrome);
    for (let i = 0; i < 5; i++) {
        await ctx.storageSet({ dark_preset: { a: "x".repeat(200) } }).catch(() => {});
    }
    assert.strictEqual(ctx.__notices.length, 1, "repeating the notice would bury the page");
});

test("bulk data no longer competes for the sync quota", async () => {
    const chrome = fakeChrome({ perItem: 8192, total: 102400 });
    const ctx = loadStorage(chrome);
    // A card set well past the whole sync budget.
    const cards = {};
    for (let i = 0; i < 400; i++) cards[i] = { img: "https://example.com/" + "x".repeat(200), name: "course " + i };
    await ctx.storageSet({ custom_cards: cards });
    assert.ok(JSON.stringify(cards).length > 102400, "fixture should exceed the sync total");
    assert.ok(chrome.storage.local.data.custom_cards, "should have landed in local");
    assert.strictEqual(ctx.__notices.length, 0, "no quota failure should have occurred");
});

/* ---------------- coercion (issue #12) ---------------- */
test("numeric values stored as strings are coerced", () => {
    const ctx = loadStorage(fakeChrome());
    assert.strictEqual(ctx.coerceStoredValue("cardRoundness", "15"), 15);
    assert.strictEqual(ctx.coerceStoredValue("cardSpacing", "-15"), -15);
    assert.strictEqual(ctx.coerceStoredValue("cardWidth", 262), 262);
    assert.strictEqual(ctx.coerceStoredValue("cardHeight", "250"), 250,
        "a string height fails `!== 250` comparisons and silently skips card sizing");
});

test("a non-numeric value for a numeric key is dropped, not stored as NaN", () => {
    const ctx = loadStorage(fakeChrome());
    assert.strictEqual(ctx.coerceStoredValue("cardWidth", "wide"), undefined);
    assert.deepStrictEqual({ ...ctx.coerceStoredValues({ cardWidth: "wide", dark_mode: true }) },
        { dark_mode: true });
});

test("a boolean where a mode string is expected falls back to the default", () => {
    const ctx = loadStorage(fakeChrome());
    assert.strictEqual(ctx.coerceStoredValue("todo_progress_rings", true), "rings",
        "older profiles stored true here; the code expects a mode string");
    assert.strictEqual(ctx.coerceStoredValue("todo_progress_rings", "lines"), "lines");
    assert.strictEqual(ctx.coerceStoredValue("todo_timeframe", "week"), "week");
    assert.strictEqual(ctx.coerceStoredValue("todo_timeframe", 7), "all");
});

test("coercion applies on write, so a drifted value is corrected once", async () => {
    const chrome = fakeChrome();
    const ctx = loadStorage(chrome);
    await ctx.storageSet({ cardHeight: "250", todo_progress_rings: true });
    assert.strictEqual(chrome.storage.sync.data.cardHeight, 250);
    assert.strictEqual(chrome.storage.sync.data.todo_progress_rings, "rings");
});

test("coercion applies on read, for values written before this landed", async () => {
    const chrome = fakeChrome();
    const ctx = loadStorage(chrome);
    chrome.storage.sync.data.cardWidth = "262";       // written by an older version
    const got = await ctx.storageGet(["cardWidth"]);
    assert.strictEqual(got.cardWidth, 262);
});

test("no default is seeded into sync if its key belongs in local", () => {
    // default_options.sync still declares the bulk keys, because that block is
    // also the popup's fallback source. Seeding them into sync would recreate
    // the exact condition the migration undoes, on every fresh install.
    const b = strip(BG);
    const local = new Set((/const ORCA_LOCAL_KEYS = \[([\s\S]*?)\];/.exec(b)[1].match(/"([^"]+)"/g) || [])
        .map(x => x.slice(1, -1)));
    const seedBlock = /for \(const key of ORCA_LOCAL_KEYS\) \{[\s\S]*?delete newSyncOptions\[key\];[\s\S]{0,40}?\}/.exec(b);
    assert.ok(seedBlock, "seeding does not route by key; bulk defaults would land in sync");
    assert.ok(/newLocalOptions\[key\] = newSyncOptions\[key\]/.test(seedBlock[0]) &&
              /delete newSyncOptions\[key\]/.test(seedBlock[0]),
        "a key moved to local must also be removed from the sync batch");
    assert.ok(local.size >= 10, "sanity: the local key list should be non-trivial");
});

/* ---------------- migration, against a seeded profile ---------------- */
test("migration moves bulk keys from sync to local and clears sync", async () => {
    const chrome = fakeChrome();
    // Seed a profile as an existing user would have it: everything in sync.
    Object.assign(chrome.storage.sync.data, {
        dark_mode: true, gpa_calc: false, cardWidth: 262,
        custom_cards: { 101: { img: "a.gif" }, 102: { img: "b.gif" } },
        assignment_states: { 5: { rem: true } },
        custom_task_links: { 9: "https://example.com" },
        reminders: [{ t: "essay" }],
        custom_styles: ".x{}",
    });
    const ctx = loadMigration(chrome);
    const res = await ctx.migrateStorage();

    assert.deepStrictEqual(res.migrated.sort(),
        ["assignment_states", "custom_cards", "custom_styles", "custom_task_links", "reminders"]);
    // moved
    assert.deepStrictEqual(chrome.storage.local.data.custom_cards, { 101: { img: "a.gif" }, 102: { img: "b.gif" } });
    assert.deepStrictEqual(chrome.storage.local.data.reminders, [{ t: "essay" }]);
    // removed from sync
    for (const k of ["custom_cards", "assignment_states", "custom_task_links", "reminders", "custom_styles"]) {
        assert.ok(!(k in chrome.storage.sync.data), `${k} should have been removed from sync`);
    }
    // preferences untouched
    assert.strictEqual(chrome.storage.sync.data.dark_mode, true);
    assert.strictEqual(chrome.storage.sync.data.cardWidth, 262);
});

test("migration is idempotent", async () => {
    const chrome = fakeChrome();
    chrome.storage.sync.data.custom_cards = { 1: { img: "a" } };
    const ctx = loadMigration(chrome);
    await ctx.migrateStorage();
    chrome.storage.local.data.custom_cards = { 1: { img: "CHANGED" } };
    const second = await ctx.migrateStorage();
    assert.strictEqual(second.skipped, true, "should not run twice");
    assert.deepStrictEqual(chrome.storage.local.data.custom_cards, { 1: { img: "CHANGED" } },
        "a second run must not overwrite newer local data");
});

test("an existing local value wins over a stale sync copy", async () => {
    const chrome = fakeChrome();
    chrome.storage.sync.data.custom_cards = { 1: { img: "OLD" } };
    chrome.storage.local.data.custom_cards = { 1: { img: "NEW" } };
    const ctx = loadMigration(chrome);
    await ctx.migrateStorage();
    assert.deepStrictEqual(chrome.storage.local.data.custom_cards, { 1: { img: "NEW" } });
});

test("sync copies survive if the local write fails", async () => {
    const chrome = fakeChrome();
    chrome.storage.sync.data.custom_cards = { 1: { img: "a" } };
    chrome.storage.local.set = async () => { throw new Error("disk full"); };
    const ctx = loadMigration(chrome);
    await ctx.migrateStorage().catch(() => {});
    assert.ok("custom_cards" in chrome.storage.sync.data,
        "sync must not be cleared until the local write is verified");
});

test("the version marker is not written when the move fails", async () => {
    // The marker must be written last. If it is written first, a failure
    // anywhere in the move leaves the marker set, every later run skips, and
    // the data is stranded in sync forever.
    //
    // Failing the marker's own write cannot detect this -- the marker is
    // absent either way -- so this fails a step that only happens *after* the
    // marker would have been written under the wrong ordering.
    const chrome = fakeChrome();
    chrome.storage.sync.data.custom_cards = { 1: { img: "a" } };
    chrome.storage.sync.remove = async () => { throw new Error("interrupted"); };
    const ctx = loadMigration(chrome);
    await ctx.migrateStorage().catch(() => {});
    assert.ok(!(chrome.storage.local.data.orca_storage_version >= 1),
        "the version marker was written despite the move failing; every later " +
        "run will skip and the data is stranded in sync");
});

test("a migration that failed part-way runs again next start", async () => {
    const chrome = fakeChrome();
    chrome.storage.sync.data.custom_cards = { 1: { img: "a" } };
    const realRemove = chrome.storage.sync.remove.bind(chrome.storage.sync);
    chrome.storage.sync.remove = async () => { throw new Error("interrupted"); };
    const ctx = loadMigration(chrome);
    await ctx.migrateStorage().catch(() => {});
    chrome.storage.sync.remove = realRemove;
    const again = await ctx.migrateStorage();
    assert.notStrictEqual(again.skipped, true, "a retry should actually run");
    assert.ok(!("custom_cards" in chrome.storage.sync.data), "the retry should complete the move");
});
