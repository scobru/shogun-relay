import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Ignore patterns
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "*.js",
      "*.mjs",
      "scripts/**",
      "src/public/**",
    ],
  },

  // Base ESLint recommended
  eslint.configs.recommended,

  // TypeScript recommended
  ...tseslint.configs.recommended,

  // Global settings
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
  },

  // Custom rules - permissive for existing codebase
  {
    files: ["src/**/*.ts"],
    rules: {
      // Disable noisy rules
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-useless-escape": "off",
      "no-prototype-builtins": "off",
      "no-fallthrough": "off",
      "no-case-declarations": "off",
      "prefer-const": "off",
      "no-async-promise-executor": "off", // Used in some patterns
      "no-control-regex": "off", // Regex with control chars is intentional

      // Security rules only
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  }
);
