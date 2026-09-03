/*
Ochre for Canvas - sanitizers for values that reach CSS and URL sinks.

Theme fields, the custom font, the custom background and per-course colours are
all user- or theme-supplied, and several are written straight into a <style>
element or a style attribute. A value containing "}" can close our rule and
open its own; one containing url(...) can make the browser fetch an arbitrary
address, which leaks the page visit even though it cannot run script.

Everything here validates by SHAPE rather than by rejecting known-bad
substrings. A blocklist is an enumeration of the attacks someone thought of;
these describe what a valid value looks like and refuse everything else, so an
attack nobody thought of is refused by default.

Loaded before content.js and by popup.html.

Exposes: sanitizeCssColor, sanitizeFontFamily, sanitizeCssValue, sanitizeHttpUrl.
*/

// Characters and constructs that let a value escape the declaration it sits in.
// Applied as a backstop after each shape check, never as the only check.
const OCHRE_CSS_BREAKOUT = /[;{}<>\\]|@import|expression\s*\(/i;

/**
 * A CSS colour: hex, rgb/rgba, hsl/hsla, or a bare keyword such as
 * "transparent". Returns "" if it is not one.
 */
function sanitizeCssColor(value) {
    if (typeof value !== "string") return "";
    const v = value.trim();
    if (v === "" || OCHRE_CSS_BREAKOUT.test(v)) return "";
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    if (/^(?:rgb|hsl)a?\(\s*[0-9a-z.,%\s\/+-]+\)$/i.test(v)) return v;
    if (/^[a-z]{3,20}$/i.test(v)) return v;
    return "";
}

/**
 * A font-family list: quoted strings or bare identifiers, comma separated.
 * "Rubik" and "'EB Garamond', serif" pass; anything that could close the
 * declaration does not.
 */
function sanitizeFontFamily(value) {
    if (typeof value !== "string") return "";
    const v = value.trim();
    if (v === "" || v.length > 200 || OCHRE_CSS_BREAKOUT.test(v)) return "";
    for (const raw of v.split(",")) {
        const part = raw.trim();
        if (part === "") return "";
        const quoted = /^(['"])(.*)\1$/.exec(part);
        const name = quoted ? quoted[2] : part;
        // Letters, digits, spaces, hyphens. No parens, no url(), no escapes.
        if (!/^[\w \-]+$/.test(name)) return "";
    }
    return v;
}

/**
 * An http(s) URL for an href or a CSS url(). Returns "" for anything else,
 * which covers javascript:, data:, blob: and file: without naming them --
 * only http and https are accepted.
 */
function sanitizeHttpUrl(value) {
    if (typeof value !== "string") return "";
    const v = value.trim();
    if (v === "") return "";
    let url;
    try {
        url = new URL(v, typeof location !== "undefined" ? location.origin : "https://invalid.invalid");
    } catch (e) {
        return "";
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    // Quotes, parens and whitespace would terminate a url() or an attribute early.
    if (/["'()\\\s]/.test(url.href)) return "";
    return url.href;
}

/**
 * A general CSS value that may legitimately contain gradients and url().
 *
 * Theme "sidebar" values really do look like
 *   linear-gradient(#000c, #000c), center url("https://example/x.png")
 * so colours alone are not enough. Each url() is extracted and validated as an
 * http(s) URL; what remains must not be able to break out of the declaration.
 */
function sanitizeCssValue(value) {
    if (typeof value !== "string") return "";
    const v = value.trim();
    if (v === "" || v.length > 2000) return "";

    const urls = [];
    const withoutUrls = v.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, q, inner) => {
        const safe = sanitizeHttpUrl(inner);
        urls.push(safe || null);
        return safe ? " URL " : " BAD ";
    });
    if (urls.includes(null)) return "";
    if (OCHRE_CSS_BREAKOUT.test(withoutUrls)) return "";
    // What is left must look like CSS values: colours, keywords, numbers,
    // units, commas, percentages, and parens for gradients.
    if (!/^[\w\s#.,%()\/'" -]*$/.test(withoutUrls)) return "";

    let i = 0;
    return withoutUrls.replace(/ URL /g, () => 'url("' + urls[i++] + '")');
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { sanitizeCssColor, sanitizeFontFamily, sanitizeCssValue, sanitizeHttpUrl };
}
