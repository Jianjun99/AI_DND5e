// eslint.config.mjs — flat config. Two environments: the server (Node/CommonJS) and the
// browser frontend (ES modules, THREE vendored without types). Rules are tuned to catch the
// bug classes this project has actually shipped: duplicate declarations, unused variables that
// used to be live wiring, and misspelled identifiers.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'public/vendor/**',
      'data/**',
      'scratch/**',
      'scripts/_tmp/**',
      '*.min.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['server/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs'
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-fallthrough': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-binary-expression': 'error',
      'no-shadow-restricted-names': 'error',
      'valid-typeof': 'error'
    }
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node, WebSocket: 'readonly', fetch: 'readonly', document: 'readonly', window: 'readonly' },
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
