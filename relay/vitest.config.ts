import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "json", "lcov"],
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts", 
                "src/**/*.spec.ts", 
                "src/types/**/*.ts",
                "src/declarations.d.ts",
                "src/env.d.ts",
                "src/gun.d.ts",
                "src/public/**/*"
            ],
        },
        testTimeout: 10000,
    },
    resolve: {
        alias: {
            "@": "./src",
        },
    },
});

