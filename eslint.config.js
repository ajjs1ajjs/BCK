const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['frontend/**', 'node_modules/**', 'test-cloud.js', 'test-all-services.js', 'test-services.js', 'test_gfs.js', 'fix_syntax.js', 'transform.js', 'migrate_to_pg.js', 'migrate2.js'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_|^e$|^err$|^error$' }],
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
