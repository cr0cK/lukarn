import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.claude/worktrees/` holds git worktrees — other branches of this same
    // repository, checked out on disk. Linting them re-reads the same files in an
    // arbitrary state, which is enough to fail `pnpm lint`, and therefore
    // `pnpm verify` and the `pre-push` hook, without a single tracked file being
    // at fault.
    //
    // The two Playwright directories are the same trap from the other side: a
    // failing `pnpm test:e2e` leaves a bundled HTML report behind, and the next
    // `pnpm verify` lints somebody else's minified viewer — thousands of errors
    // in files `.gitignore` already refuses to track. They only appear after a
    // failure, so the run that reports them is never the run that caused them.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.claude/worktrees/**',
      'packages/e2e/playwright-report/**',
      'packages/e2e/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      // A leading `_` marks a parameter left unused on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `!` assertions follow checks the compiler cannot track (indexed access,
      // Fastify route params).
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: [
      'packages/server/**/*.ts',
      'eslint.config.js',
      '**/vite.config.ts',
      // Repository tooling: the spec checks, maintenance scripts.
      'tools/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // The front end runs in the browser: no Node globals here.
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/web/test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The browser suite runs in Node and drives a browser from there. What it
    // evaluates *inside* the page is typed by Playwright, not linted as browser
    // code: the file it is written in is a Node module.
    files: ['packages/e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The service worker: neither Node nor a window. `self`, `caches` and
    // `clients` exist only in that context, and would otherwise be errors.
    files: ['packages/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // The theme bootstrap is the other unbundled file, and it is the opposite
    // context: it runs in the document, before anything else, and needs
    // `window`, `document` and `localStorage`.
    files: ['packages/web/public/theme.js'],
    languageOptions: { globals: globals.browser },
  },
);
