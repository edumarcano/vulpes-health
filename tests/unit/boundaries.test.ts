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
  ['server/services/boundary-fixture.ts', "import '../ai/adapters/openrouter.js'"],
  ['server/services/boundary-fixture.ts', "import '../ai/providers/vertex.js'"],
  ['server/services/boundary-fixture.ts', "export * from '@server/ai/adapters/vertex'"],
  ['server/analytics/boundary-fixture.ts', "import('@server/ai/adapters/vertex')"],
  ['server/services/boundary-fixture.ts', "type Adapter = import('../ai/adapters/openrouter.js').Adapter"],
  ['server/services/boundary-fixture.ts', "import '../../tests/helpers/synthetic-providers.js'"],
  ['shared/boundary-fixture.ts', "export * from '../tests/helpers/synthetic-providers.js'"],
  ['src/boundary-fixture.ts', "import '../tests/helpers/synthetic-providers.js'"],
])('rejects forbidden dependency in %s: %s', async (file, code) => {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  expect(results.flatMap((result) => result.messages).some((message) => message.ruleId === 'vulpes/boundaries')).toBe(true);
});

it('allows the UI rendering dependency in UI code', async () => {
  const results = await eslint.lintText("import '@assistant-ui/react'", { filePath: path.resolve('src/allowed-fixture.ts') });
  expect(results.flatMap((result) => result.messages).filter((message) => message.ruleId === 'vulpes/boundaries')).toEqual([]);
});

it.each([
  ['src/allowed-fixture.ts', "import '../shared/api.js'"],
  ['shared/allowed-fixture.ts', "import './domain.js'"],
  ['server/services/allowed-fixture.ts', "import type { GenerationAdapter } from '../ai/contracts.js'"],
])('allows portable schemas and adapter contracts in %s', async (file, code) => {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  expect(results.flatMap((result) => result.messages).filter((message) => message.ruleId === 'vulpes/boundaries')).toEqual([]);
});
