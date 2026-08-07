import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.claude/worktrees/` contient des worktrees git — d'autres branches du
    // même dépôt, montées sur disque. Les analyser fait relire les mêmes
    // fichiers dans un état arbitraire, et suffit à faire échouer `pnpm lint`,
    // donc `pnpm verify` et le hook `pre-push`, sans qu'aucun fichier suivi
    // n'ait de problème.
    ignores: ['**/dist/**', '**/node_modules/**', '.claude/worktrees/**'],
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
    files: [
      'packages/server/**/*.ts',
      'eslint.config.js',
      '**/vite.config.ts',
      // Outillage du dépôt : contrôle des specs, scripts de maintenance.
      'tools/**/*.mjs',
    ],
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
