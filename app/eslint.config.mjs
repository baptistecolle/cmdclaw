import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import drizzle from "eslint-plugin-drizzle";




const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  reactHooks.configs.flat["recommended-latest"],

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  { 
    plugins: {
      drizzle,
    },
  }
]);

export default eslintConfig;
