import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { claimShare, clearImport, pendingImport } from '@/lib/import-handoff';
import { successEnvelopeSchema } from '../../../shared/api';
import { SourcesPageSchema } from '../../../shared/data';
import {
  handoffReference,
  HANDOFF_PROTOCOL,
} from '../../../shared/import-handoff';
import { ImportForm } from './import-form';

type SharedFile = NonNullable<Parameters<typeof ImportForm>[0]['sharedFile']>;
let documentConsumer: string | undefined;
function importConsumer() {
  if (documentConsumer) return documentConsumer;
  documentConsumer = crypto.randomUUID();
  try {
    const key = 'vulpes.import.consumer.v1';
    const saved = sessionStorage.getItem(key);
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    // New windows inherit session storage from their opener; only a restored
    // document may reuse that window's existing claim identity.
    if (
      (navigation?.type === 'reload' || navigation?.type === 'back_forward') &&
      saved &&
      handoffReference('#handoff=' + saved)
    )
      documentConsumer = saved;
    sessionStorage.setItem(key, documentConsumer);
  } catch {
    return documentConsumer;
  }
  return documentConsumer;
}
export function ImportPage() {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const userId = session?.user.id ?? null;
  const epoch = scope.epoch,
    client = useQueryClient(),
    navigate = useNavigate();
  const location = useLocation();
  const [reference, setReference] = useState(() =>
    handoffReference(location.hash),
  );
  const [sharedFile, setSharedFile] = useState<SharedFile | null>(null);
  const [message, setMessage] = useState('');
  const [intake, setIntake] = useState<'checking' | 'ready' | 'claiming'>(
    'checking',
  );
  const [consumer] = useState(importConsumer);
  const sources = useQuery({
    queryKey: ['data', session?.user.id, epoch, 'import-sources'],
    enabled: !!session,
    queryFn: async () => {
      const items = [];
      let cursor: string | null = null;
      let revision: number;
      let timezone: string;
      do {
        const page: ReturnType<typeof SourcesPageSchema.parse> =
          successEnvelopeSchema(SourcesPageSchema).parse(
            await ownedJson(
              '/api/data?' +
                new URLSearchParams({
                  view: 'sources',
                  ...(cursor ? { cursor } : {}),
                }),
              session!.access_token,
              scope,
              epoch,
            ),
          ).data;
        items.push(...page.items);
        cursor = page.nextCursor;
        revision = page.dataRevision;
        timezone = page.timezone;
      } while (cursor);
      return { items, revision, timezone };
    },
  });
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void pendingImport(userId)
      .then((pending) => {
        if (!active) return;
        setReference((current) => current ?? pending.reference);
        setIntake('ready');
      })
      .catch(() => {
        if (active) {
          setIntake('ready');
          setMessage(
            'Temporary import storage is unavailable. Use the file picker after enabling browser storage.',
          );
        }
      });
    if (location.hash) navigate('/data/import', { replace: true });
    return () => {
      active = false;
    };
  }, [userId, epoch, location.hash, navigate]);
  async function acceptAccount() {
    if (!session || !reference) return;
    setIntake('claiming');
    setMessage('');
    try {
      const controller = navigator.serviceWorker?.controller;
      if (import.meta.env.PROD && controller) {
        const channel = new MessageChannel();
        const protocol = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            channel.port1.close();
            reject(
              new Error(
                'Vulpes needs an update. Close its other windows, reopen it online, then share again.',
              ),
            );
          }, 2000);
          channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            resolve(event.data?.protocol);
          };
          controller.postMessage({ type: 'vulpes-import-protocol' }, [
            channel.port2,
          ]);
        });
        if (protocol !== HANDOFF_PROTOCOL)
          throw new Error(
            'The import receiver needs an update. Reopen Vulpes and share again.',
          );
      }
      const claimed = await claimShare(reference, session.user.id, consumer);
      if (scope.epoch !== epoch) return;
      setSharedFile({
        file: new File([claimed.body], claimed.name, {
          type: claimed.body.type,
        }),
        ref: reference,
        consumer,
        generation: claimed.generation,
        previewId: claimed.previewId,
      });
      setReference(null);
    } catch (error) {
      scope.commit(epoch, () =>
        setMessage(
          error instanceof Error
            ? error.message
            : 'The shared file could not be opened. Choose it again.',
        ),
      );
    } finally {
      scope.commit(epoch, () => setIntake('ready'));
    }
  }
  return (
    <>
      <header className="page-heading">
        <h1 tabIndex={-1}>Import CSV</h1>
        <p>
          Review the source, times and readings before saving. Importing does
          not use AI.
        </p>
      </header>
      <p>
        <Link to="/data">Back to Data</Link>
      </p>
      <p className="detail-note">
        If temporary recovery has expired or been cleared, check Data before
        starting an interrupted import again.
      </p>
      {message && <p role="alert">{message}</p>}
      {sources.isError && (
        <p role="alert">
          Source settings could not be loaded. Reconnect, then{' '}
          <Button variant="outline" onClick={() => void sources.refetch()}>
            Retry source settings
          </Button>
          .
        </p>
      )}
      {intake === 'checking' ? (
        <p role="status">Checking for a received file…</p>
      ) : reference ? (
        <section className="settings-form" aria-label="Received CSV">
          <h2>File received, not imported</h2>
          <p>
            This browser holds the file for up to 15 minutes. Temporary local
            storage is not end-to-end encryption. Nothing is uploaded until you
            confirm this account.
          </p>
          <p>Import into: {session?.user.email ?? 'the signed-in account'}.</p>
          <Button
            disabled={intake === 'claiming' || !sources.data}
            onClick={() => void acceptAccount()}
          >
            Use this account and preview
          </Button>
          <Button
            variant="outline"
            disabled={intake === 'claiming'}
            onClick={() => {
              if (session)
                void clearImport(session.user.id, reference)
                  .then(() => {
                    setReference(null);
                    setMessage(
                      'The local file was discarded. Choose a file or share again.',
                    );
                  })
                  .catch(() =>
                    setMessage(
                      'Discard could not be confirmed. Retry before sharing another file.',
                    ),
                  );
            }}
          >
            Discard received file
          </Button>
        </section>
      ) : sources.isError ? (
        <p role="alert">Sources could not be loaded. Reconnect and retry.</p>
      ) : !sources.data ? (
        <p role="status">Loading source settings…</p>
      ) : (
        <ImportForm
          sources={sources.data.items}
          timezone={sources.data.timezone}
          dataRevision={sources.data.revision}
          sharedFile={sharedFile}
          onSharedConsumed={() => setSharedFile(null)}
          onSaved={() => {
            for (const domain of [
              'data',
              'goals',
              'conversations',
              'inspection',
            ])
              void client.invalidateQueries({
                queryKey: [domain, session?.user.id, epoch],
              });
          }}
          onView={(sourceId, selection) =>
            navigate('/data', {
              state: { sourceId, selection, ownerId: userId },
            })
          }
        />
      )}
    </>
  );
}
