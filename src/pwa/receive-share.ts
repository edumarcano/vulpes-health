import { CSV_LIMIT_BYTES } from '../../shared/import-limits';
import { SHARE_ENVELOPE_LIMIT } from '../../shared/import-handoff';
import { receiveShare } from '../lib/import-handoff';

export function shareResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function receiveShareRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST')
    return shareResponse('Use Data > Import CSV to choose a file.', 405);
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('multipart/form-data;')
  )
    return shareResponse('Share one CSV file, or use Data > Import CSV.', 400);
  if (Number(request.headers.get('content-length')) > SHARE_ENVELOPE_LIMIT)
    return shareResponse('Choose a CSV of at most 1 MiB.', 413);
  try {
    const reader = request.body?.getReader();
    if (!reader) return shareResponse('No CSV file was received.', 400);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > SHARE_ENVELOPE_LIMIT) {
          await reader.cancel();
          return shareResponse('Choose a CSV of at most 1 MiB.', 413);
        }
        chunks.push(new Uint8Array(value));
      }
    } finally {
      reader.releaseLock();
    }
    const form = await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
    const entries = [...form.entries()];
    const file = entries[0]?.[1];
    if (
      entries.length !== 1 ||
      entries[0]?.[0] !== 'files' ||
      !(file instanceof File) ||
      !file.size
    )
      return shareResponse(
        'Share exactly one nonempty CSV file, without text or other attachments.',
        400,
      );
    if (file.size > CSV_LIMIT_BYTES)
      return shareResponse('Choose a CSV of at most 1 MiB.', 413);
    if (
      file.name.length > 200 ||
      !/\.csv$/i.test(file.name) ||
      !['', 'text/csv'].includes(file.type)
    )
      return shareResponse(
        'This file type is unsupported. Choose a .csv file in Data > Import CSV.',
        400,
      );
    const ref = await receiveShare(file);
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/data/import#handoff=' + ref,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return shareResponse(
      'The file could not be received. Finish any pending import, then share again or use Data > Import CSV.',
      400,
    );
  }
}
