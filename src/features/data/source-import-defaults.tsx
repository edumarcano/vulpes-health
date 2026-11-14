import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { successEnvelopeSchema } from '../../../shared/api';
import { ImportMappingSchema } from '../../../shared/imports';
import { SourceDefaultsMutationSchema } from '../../../shared/events';
import type { Source } from '../../../shared/data';

export function SourceImportDefaults({ source }: { source: Source }) {
  const { state, scope } = useAuth(),
    client = useQueryClient();
  const epoch = scope.epoch;
  const saved = ImportMappingSchema.safeParse(source.importDefaults?.mapping);
  const [timezone, setTimezone] = useState(
    saved.success ? saved.data.timezone : 'UTC',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<'editing' | 'saving'>('editing');
  const [message, setMessage] = useState('');
  if (!saved.success) return null;
  async function save() {
    if (state.kind !== 'signed_in' || !saved.success) return;
    const request = SourceDefaultsMutationSchema.safeParse({
      action: 'update_source_defaults',
      source_id: source.id,
      expected_version: source.settingsVersion,
      client_request_id: crypto.randomUUID(),
      mapping: { ...saved.data, timezone },
    });
    if (!request.success) {
      setMessage('Use a valid IANA timezone.');
      return;
    }
    setStatus('saving');
    setMessage('');
    try {
      successEnvelopeSchema(
        z.object({
          source_id: z.uuid(),
          settings_version: z.number(),
          dataRevision: z.number(),
        }),
      ).parse(
        await ownedJson('/api/data', state.session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify(request.data),
        }),
      );
      scope.commit(epoch, () => {
        setStatus('editing');
        setConfirmed(false);
        setMessage(
          'Source defaults saved. Existing instants are unchanged; pending previews were invalidated.',
        );
        void client.invalidateQueries({
          queryKey: ['data', state.session.user.id, epoch],
        });
      });
    } catch (e) {
      scope.commit(epoch, () => {
        setStatus('editing');
        setMessage(
          e instanceof Error
            ? e.message
            : 'Save unavailable. Refresh the source before retrying.',
        );
      });
    }
  }
  return (
    <fieldset className="settings-form" disabled={status === 'saving'}>
      <legend>Saved source import settings</legend>
      <p>
        Format: {saved.data.format}. Timezone: {saved.data.timezone}.{' '}
        {saved.data.single_profile
          ? 'Confirmed single-profile export'
          : `Exact profile: ${saved.data.profile?.value}`}
        . Version {source.settingsVersion}.
      </p>
      <label>
        Default import timezone
        <input
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value);
            setConfirmed(false);
          }}
        />
      </label>
      <label className="data-checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirm this timezone is the source default for future previews
      </label>
      <Button type="button" disabled={!confirmed} onClick={() => void save()}>
        Save source import settings
      </Button>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
