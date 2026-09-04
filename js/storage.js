/*
Orca for Canvas - shared storage layer.

Loaded before content.js as a content script, and by popup.html before
popup.js, so both use one implementation rather than a copy each. The
background service worker keeps its own copy of the key list for the
migration, because it runs in a separate context with no shared script; a test
asserts the two lists agree.

Exposes: orcaStorage, storageAreaFor, coerceStoredValue, coerceStoredValues.
*/
// ===========================================================================
// orcaStorage
//
// chrome.storage.sync allows 8,192 bytes per item and 102,400 bytes in total.
// Ten keys grow without bound as the extension is used -- per-course card
// state, per-assignment completion state, custom tasks, reminders, note text,
// user CSS -- and every one of them lived in sync. Not one of the 68
// storage.set() calls across the codebase had a rejection handler, so hitting
// either quota lost data silently.
//
// The fix is not 68 catch blocks. Writes go through this module, which decides
// the area from the key, reports quota failures once and visibly, and coerces
// values on the way in and out. A list of unguarded writes is a list nobody
// should be maintaining.
// ===========================================================================

// Keys that grow with usage, or that are large and not meaningfully portable
// between profiles. These live in chrome.storage.local, which has no per-item
// limit and a far larger total.
//
// Everything not named here goes to sync. That direction is deliberate: a new
// preference is small and portable by default, and the failure mode of getting
// it wrong is a wasted sync byte rather than silent data loss. A new key that
// grows must be added here, which is the one enumeration this module keeps --
// it cannot be derived, because whether a key grows is a fact about how the
// feature uses it, not about the value.
const ORCA_LOCAL_KEYS = new Set([
    "custom_cards", "custom_cards_2", "custom_cards_3",
    "assignments_done", "assignment_states", "custom_assignments",
    "custom_task_links", "reminders", "dark_mode_fix",
    "custom_styles", "dashboard_notes_text",
    "previous_colors", "previous_theme", "errors",
    "saved_themes", "liked_themes",
]);

const ORCA_STORAGE_VERSION = 1;

// Key families that are generated at runtime, so they cannot be listed
// individually: cached images by date, per-course calculator state, per-mode
// sidebar state. Prefix matching keeps them out of sync without requiring the
// set to be known ahead of time -- which matters most for the per-course ones,
// where the number of keys grows with the number of courses.
const ORCA_LOCAL_KEY_PREFIXES = [
    "picsum_daily_",
    "nasa_apod_",
    "grade_analytics_",
    "better_sidebar_expanded_",
    "orca_global_search_",
    "quiz_safe_mode_reminder_",
    // Covers the chunked custom_assignments_2.. keys and the
    // custom_assignments_overflow index that names them. Index and data must
    // share an area or they can disagree across profiles.
    "custom_assignments",
];

function storageAreaFor(key) {
    if (ORCA_LOCAL_KEYS.has(key)) return "local";
    for (const prefix of ORCA_LOCAL_KEY_PREFIXES) {
        if (typeof key === "string" && key.startsWith(prefix)) return "local";
    }
    return "sync";
}

/**
 * Split a { key: value } object into per-area batches.
 * Returns { sync: {...}, local: {...} }, omitting empty areas.
 */
function splitByArea(items) {
    const out = { sync: {}, local: {} };
    for (const [k, v] of Object.entries(items)) out[storageAreaFor(k)][k] = v;
    if (!Object.keys(out.sync).length) delete out.sync;
    if (!Object.keys(out.local).length) delete out.local;
    return out;
}

let quotaNoticeShown = false;

function reportStorageFailure(area, keys, error) {
    const message = String(error && error.message ? error.message : error || "");
    const isQuota = /QUOTA|quota/.test(message);
    console.warn(`[Orca] storage.${area} write failed for [${keys.join(", ")}]:`, message);
    if (!isQuota || quotaNoticeShown) return;
    quotaNoticeShown = true;
    // Shown once. Repeating it per failed write would bury the page in notices
    // exactly when something is already wrong.
    //
    // This file loads in two contexts. In a content script the notice UI from
    // content.js is available; in the popup it is not, so fall back to a
    // console warning rather than throwing a ReferenceError on top of the
    // failure we are trying to report.
    if (typeof showApiError === "function" && typeof CanvasApiError === "function") {
        showApiError(
            new CanvasApiError("http", message),
            { feature: "Settings could not be saved (browser storage is full)" });
    } else {
        console.warn("[Orca] browser storage is full; settings could not be saved.");
    }
}

/**
 * Write values, routing each key to its area. Always returns a promise, and
 * always reports a rejection rather than dropping it.
 */
function storageSet(items) {
    // Normalise on write as well as read, so a value that arrives from a theme
    // import or an older profile is corrected once rather than re-coerced on
    // every read for the life of the install.
    const batches = splitByArea(coerceStoredValues(items));
    return Promise.all(Object.entries(batches).map(([area, batch]) =>
        Promise.resolve()
            .then(() => chrome.storage[area].set(batch))
            .then(() => {
                // Firefox and Chrome disagree about whether a failed set
                // rejects or sets runtime.lastError; check both.
                if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
            })
            .catch(e => { reportStorageFailure(area, Object.keys(batch), e); throw e; })
    )).then(() => undefined);
}

/** Read keys from whichever area each lives in. */
function storageGet(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const bySync = list.filter(k => storageAreaFor(k) === "sync");
    const byLocal = list.filter(k => storageAreaFor(k) === "local");
    const read = (area, ks) => ks.length
        ? Promise.resolve().then(() => chrome.storage[area].get(ks))
        : Promise.resolve({});
    return Promise.all([read("sync", bySync), read("local", byLocal)])
        .then(([a, b]) => coerceStoredValues({ ...a, ...b }));
}

/** Read everything from both areas, local winning on collision. */
function storageGetAll() {
    return Promise.all([
        Promise.resolve().then(() => orcaStorage.get(null)),
        Promise.resolve().then(() => orcaStorage.get(null)),
    ]).then(([sync, local]) => coerceStoredValues({ ...sync, ...local }));
}

function storageRemove(keys) {
    const batches = splitByArea(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, null])));
    return Promise.all(Object.entries(batches).map(([area, batch]) =>
        Promise.resolve().then(() => chrome.storage[area].remove(Object.keys(batch)))
    )).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Value coercion
//
// Stored values have drifted in type across versions. A theme export attached
// to issue #12 carries cardRoundness and cardSpacing as strings ("15", "-15")
// while cardWidth and cardHeight are numbers, and todo_progress_rings as the
// boolean true where current code expects the mode string "rings".
//
// Numeric drift is not cosmetic: card sizing compares against defaults
// (`options.cardWidth !== 262`), and "262" !== 262, so a string width silently
// skips the rule. That is the mechanism behind the issue #12 report -- import a
// theme, card sizing stops applying, cards become content-sized, and Firefox
// scroll anchoring makes the dashboard unscrollable near the bottom.
//
// Coercion is by declared type, not by a list of known-bad keys: a list would
// need updating every time a new key drifts, and the drift is silent.
const ORCA_NUMERIC_KEYS = new Set([
    "imageSize", "cardRoundness", "cardSpacing", "cardWidth", "cardHeight",
    "cardPadding", "imageRoundness", "customBackgroundScale", "bg_opacity",
    "sidebar_opacity", "bg_blur", "sidebar_blur", "card_opacity", "card_blur",
    "sidebar_scale", "num_assignments", "num_todo_items", "card_limit",
    "reminder_count",
]);

// Keys whose value is one of a fixed set of mode strings. Anything else --
// including the booleans older versions wrote -- falls back to the default.
const ORCA_ENUM_KEYS = {
    todo_progress_rings: { values: ["rings", "rainbow", "lines", "oneline", "none"], fallback: "rings" },
    todo_timeframe: { values: ["all", "week", "month"], fallback: "all" },
    dashboard_notes_mode: { values: ["edit", "preview"], fallback: "edit" },
};

/** Coerce one stored value to the type the code expects. */
function coerceStoredValue(key, value) {
    if (value === undefined || value === null) return value;
    if (ORCA_NUMERIC_KEYS.has(key)) {
        const n = typeof value === "number" ? value : parseFloat(value);
        return Number.isFinite(n) ? n : undefined;
    }
    const spec = ORCA_ENUM_KEYS[key];
    if (spec) {
        return spec.values.includes(value) ? value : spec.fallback;
    }
    return value;
}

/** Coerce every value in an object, dropping any that cannot be salvaged. */
function coerceStoredValues(items) {
    const out = {};
    for (const [k, v] of Object.entries(items)) {
        const c = coerceStoredValue(k, v);
        if (c !== undefined) out[k] = c;
    }
    return out;
}

const orcaStorage = {
    set: storageSet,
    get: storageGet,
    getAll: storageGetAll,
    remove: storageRemove,
    areaFor: storageAreaFor,
    coerce: coerceStoredValue,
    coerceAll: coerceStoredValues,
    LOCAL_KEYS: ORCA_LOCAL_KEYS,
    VERSION: ORCA_STORAGE_VERSION,
};
