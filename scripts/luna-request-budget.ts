import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Claim before dispatch, so crashes and ambiguous sends consume their slot.
export async function claimLunaRequest(directory: string, caseId: string) {
  for (let slot = 1; slot <= 50; slot++) {
    try {
      await writeFile(
        join(directory, `request-${slot}.json`),
        JSON.stringify({ caseId }),
        { flag: 'wx' },
      );
      return slot;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
  }
  throw new Error('suite_request_limit');
}
