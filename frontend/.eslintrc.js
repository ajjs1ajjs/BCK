module.exports = {
  extends: ['react-app', 'eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'warn',
  },
  settings: {
    react: {
      version: 'detect'
    }
  }
};
