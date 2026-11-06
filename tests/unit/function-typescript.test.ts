import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('typechecks API sources with Vercel Node compiler configuration discovery', () => {
  // @vercel/node discovers tsconfig.json from the entrypoint, then applies these
  // defaults before resolving extends (packages/node/src/typescript.ts).
  const configPath = ts.findConfigFile(
    resolve('api/status.ts'),
    ts.sys.fileExists,
  );
  const loaded = configPath
    ? ts.readConfigFile(configPath, ts.sys.readFile)
    : { config: {} };
  expect(loaded.error).toBeUndefined();
  const config = loaded.config;
  const options = { ...config.compilerOptions };
  options.target ??= 'ES2021';
  options.esModuleInterop ??= true;
  if (options.module === undefined) {
    options.module = 'NodeNext';
    options.moduleResolution = 'NodeNext';
    options.strict = false;
  }
  const parsed = ts.parseJsonConfigFileContent(
    {
      ...config,
      include: ['api', 'server', 'shared'],
      compilerOptions: { ...options, noEmit: true },
    },
    ts.sys,
    process.cwd(),
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  expect(
    diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ),
  ).toEqual([]);
  expect(parsed.options.target).toBe(ts.ScriptTarget.ES2023);
  expect(parsed.options.module).toBe(ts.ModuleKind.NodeNext);
  expect(parsed.options.strict).toBe(true);
}, 30_000);
