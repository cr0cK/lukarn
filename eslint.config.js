import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      // Le préfixe `_` marque un paramètre volontairement inutilisé.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Les assertions `!` servent après des vérifications que le compilateur
      // ne peut pas suivre (accès indexé, paramètres de route Fastify).
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['packages/server/**/*.ts', 'eslint.config.js', '**/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Le front tourne dans le navigateur : pas de globales Node ici.
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/web/test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
