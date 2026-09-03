// Chrome runs this file as a service worker and ignores background.scripts;
// Firefox uses background.scripts and has already loaded defaults.js by now.
// importScripts exists only in the worker, so this covers both without
// double-loading.
if (typeof OCHRE_DEFAULTS === "undefined" && typeof importScripts === "function") {
    importScripts("/js/defaults.js");
}

// ===========================================================================
// Storage migration
//
// Ten keys that grow with usage lived in chrome.storage.sync, which allows
// 8,192 bytes per item and 102,400 in total. This moves them to local, where
// there is no per-item limit. Duplicated from content.js rather than imported
// because the service worker and the content script share no module system
// until the Phase 2 build lands; the test asserts the two lists match.
const OCHRE_LOCAL_KEYS = [
    "custom_cards", "custom_cards_2", "custom_cards_3",
    "assignments_done", "assignment_states", "custom_assignments",
    "custom_task_links", "reminders", "dark_mode_fix",
    "custom_styles", "dashboard_notes_text",
    "previous_colors", "previous_theme", "errors",
    "saved_themes", "liked_themes",
];
const OCHRE_STORAGE_VERSION = 1;

/**
 * Move bulk keys from sync to local, once.
 *
 * Ordering matters and is the whole difficulty: write to local first, verify
 * it landed, and only then remove from sync. The reverse order loses data if
 * the local write fails. The version marker is written last, so an interrupted
 * migration is retried on the next start rather than skipped.
 *
 * A key already present in local wins: it is the newer copy, since nothing
 * writes to sync for these keys after the migration runs.
 */
async function migrateStorage() {
    const local = await chrome.storage.local.get(["ochre_storage_version"]);
    if ((local.ochre_storage_version || 0) >= OCHRE_STORAGE_VERSION) return { migrated: [], skipped: true };

    const sync = await chrome.storage.sync.get(OCHRE_LOCAL_KEYS);
    const existingLocal = await chrome.storage.local.get(OCHRE_LOCAL_KEYS);

    const toMove = {};
    const staleInSync = [];
    for (const key of OCHRE_LOCAL_KEYS) {
        if (sync[key] === undefined) continue;
        if (existingLocal[key] !== undefined) {
            // Present in both. Local is authoritative, so this sync copy is a
            // leftover from a run that copied but did not get to the removal.
            // It still has to be cleared, or a partial failure leaves the data
            // occupying the sync quota permanently -- the retry would otherwise
            // skip the key and then write the version marker, stranding it.
            staleInSync.push(key);
            continue;
        }
        toMove[key] = sync[key];
    }

    const moved = Object.keys(toMove);
    if (moved.length) {
        await chrome.storage.local.set(toMove);
        // Verify before deleting the only other copy.
        const check = await chrome.storage.local.get(moved);
        const failed = moved.filter(k => check[k] === undefined);
        if (failed.length) {
            console.warn("[Ochre] storage migration incomplete, leaving sync copies:", failed);
            return { migrated: moved.filter(k => !failed.includes(k)), failed };
        }
    }
    const toRemove = moved.concat(staleInSync);
    if (toRemove.length) await chrome.storage.sync.remove(toRemove);

    await chrome.storage.local.set({ ochre_storage_version: OCHRE_STORAGE_VERSION });
    console.log("[Ochre] storage migration complete:", moved);
    return { migrated: moved };
}

// ===========================================================================
// Dynamic content scripts for user-supplied Canvas domains
//
// The static content_scripts entry matches only https://*.instructure.com/*.
// Self-hosted Canvas lives on institution domains that cannot be known ahead
// of time, so those are granted one host at a time through
// optional_host_permissions and registered at runtime.
//
// This replaces matching https://*/* and injecting four scripts at
// document_start on every HTTPS page the user visited. That was a privacy
// problem, a performance problem, and the thing store reviewers push back on.
// ===========================================================================

const OCHRE_DYNAMIC_SCRIPT_ID = "ochre-custom-domain";

// Must stay in step with the static entry in manifest.json. A test asserts it.
const OCHRE_CONTENT_FILES = {
    js: ["css/darkmodecss.js", "js/backgrounds.js", "js/markdown.js",
         "js/defaults.js", "js/storage.js", "js/content.js"],
    css: ["css/content.css"],
};

/** "canvas.ucsc.edu" -> "https://canvas.ucsc.edu/*", or null if unusable. */
function domainToMatchPattern(entry) {
    if (typeof entry !== "string") return null;
    const raw = entry.trim();
    if (raw === "") return null;
    let host;
    try {
        host = new URL(raw.includes("://") ? raw : "https://" + raw).hostname.toLowerCase();
    } catch (e) {
        return null;
    }
    // A host with no dot, or a wildcard, would widen the grant far beyond what
    // the user typed. This is the input that decides where a script carrying
    // the user's Canvas session runs, so it is validated where it is granted,
    // not only where it is read.
    if (!host.includes(".") || host.includes("*")) return null;
    return `https://${host}/*`;
}

/**
 * Register the content scripts for every custom domain we actually hold
 * permission for. Domains the user has not granted are skipped rather than
 * requested here -- a request needs a user gesture and belongs in the popup.
 */
async function syncDynamicContentScripts() {
    if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
    const { custom_domain = [] } = await chrome.storage.sync.get("custom_domain");
    const patterns = [];
    for (const entry of Array.isArray(custom_domain) ? custom_domain : []) {
        const pattern = domainToMatchPattern(entry);
        if (!pattern) continue;
        // Skip anything already covered by the static entry, or we would
        // register a second injection into the same page.
        if (/^https:\/\/([^/]*\.)?instructure\.com\/\*$/.test(pattern)) continue;
        let granted = false;
        try {
            granted = await chrome.permissions.contains({ origins: [pattern] });
        } catch (e) { granted = false; }
        if (granted) patterns.push(pattern);
    }

    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [OCHRE_DYNAMIC_SCRIPT_ID] })
        .catch(() => []);
    if (!patterns.length) {
        if (existing.length) {
            await chrome.scripting.unregisterContentScripts({ ids: [OCHRE_DYNAMIC_SCRIPT_ID] }).catch(() => {});
        }
        return;
    }
    const spec = {
        id: OCHRE_DYNAMIC_SCRIPT_ID,
        matches: patterns,
        js: OCHRE_CONTENT_FILES.js,
        css: OCHRE_CONTENT_FILES.css,
        runAt: "document_start",
        persistAcrossSessions: true,
    };
    try {
        if (existing.length) await chrome.scripting.updateContentScripts([spec]);
        else await chrome.scripting.registerContentScripts([spec]);
    } catch (e) {
        console.warn("[Ochre] could not register content scripts for", patterns, e);
    }
}

// Re-sync whenever the domain list or the granted permissions change, and on
// startup, since registrations do not always survive an update.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.custom_domain) syncDynamicContentScripts();
});
if (chrome.permissions && chrome.permissions.onAdded) {
    chrome.permissions.onAdded.addListener(() => syncDynamicContentScripts());
    chrome.permissions.onRemoved.addListener(() => syncDynamicContentScripts());
}
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => syncDynamicContentScripts());

chrome.runtime.onInstalled.addListener(function () {

    migrateStorage().catch(e => console.warn("[Ochre] storage migration failed:", e));
    syncDynamicContentScripts();

    // Defaults live in js/defaults.js, the single source of truth shared with
    // the popup and the content script.
    let default_options = OCHRE_DEFAULTS;
    const updateMsg = "Ochre for Canvas is installed.\nOpen the extension popup on your Canvas dashboard to get started.";

    chrome.storage.local.get(null, local => {
        chrome.storage.sync.get(null, async sync => {
            let newSyncOptions = {"update_msg": updateMsg};
            let newLocalOptions = {};
            Object.keys(default_options["sync"]).forEach(option => {
                if (sync[option] !== undefined) return;
                newSyncOptions[option] = default_options["sync"][option];
            });
            Object.keys(default_options["local"]).forEach(option => {
                if (local[option] !== undefined) return;
                newLocalOptions[option] = default_options["local"][option];
            })

            // migrate old setting name
            if (sync["nasaFitToScreen"] !== undefined && sync["fitImageToScreen"] === undefined) {
                newSyncOptions["fitImageToScreen"] = sync["nasaFitToScreen"];
            }

            // "gradent_cards" was a typo that only ever existed in the two
            // defaults blocks. Every reader -- syncedSwitches, the
            // applyOptionsChanges case, changeGradientCards, and every bundled
            // theme's exports -- uses "gradient_cards", so the default was
            // orphaned and the real key had none. Carry across any value a user
            // somehow has under the misspelling, then delete it.
            if (sync["gradent_cards"] !== undefined) {
                if (sync["gradient_cards"] === undefined) {
                    newSyncOptions["gradient_cards"] = sync["gradent_cards"];
                }
                chrome.storage.sync.remove("gradent_cards");
            }

            // Normalise custom_domain to bare lowercase hostnames. The popup
            // input has always stored hostnames ("canvas.ucsc.edu"), but the
            // removed auto-detect probe stored full origins
            // ("https://canvas.ucsc.edu"). Both must keep working, so rewrite
            // the stored value once rather than making every read handle both.
            // Users who had a domain set by the probe keep it and are not asked
            // to enter it again.
            if (Array.isArray(sync["custom_domain"])) {
                const normalized = sync["custom_domain"].map(entry => {
                    if (typeof entry !== "string") return "";
                    const raw = entry.trim();
                    if (raw === "") return "";
                    try {
                        return new URL(raw.includes("://") ? raw : "https://" + raw).hostname.toLowerCase();
                    } catch (e) {
                        return raw.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
                    }
                }).filter(h => h !== "");
                const before = sync["custom_domain"].filter(d => typeof d === "string" && d.trim() !== "");
                const changed = normalized.length !== before.length ||
                    normalized.some((h, i) => h !== before[i]);
                if (changed) newSyncOptions["custom_domain"] = normalized;
            }

            // Route seeded defaults by key, not by which block they were
            // declared in. Ten keys in default_options.sync now belong in
            // local; seeding them into sync would immediately recreate the
            // condition the migration exists to undo, and burn sync quota on
            // an empty object for every new install.
            for (const key of OCHRE_LOCAL_KEYS) {
                if (key in newSyncOptions) {
                    newLocalOptions[key] = newSyncOptions[key];
                    delete newSyncOptions[key];
                }
            }

            if (Object.keys(newLocalOptions).length > 0) {
                chrome.storage.local.set(newLocalOptions);
            }

            if (Object.keys(newSyncOptions).length > 0) {
                chrome.storage.sync.set(newSyncOptions).then(() => {
                    console.log(newSyncOptions);
                    if (newSyncOptions.new_install === true) {
                        chrome.runtime.openOptionsPage();
                        chrome.storage.sync.set({ new_install: false });
                    }
                });
            }
        });
    });
});

// The NASA APOD API with the demo key is limited to 30 requests/hour and 50/day.
// Calls are serialized through this worker; the API's own 429 responses handle limiting.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "getNasaBackground") {
        getNasaBackground().then(sendResponse);
        return true;
    }
});

let nasaRequestQueue = Promise.resolve();
function queuedNasaTask(task) {
    const run = nasaRequestQueue.then(task, task);
    nasaRequestQueue = run.catch(() => {});
    return run;
}

async function getNasaBackground() {
    return queuedNasaTask(async () => {
        const date = new Date();
        for (let i = 0; i < 7; i++) {
            const dateStr = date.toISOString().slice(0, 10);
            const cacheKey = `nasa_apod_${dateStr}`;
            const metadataKey = `nasa_apod_meta_${dateStr}`;
            const cached = await chrome.storage.local.get([cacheKey, metadataKey]);
            if (cached[cacheKey]) return cached[cacheKey];

            // Don't re-probe dates the API already told us don't exist
            const missingKey = `nasa_apod_missing_${dateStr}`;
            const missing = await chrome.storage.local.get(missingKey);
            if (missing[missingKey]) {
                date.setDate(date.getDate() - 1);
                continue;
            }

            const data = await callNasaApi(dateStr);
            if (data === "ratelimited" || data === null) return null;
            if (data === "missing") {
                await chrome.storage.local.set({ [missingKey]: true });
                date.setDate(date.getDate() - 1);
                continue;
            }

            const url = data.thumbnail_url || data.hdurl || data.url;
            if (!url) return null;
            const result = { url, scale: 100, date: dateStr };
            const meta = { title: data.title || "", date: data.date || dateStr, copyright: data.copyright || "", explanation: data.explanation || "" };
            // Write image + metadata atomically so the info overlay never sees a
            // cached image with missing metadata.
            await chrome.storage.local.set({ [cacheKey]: result, [metadataKey]: meta });
            return result;
        }
        return null;
    });
}

async function callNasaApi(dateStr) {
    let response;
    try {
        response = await fetch(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&thumbs=true&date=${dateStr}`);
    } catch (error) {
        console.error("[Ochre] Failed to fetch NASA APOD:", error);
        return null;
    }

    if (response.status === 429) return "ratelimited";
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.code === 404 && (errorData.msg || "").toLowerCase().includes("no data available")) {
            return "missing";
        }
        return null;
    }

    return await response.json().catch(() => null);
}
