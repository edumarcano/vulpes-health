import { EventAnnotationsSchema } from '../../../shared/events.js';
import { isPrivatePlainText } from '../../../shared/primitives.js';
import type { ImportBundle, RenphoEvent } from '../../../shared/imports.js';

function encodedText(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
function decodedText(value: string): string {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value)
    throw new Error('Invalid staged text encoding.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!isPrivatePlainText(text)) throw new Error('Invalid staged text.');
  return text;
}
export function packRenphoEvent(
  event: RenphoEvent,
): ImportBundle['events'][number] {
  const { annotations, no, ...record } = event;
  return {
    ...record,
    no_base64: no === null ? null : encodedText(no),
    annotations_base64: Object.fromEntries(
      Object.entries(annotations).map(([key, value]) => [
        key,
        encodedText(value!),
      ]),
    ),
  };
}
export function stagedAnnotations(event: ImportBundle['events'][number]) {
  return EventAnnotationsSchema.parse(
    Object.fromEntries(
      Object.entries(event.annotations_base64).map(([key, value]) => [
        key,
        decodedText(value!),
      ]),
    ),
  );
}
export function validateStagedText(event: ImportBundle['events'][number]) {
  stagedAnnotations(event);
  if (event.no_base64 !== null && decodedText(event.no_base64).length > 500)
    throw new Error('Invalid staged row identifier.');
}
