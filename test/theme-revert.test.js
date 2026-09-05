/*
Regression test: applying a theme with card images and then reverting must
leave both storage and the DOM clean.

Runs the real functions out of js/popup.js and js/content.js rather than a
copy of their logic, so it fails if either is changed back. Dependency-free
(node test/theme-revert.test.js) to avoid committing to a test runner ahead
of Phase 2; the assertions port to Vitest unchanged.

Covers:
  1. getExport -> importTheme round trip when the user had NO card images.
     This is the reported bug: the snapshot is [], and a `length > 0` guard
     made importTheme skip the write entirely, so the theme's images stayed.
  2. The same round trip when the user DID have images, so the fix does not
     break restoring a non-empty set.
  3. customizeCards clears an image it injected once storage says img === "".
  4. customizeCards does NOT clear an image Canvas set itself.
*/
import { test } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import vm from "vm";
import assert from "assert";
import * as sanitizers from "../js/sanitize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Pull one top-level function's source out of a file by brace matching. */
function extractFunction(file, name) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r/g, "");
    const re = new RegExp("^(?:async )?function " + name + "\\s*\\(", "m");
    const m = re.exec(src);
    if (!m) throw new Error(`${name} not found in ${file}`);
    let depth = 0, i = src.indexOf("{", m.index);
    for (let j = i; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
    }
    throw new Error(`unbalanced braces for ${name}`);
}

/* ---------- minimal DOM ---------- */
class El {
    constructor(cls = "", tag = "div") {
        this.className = cls; this.tagName = tag;
        this.children = []; this.parent = null;
        this.style = {}; this.dataset = {};
    }
    get parentNode() { return this.parent; }
    appendChild(c) { if (c.parent) c.parent.remove_(c); c.parent = this; this.children.push(c); return c; }
    insertBefore(node, ref) {
        if (node.parent) node.parent.remove_(node);
        node.parent = this;
        const i = this.children.indexOf(ref);
        if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
        return node;
    }
    contains(n) { while (n) { if (n === this) return true; n = n.parent; } return false; }
    prepend(c) { if (c.parent) c.parent.remove_(c); c.parent = this; this.children.unshift(c); return c; }
    remove_(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
    remove() { if (this.parent) this.parent.remove_(this); }
    querySelector(sel) {
        const want = sel.replace(/^\./, "");
        const walk = (n) => {
            for (const c of n.children) {
                if (String(c.className).split(/\s+/).includes(want)) return c;
                const r = walk(c); if (r) return r;
            }
            return null;
        };
        return walk(this);
    }
    querySelectorAll(sel) {
        // Real enough for customizeCards' early-return guard, which checks
        // cards[0].querySelectorAll(".ic-DashboardCard__link").length.
        const want = sel.replace(/^\./, "");
        const out = [];
        const walk = (n) => {
            for (const c of n.children) {
                if (String(c.className).split(/\s+/).includes(want)) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
}

function makeCard(id, { nativeImage = false } = {}) {
    const card = new El("ic-DashboardCard");
    const header = card.appendChild(new El("ic-DashboardCard__header"));
    const link = card.appendChild(new El("ic-DashboardCard__link"));
    link.href = `https://canvas.example.edu/courses/${id}`;
    header.appendChild(new El("ic-DashboardCard__header_hero"));
    if (nativeImage) {
        const native = header.appendChild(new El("ic-DashboardCard__header_image"));
        native.style.backgroundImage = 'url("https://canvas.example.edu/native.png")';
    }
    card.__header = header;
    return card;
}

/* ---------- load the real functions ---------- */
const ctx = {
    console, chrome: null, options: null, document: null,
    makeElement(tag, location, opts) {
        const el = new El(opts.className || "", tag);
        Object.assign(el, opts);
        location.appendChild(el);
        return el;
    },
    getCardId(card) {
        const l = card.querySelector(".ic-DashboardCard__link");
        return l && l.href.split("courses/")[1];
    },
    quizSafeModeActive: () => false,
    logError() {},
    // customizeCards validates theme-supplied image URLs before writing them
    // into a CSS url(); load the real implementation rather than a stub, so the
    // test exercises what ships.
    ...sanitizers,
};
vm.createContext(ctx);
vm.runInContext(extractFunction("js/popup.js", "getExport"), ctx);
vm.runInContext(extractFunction("js/popup.js", "importTheme"), ctx);
vm.runInContext(extractFunction("js/content.js", "customizeCards"), ctx);

/** Run importTheme against a fake chrome.storage.sync and return what it wrote. */
function runImport(theme, liveCards) {
    let written = null;
    // importTheme writes through the shared storage layer now, so the harness
    // stubs that rather than chrome.storage directly.
    // A synchronously-resolving thenable, not a real Promise. importTheme now
    // reads through orcaStorage.get(...).then(...), which defers to a
    // microtask, and this harness is deliberately synchronous -- an async test
    // body here could not fail (see the harness note above). Resolving inline
    // keeps the assertions in the same tick while still driving the real code.
    const inline = (v) => ({ then: (f) => inline(f(v)) });
    ctx.orcaStorage = {
        get: () => inline({ custom_cards: liveCards }),
        set: (obj) => { written = obj; return inline(undefined); },
    };
    ctx.chrome = {
        storage: {
            sync: {
                get: (_keys, cb) => cb({ custom_cards: liveCards }),
                set: (obj) => { written = obj; },
            },
        },
    };
    ctx.changeToPresetCSS = () => {};
    ctx.sendFromPopup = async () => [];
    ctx.importTheme(theme);
    return written;
}

/* ---------- tests ---------- */

test("revert clears card images when the user originally had none", () => {
    // 1. user has no images; snapshot is taken on theme apply
    const before = { custom_cards: { 101: { img: "" }, 102: { img: "" } } };
    const snapshot = { custom_cards: [] };
    for (const k of Object.keys(before.custom_cards)) {
        const img = before.custom_cards[k].img;
        if (img && img !== "none" && img.trim() !== "") snapshot.custom_cards.push(img);
    }
    assert.deepStrictEqual(snapshot.custom_cards, [], "snapshot should be empty");

    // 2. a theme applies images
    const live = { 101: { img: "https://x/a.gif" }, 102: { img: "https://x/b.gif" } };

    // 3. revert replays the snapshot
    const written = runImport(snapshot, live);

    assert.ok(written, "revert must write custom_cards, not skip it");
    assert.ok("custom_cards" in written, "custom_cards missing from the write");
    for (const k of Object.keys(written.custom_cards)) {
        assert.strictEqual(written.custom_cards[k].img, "",
            `course ${k} still has img=${JSON.stringify(written.custom_cards[k].img)}`);
    }
});

test("revert restores a non-empty image set", () => {
    const live = { 101: { img: "https://theme/x.gif" }, 102: { img: "https://theme/y.gif" } };
    const written = runImport({ custom_cards: ["https://orig/1.png", "https://orig/2.png"] }, live);
    assert.strictEqual(written.custom_cards[101].img, "https://orig/1.png");
    assert.strictEqual(written.custom_cards[102].img, "https://orig/2.png");
});

test("images cycle when a theme supplies fewer images than courses", () => {
    const live = { 1: { img: "" }, 2: { img: "" }, 3: { img: "" } };
    const written = runImport({ custom_cards: ["a.png", "b.png"] }, live);
    assert.deepStrictEqual(
        [written.custom_cards[1].img, written.custom_cards[2].img, written.custom_cards[3].img],
        ["a.png", "b.png", "a.png"]);
});

test("customizeCards clears an image it injected once storage says empty", () => {
    const card = makeCard(101);
    ctx.options = { custom_cards: { 101: { img: "https://x/a.gif", hidden: false, name: "" } }, custom_cards_2: {} };
    ctx.customizeCards([card]);
    const injected = card.querySelector(".ic-DashboardCard__header_image");
    assert.ok(injected, "image should have been injected");
    assert.match(injected.style.backgroundImage, /a\.gif/);
    assert.ok(["created", "reused"].includes(injected.dataset.orcaCardImage),
        `injection should record how it started, got ${JSON.stringify(injected.dataset.orcaCardImage)}`);

    // revert: storage now says no image
    ctx.options.custom_cards[101].img = "";
    ctx.customizeCards([card]);
    const after = card.querySelector(".ic-DashboardCard__header_image");
    assert.strictEqual(after ? after.style.backgroundImage : "", "",
        "injected background image should be cleared");
    assert.strictEqual(card.querySelector(".ic-DashboardCard__header_hero").style.opacity, 1,
        "hero opacity should be restored");
});

test("revert restores Canvas' own course image, not a placeholder", () => {
    // The reported bug: after reverting a theme the card showed a stock image
    // until a manual refresh. Storage was correct; the DOM restore was not.
    const card = makeCard(303, { nativeImage: true });
    const original = card.querySelector(".ic-DashboardCard__header_image").style.backgroundImage;
    assert.match(original, /native\.png/, "fixture should start with Canvas' image");

    // Theme applies its own image over Canvas'.
    ctx.options = { custom_cards: { 303: { img: "https://theme/pusheen.gif", hidden: false, name: "" } }, custom_cards_2: {} };
    ctx.customizeCards([card]);
    assert.match(card.querySelector(".ic-DashboardCard__header_image").style.backgroundImage,
        /pusheen\.gif/, "theme image should have been applied");

    // Revert.
    ctx.options.custom_cards[303].img = "";
    ctx.customizeCards([card]);
    const after = card.querySelector(".ic-DashboardCard__header_image");
    assert.ok(after, "Canvas' own header image element must not be removed");
    assert.strictEqual(after.style.backgroundImage, original,
        "Canvas' original course image must be restored, not cleared to a placeholder");
});

test("revert removes a container we created, rather than leaving it empty", () => {
    // When Canvas had no header image we create the element. Clearing its
    // background leaves an empty container, which is what rendered as a
    // placeholder; it has to be removed instead.
    const card = makeCard(404);   // no native image
    ctx.options = { custom_cards: { 404: { img: "https://theme/x.gif", hidden: false, name: "" } }, custom_cards_2: {} };
    ctx.customizeCards([card]);
    assert.ok(card.querySelector(".ic-DashboardCard__header_image"), "should have created a container");

    ctx.options.custom_cards[404].img = "";
    ctx.customizeCards([card]);
    assert.strictEqual(card.querySelector(".ic-DashboardCard__header_image"), null,
        "a container we created must be removed on revert, not left empty");
    assert.ok(card.querySelector(".ic-DashboardCard__header_hero"),
        "the colour overlay was moved inside the container and must survive its removal");
});

test("customizeCards leaves a Canvas-native image alone", () => {
    const card = makeCard(202, { nativeImage: true });
    ctx.options = { custom_cards: { 202: { img: "", hidden: false, name: "" } }, custom_cards_2: {} };
    ctx.customizeCards([card]);
    const native = card.querySelector(".ic-DashboardCard__header_image");
    assert.match(native.style.backgroundImage, /native\.png/,
        "Canvas' own card image must not be cleared");
});
