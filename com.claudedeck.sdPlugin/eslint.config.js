// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Apply to TypeScript source files only
  { files: ['src/**/*.ts'] },

  // Base recommended rules
  ...tseslint.configs.recommended,

  {
    rules: {
      // Prefer explicit return types on exported functions, but allow inference elsewhere
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Allow `any` casts where the SDK types are too restrictive (e.g. action.setImage)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused variables are errors except for args prefixed with _
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Floating promises must be handled — prevents fire-and-forget bugs
      '@typescript-eslint/no-floating-promises': 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
