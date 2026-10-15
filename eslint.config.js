import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import sonarjs from "eslint-plugin-sonarjs";
import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "e2e/screenshots", "docs/screenshots", "test-results", "playwright-report"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      sonarjs,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "sonarjs/cognitive-complexity": ["error", 25],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true, allowExportNames: ["useAppState", "useAppDispatch"] },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ...playwright.configs["flat/recommended"],
    files: ["e2e/**/*.ts"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      "playwright/no-wait-for-timeout": "error",
      // Left off: existing specs use these on purpose (follow-up cleanup).
      "playwright/no-conditional-expect": "off",
      "playwright/no-conditional-in-test": "off",
      "playwright/no-force-option": "off",
      "playwright/no-networkidle": "off",
      "playwright/no-skipped-test": "off",
      "playwright/prefer-web-first-assertions": "off",
      "playwright/prefer-to-have-count": "off",
      "playwright/prefer-to-have-length": "off",
    },
  },
);
