// ESLint flat config — typescript-eslint with type-aware rules (uses tsconfig.json).
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { security },
    rules: {
      // The security patterns Codacy applies; suppressions must carry a reason.
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-child-process': 'error',
      // Mirrors SonarQube S2871: sort() without a comparator is unreliable.
      '@typescript-eslint/require-array-sort-compare': 'error',
      // Architecture rule (ARCHITECTURE.md): no source file grows past 200 lines
      // of code — split by concern (schema / constants / handlers / tools) instead.
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },
);
