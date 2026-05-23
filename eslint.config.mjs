import globals from "globals";
import js from "@eslint/js";

export default [
    {
        ignores: [
            "dist/**/*",
            "node_modules/**/*",
            "src/shared/lib/**/*.min.js",
            "libs/**/*.js"
        ]
    },
    js.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                chrome: "readonly",
                firebase: "readonly"
            },
            ecmaVersion: 2022,
            sourceType: "module"
        },
        rules: {
            "no-unused-vars": ["error", { "args": "none", "ignoreRestSiblings": true }],
            "no-undef": "off", // Project relies heavily on global window properties, easier to disable
            "no-empty": "warn",
            "no-constant-condition": "warn"
        }
    }
];
