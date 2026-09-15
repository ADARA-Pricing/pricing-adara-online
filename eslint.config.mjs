import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
export default defineConfig([
  ...nextVitals,
  // Existing code predates React Compiler. Keep migration findings visible
  // without requiring an unrelated rewrite to run the standard lint command.
  { files: ['**/*.{ts,tsx}'], rules: {
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/static-components': 'warn',
    'react-hooks/purity': 'warn',
    'react-hooks/preserve-manual-memoization': 'warn',
  } },
  globalIgnores(['.next/**', 'node_modules/**', 'docs/**']),
]);
