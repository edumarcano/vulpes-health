import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localStatus, projectRoot, runSupabase } from './local-database.js';

const [command, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Database scripts accept no connection overrides or extra arguments.');
const typesPath = path.join(projectRoot, 'server/db/database.types.ts');
try {
  switch (command) {
    case 'start':
      // Startup output includes local secrets; keep it out of logs.
      runSupabase(['start'], true);
      localStatus();
      console.info('Local synthetic Supabase ready at http://127.0.0.1:54321.');
      break;
    case 'stop': runSupabase(['stop']); break;
    case 'reset':
      localStatus();
      runSupabase(['db', 'reset', '--local', '--no-seed', '--yes']);
      console.info('Reset the dedicated disposable synthetic database.');
      break;
    case 'lint': runSupabase(['db', 'lint', '--local', '--schema', 'public', '--level', 'error', '--fail-on', 'error']); break;
    case 'test': runSupabase(['test', 'db']); break;
    case 'types':
    case 'types-check': {
      const generated = runSupabase(['gen', 'types', 'typescript', '--local', '--schema', 'public'], true)
        .replaceAll('\r\n', '\n').replace(/[\t ]+$/gm, '');
      assert(generated.includes('export type Database ='), 'CLI did not return database types.');
      if (command === 'types-check') assert.equal(readFileSync(typesPath, 'utf8').replaceAll('\r\n', '\n'), generated, 'Database types drifted; run npm run db:types.');
      else {
        mkdirSync(path.dirname(typesPath), { recursive: true });
        writeFileSync(typesPath, generated);
      }
      console.info(command === 'types-check' ? 'Database types match the local schema.' : 'Generated server database types.');
      break;
    }
    default: throw new Error('Unknown local database command.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local database operation failed.');
  process.exitCode = 1;
}
