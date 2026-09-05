import js from "@eslint/js";
import globals from "globals";

/*
Lint config.

Deliberately close to the code that exists rather than to a style guide. The
extension is ~10k lines of plain scripts sharing one global scope, written over
several years by several people; a config that flags every deviation would
produce thousands of findings nobody reads, and the useful signal -- real
mistakes -- would be lost in it.

So: correctness rules at error, style left to Prettier, and the rules that
would fire constantly on this codebase are downgraded with a reason rather
than silently disabled.
*/
export default [
    js.configs.recommended,

    {
        // Extension source. These files are classic scripts loaded in order by
        // the manifest, not modules: they define globals for each other and
        // read globals the earlier ones defined.
        files: ["js/**/*.js", "css/darkmodecss.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "script",
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                // Cross-file globals. Each is defined in one file and read in
                // others; listing them is what lets no-undef stay on, which is
                // the rule most likely to catch a real typo here.
                ORCA_DEFAULTS: "readonly",
                ORCA_LOCAL_KEYS: "readonly",
                ORCA_STORAGE_VERSION: "readonly",
                orcaStorage: "readonly",
                storageAreaFor: "readonly",
                coerceStoredValue: "readonly",
                coerceStoredValues: "readonly",
                sanitizeCssColor: "readonly",
                sanitizeFontFamily: "readonly",
                sanitizeCssValue: "readonly",
                sanitizeHttpUrl: "readonly",
                renderMarkdown: "readonly",
                DARKMODE_CSS: "readonly",
                backgrounds: "readonly",
                themes: "readonly",
                importScripts: "readonly",
                backgroundPresets: "readonly",
                showApiError: "readonly",
                CanvasApiError: "readonly",
            },
        },
        rules: {
            // Off for extension source only. These files are classic scripts
            // that deliberately declare the globals other files consume, so
            // every shared symbol is "redeclared" against the globals list
            // above. Keeping no-undef on is worth more than keeping this on --
            // it is what found a function that was deleted while its four call
            // sites stayed.
            "no-redeclare": "off",

            // Real-mistake rules, on.
            "no-undef": "error",
            "no-dupe-keys": "error",
            "no-unreachable": "error",
            "no-fallthrough": "error",
            "no-self-compare": "error",
            "no-template-curly-in-string": "error",
            "no-unsafe-negation": "error",
            "no-constant-binary-expression": "error",
            "require-atomic-updates": "error",
            eqeqeq: ["warn", "smart"],

            // A promise that neither resolves nor rejects produces no output at
            // all. Three of those were found in Phase 1, so async correctness
            // is worth more here than style.
            "no-async-promise-executor": "error",
            "no-promise-executor-return": "error",
            "require-await": "warn",

            // Downgraded with reasons rather than switched off:
            // the codebase has many deliberately-empty catch blocks around
            // optional Canvas features, and unused function arguments in
            // event handlers.
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "no-unused-vars": ["warn", {
                args: "none",
                varsIgnorePattern: "^_",
                caughtErrors: "none",
            }],
            // Assignment in a condition is used intentionally in a few loops.
            "no-cond-assign": ["error", "except-parens"],
        },
    },

    {
        files: ["test/**/*.js", "tools/**/*.mjs", "tools/**/*.js", "*.config.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: { ...globals.node },
        },
        rules: {
            "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
            "no-empty": ["warn", { allowEmptyCatch: true }],
        },
    },

    {
        ignores: ["dist/**", "node_modules/**", "js/themes.js"],
    },
];
