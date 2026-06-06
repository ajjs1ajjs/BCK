const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['frontend/**', 'node_modules/**', 'scripts/**'],
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
