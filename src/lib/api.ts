import { DATA_CONTRACT_VERSION } from '../../shared/import-v2';
import { ErrorEnvelopeSchema } from '../../shared/api';
import type { IdentityScope } from './auth/identity';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function ownedJson(
  path: string,
  token: string,
  scope: IdentityScope,
  expectedEpoch: number,
  init: RequestInit = {},
): Promise<unknown> {
  if (!path.startsWith('/api/'))
    throw new Error('Invalid application API path.');
  if (scope.epoch !== expectedEpoch || scope.userId === null)
    throw new DOMException('The account changed.', 'AbortError');
  const owner = scope.capture();
  try {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.any([
        owner.signal,
        ...(init.signal ? [init.signal] : []),
      ]),
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        ...(path.split('?')[0] === '/api/data'
          ? { 'X-Vulpes-Data-Contract': DATA_CONTRACT_VERSION }
          : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const value: unknown = await response.json();
    if (!owner.current())
      throw new DOMException('The account changed.', 'AbortError');
    if (!response.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(value);
      throw new ApiError(
        response.status,
        parsed.success
          ? parsed.data.error.message
          : 'The request could not be completed.',
      );
    }
    return value;
  } finally {
    owner.release();
  }
}
export async function ownedDownload(
  path: string,
  token: string,
  scope: IdentityScope,
  expectedEpoch: number,
  accountRequest?: {
    action: 'export';
    trace_parts: ('input' | 'output' | 'context' | 'usage')[];
    sensitive_content_acknowledged: boolean;
  },
): Promise<void> {
  if (!path.startsWith('/api/'))
    throw new Error('Invalid application API path.');
  if (scope.epoch !== expectedEpoch || scope.userId === null)
    throw new DOMException('The account changed.', 'AbortError');
  const owner = scope.capture();
  let url: string | undefined;
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      signal: owner.signal,
      ...(accountRequest
        ? { method: 'POST', body: JSON.stringify(accountRequest) }
        : {}),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(accountRequest ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!owner.current())
      throw new DOMException('The account changed.', 'AbortError');
    if (!response.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(await response.json());
      throw new ApiError(
        response.status,
        parsed.success
          ? parsed.data.error.message
          : 'The export could not be completed.',
      );
    }
    if (
      !response.headers
        .get('content-type')
        ?.startsWith(accountRequest ? 'application/json' : 'text/csv')
    )
      throw new Error('The export format could not be verified.');
    const blob = await response.blob();
    if (!owner.current())
      throw new DOMException('The account changed.', 'AbortError');
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = accountRequest
      ? 'vulpes-account-v2.json'
      : 'vulpes-measurements-v2.csv';
    link.click();
  } finally {
    if (url) URL.revokeObjectURL(url);
    owner.release();
  }
}
