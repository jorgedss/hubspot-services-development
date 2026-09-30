import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import { config as uiExtensionsConfig } from "@hubspot/eslint-config-ui-extensions";

export default defineConfig([
  {
    ignores: ["node_modules/**", "assets/**"],
  },
  ...uiExtensionsConfig,
  prettier,
]);
