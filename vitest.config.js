import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.js"],
        environment: "node",
        // These tests load extension source into a vm sandbox and make source
        // assertions against it. They are fast and have no shared state, so
        // there is no reason to isolate per file.
        isolate: false,
        reporters: ["default"],
    },
});
