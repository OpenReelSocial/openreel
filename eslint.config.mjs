import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      '**/node_modules/**',
      // Emitted by @atproto/lex-cli via 'make lex'; not hand-maintained.
      'packages/lexicons/src/generated/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config and test-harness files are not part of a service tsconfig project.
    files: ['**/*.config.{js,mjs,ts}', 'eslint.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
)
