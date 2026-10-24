import path from 'node:path';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();

it.each([
  ['src/boundary-fixture.ts', "import '../server/config/environment.js'"],
  ['src/boundary-fixture.ts', "import('@server/config/environment')"],
  ['src/boundary-fixture.ts', "export * from '../server/http/status.js'"],
  ['src/boundary-fixture.ts', "import 'node:crypto'"],
  ['src/boundary-fixture.ts', "import 'openai'"],
  ['src/boundary-fixture.ts', "type Config = import('../server/config/environment.js').ServerEnvironment"],
  ['src/boundary-fixture.ts', 'const name = "x"; void import(name)'],
  ['shared/boundary-fixture.ts', "import '../src/main.tsx'"],
  ['server/services/boundary-fixture.ts', "import '@assistant-ui/react'"],
  ['server/analytics/boundary-fixture.ts', "import '@google/genai'"],
])('rejects forbidden dependency in %s: %s', async (file, code) => {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  expect(results.flatMap((result) => result.messages).some((message) => message.ruleId === 'vulpes/boundaries')).toBe(true);
});

it('allows the UI rendering dependency in UI code', async () => {
  const results = await eslint.lintText("import '@assistant-ui/react'", { filePath: path.resolve('src/allowed-fixture.ts') });
  expect(results.flatMap((result) => result.messages).filter((message) => message.ruleId === 'vulpes/boundaries')).toEqual([]);
});
