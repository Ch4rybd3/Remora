import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Scoped to rules that catch defects rather than style, matching the backend
 * ruff configuration (see pyproject.toml). Formatting is not enforced.
 *
 * react-hooks/rules-of-hooks is the rule that earns its keep here: a hook
 * called conditionally produces state that silently belongs to the wrong
 * render, which is close to impossible to diagnose from a bug report.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { a, b, ...rest } = obj` to strip keys is a deliberate idiom.
          ignoreRestSiblings: true,
        },
      ],
      // The `any` cleanup belongs to the S12 conventions sprint, not here.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
