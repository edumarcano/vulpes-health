import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Claim before dispatch, so crashes and ambiguous sends consume their slot.
export async function claimLunaRequest(
  directory: string,
  caseId: string,
  maximum = 50,
) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50)
    throw new Error('invalid_request_limit');
  for (let slot = 1; slot <= maximum; slot++) {
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
