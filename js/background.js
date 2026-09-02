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

chrome.runtime.onInstalled.addListener(function () {

    migrateStorage().catch(e => console.warn("[Ochre] storage migration failed:", e));

    let default_options = {
        "local": {
            "previous_colors": null,
            "previous_theme": null,
            "errors": [],
            "saved_themes": {},
            "liked_themes": [],
        },
        "sync": {
            "dark_preset": {
                "background-0": "#161616",
                "background-1": "#1e1e1e",
                "background-2": "#262626",
                "borders": "#3c3c3c",
                "text-0": "#f5f5f5",
                "text-1": "#e2e2e2",
                "text-2": "#ababab",
                "links": "#56Caf0",
                "sidebar": "#1e1e1e",
                "sidebar-text": "#f5f5f5"
            },
            "new_install": true,
            "assignments_due": true,
            "gpa_calc": true,
            "dark_mode": true,
            "gradent_cards": false,
            "disable_color_overlay": false,
            "auto_dark": false,
            "auto_dark_start": { "hour": "20", "minute": "00" },
            "auto_dark_end": { "hour": "08", "minute": "00" },
            "num_assignments": 4,
            "custom_domain": [""],
            "assignments_done": [],
            "dashboard_grades": true,
            "assignment_date_format": false,
            "dashboard_notes": false,
            "dashboard_notes_text": "",
            "dashboard_notes_mode": "edit",
            "better_todo": true,
            "todo_hr24": false,
			"todo_separate_scrollbar": false,
            "better_sidebar": false,
            "condensed_cards": false,
            "custom_cards": {},
            "custom_cards_2": {},
            "custom_cards_3": {},
            "custom_assignments": [],
            "custom_assignments_overflow": ["custom_assignments"],
            "grade_hover": false,
            "card_letter": false,
            // "hide_completed": false,
            "num_todo_items": 10,
            "custom_font": { "link": "", "family": "" },
            "hover_preview": true,
            "full_width": null,
            "remlogo": null,
            "gpa_calc_bounds": {
                "A+": { "cutoff": 97, "gpa": 4.0 },
                "A": { "cutoff": 93, "gpa": 4 },
                "A-": { "cutoff": 90, "gpa": 3.7 },
                "B+": { "cutoff": 87, "gpa": 3.3 },
                "B": { "cutoff": 83, "gpa": 3 },
                "B-": { "cutoff": 80, "gpa": 2.7 },
                "C+": { "cutoff": 77, "gpa": 2.3 },
                "C": { "cutoff": 73, "gpa": 2 },
                "C-": { "cutoff": 70, "gpa": 1.7 },
                "D+": { "cutoff": 67, "gpa": 1.3 },
                "D": { "cutoff": 63, "gpa": 1 },
                "D-": { "cutoff": 60, "gpa": .7 },
                "F": { "cutoff": 0, "gpa": 0 }
            },
            // "todo_overdues": false,
            "card_overdues": false,
            "relative_dues": false,
            "equal_height_cards": false,
            "hide_new_canvas": true,
            "hide_sequence_footer": false,
            "quiz_safe_mode": false,
            "dark_mode_fix": [],
            "assignment_states": {},
            "tab_icons": false,
            "todo_hide_feedback": false,
            "todo_full_height": true,
            "todo_progress_rings": "rings",
            "todo_confetti": true,
            "device_dark": false,
            "cumulative_gpa": { "name": "Cumulative GPA", "hidden": false, "weight": "dnc", "credits": 999, "gr": 3.21 },
            // "show_updates": false,
            "card_method_date": false,
            "card_method_dashboard": true,
            "card_limit": 25,
            "remind": false,
            "reminders": [],
            "reminder_count": 1,
            "multi_remind": false,
            "id": "",
            "new_browser": null,
            "gpa_calc_cumulative": false,
            "gpa_calc_weighted": true,
            "browser_show_likes": false,
            "custom_styles": "",
            "imageSize": 100,
            "cardRoundness": 5,
            "imageRoundness": 0,
            'cardSpacing': 0,
            "cardWidth": 262,
            "cardHeight": 146,
            "customCardStyles": false,
            "customBackgroundLink": "",
            "customBackgroundScale": 100,
            "customBackgroundDaily": false,
            "customBackgroundNasaDaily": false,
            "nasaInfoOverlay": false,
            "fitImageToScreen": false,
            "bg_opacity": 65,
            "sidebar_opacity": 100,
            "bg_blur": 8,
            "sidebar_blur": 0,
            "global_search": false,
            "grade_analytics": false,
            "grade_analytics_zones": false,
        }
    };

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
