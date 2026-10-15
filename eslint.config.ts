import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/.output/',
    '**/.tanstack/',
    '**/.source/',
    '**/routeTree.gen.ts',
    '.agents/',
    '.claude/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TanStack Router signals redirects and missing pages by throwing these.
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            {
              from: 'package',
              package: '@tanstack/router-core',
              name: ['Redirect', 'NotFoundError'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/{app,site,docs}/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['**/*.config.ts', '**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
