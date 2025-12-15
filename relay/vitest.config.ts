import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.spec.ts", "tests/**/*.test.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/utils/**/*.ts"],
            exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
        },
        testTimeout: 10000,
    },
    resolve: {
        alias: {
            "@": "./src",
        },
    },
});
