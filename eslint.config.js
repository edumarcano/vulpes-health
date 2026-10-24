import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import { boundaries } from './scripts/eslint-boundaries.js';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.build/**', '.remora/**', '.agents/**', 'docs/spec/**', 'playwright-report/**', 'test-results/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    ignores: ['src/**', 'shared/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks, 'react-refresh': refresh },
    rules: {
      ...hooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'server/**/*.ts'],
    plugins: { vulpes: { rules: { boundaries } } },
    rules: { 'vulpes/boundaries': 'error' },
  },
);
