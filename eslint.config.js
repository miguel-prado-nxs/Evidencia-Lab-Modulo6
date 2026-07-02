const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-process-exit': 'warn',
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
  {
    ignores: [
      'node_modules/**',
      'prisma/migrations/**',
      'prisma/seed.js',
      'prisma/seed-*.js',
      'coverage/**',
    ],
  },
];
