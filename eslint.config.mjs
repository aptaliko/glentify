import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // ESLint 10 removed the deprecated `context.getFilename()` API. eslint-config-next
  // bundles eslint-plugin-react, whose React-version *auto-detection* still calls it and
  // crashes on load under ESLint 10 (no released eslint-plugin-react supports 10 yet —
  // peer is `eslint ^9.7`). Pinning the version explicitly skips that detection code path.
  // Remove once eslint-config-next ships an ESLint-10-compatible eslint-plugin-react.
  // (typescript-eslint + eslint-plugin-react-hooks are forced to 10-compatible releases
  // via `overrides` in package.json — same reason.)
  { settings: { react: { version: "19.2" } } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Staged mobile export + generated Capacitor native shell — not our source to lint.
    ".mobile-build/**",
    "android/**",
    "ios/**",
  ]),
]);

export default eslintConfig;
