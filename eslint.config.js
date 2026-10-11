const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["index.html", "sw.js", ".pb/", "pb_data/", "node_modules/", "docs/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  {
    // PocketBase JS hooks run in PocketBase's runtime, not Node.
    files: ["pb_hooks/**/*.pb.js", "pb_migrations/**/*.js"],
    languageOptions: {
      globals: {
        onBootstrap: "readonly",
        routerUse: "readonly",
        routerAdd: "readonly",
        cronAdd: "readonly",
        migrate: "readonly",
        onRecordCreate: "readonly",
        onRecordUpdate: "readonly",
        onRecordDelete: "readonly",
        onRecordAfterCreateSuccess: "readonly",
        onRecordAfterUpdateSuccess: "readonly",
        onRecordAfterDeleteSuccess: "readonly",
        onRecordCreateRequest: "readonly",
        onRecordUpdateRequest: "readonly",
        onRecordAuthRequest: "readonly",
        $app: "readonly",
        $os: "readonly",
        $apis: "readonly",
        $security: "readonly",
        $http: "readonly",
        __hooks: "readonly",
        Record: "readonly",
        Collection: "readonly",
      },
    },
  },
  {
    files: ["app/sw.js"],
    languageOptions: { sourceType: "script", globals: globals.serviceworker },
  },
  {
    files: ["app/**/*.js"],
    // Classic scripts that also load under Node for the unit tests (UMD): module/require exist there.
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly", require: "readonly", HH: "writable" },
    },
  },
];
