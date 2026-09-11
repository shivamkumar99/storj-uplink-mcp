// ESLint flat config — typescript-eslint with type-aware rules (uses tsconfig.json).
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Mirrors SonarQube S2871: sort() without a comparator is unreliable.
      '@typescript-eslint/require-array-sort-compare': 'error',
    },
  },
);
