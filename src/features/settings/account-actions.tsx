import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedDownload, ownedJson } from '@/lib/api';
import { AccountStatusSchema } from '../../../shared/account';
import { successEnvelopeSchema } from '../../../shared/api';

export function AccountActions() {
  const { state, scope, reauthenticate, enterDeletion, checkAccount } =
    useAuth();
  const [operation, setOperation] = useState<'idle' | 'exporting' | 'deleting'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [includeTraces, setIncludeTraces] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  if (state.kind !== 'signed_in') return null;
  const session = state.session;
  async function download() {
    const epoch = scope.epoch;
    setOperation('exporting');
    setMessage('');
    try {
      await ownedDownload('/api/account', session.access_token, scope, epoch, {
        action: 'export',
        trace_parts: includeTraces
          ? ['input', 'output', 'context', 'usage']
          : [],
        sensitive_content_acknowledged: acknowledged,
      });
      scope.commit(epoch, () =>
        setMessage('Account download prepared. Store the file privately.'),
      );
    } catch (error) {
      scope.commit(epoch, () =>
        setMessage(
          error instanceof Error ? error.message : 'Account export failed.',
        ),
      );
    } finally {
      setOperation('idle');
    }
  }
  async function remove() {
    const epoch = scope.epoch;
    const secret = password;
    let submitted = false;
    setPassword('');
    setOperation('deleting');
    setMessage('');
    try {
      const fresh = await reauthenticate(secret);
      submitted = true;
      const status = successEnvelopeSchema(AccountStatusSchema).parse(
        await ownedJson('/api/account', fresh.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', confirmation }),
        }),
      ).data;
      if (status.state !== 'deleting')
        throw new Error(
          'Deletion initiation is unconfirmed. Refresh account status.',
        );
      if (scope.epoch === epoch) await enterDeletion(status, fresh);
    } catch (error) {
      if (submitted && scope.epoch === epoch) {
        scope.transition(session.user.id, true);
        await checkAccount();
      } else
        scope.commit(epoch, () =>
          setMessage(
            error instanceof Error
              ? error.message
              : 'Deletion initiation is unconfirmed. Refresh account status before retrying.',
          ),
        );
    } finally {
      setOperation('idle');
    }
  }
  return (
    <Card className="settings-card account-lifecycle-card">
      <h2>Export and delete account</h2>
      <p>
        Download your owned product history, settings, sources and available
        import staging as versioned JSON. Capture can fail if your account
        changes; retry after active work finishes. This export is not a
        transactional backup.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={includeTraces}
          onChange={(event) => {
            setIncludeTraces(event.target.checked);
            setAcknowledged(false);
          }}
          disabled={operation !== 'idle'}
        />{' '}
        Include available request, response, context and usage traces
      </label>
      {includeTraces && (
        <>
          <p id="trace-export-warning">
            Sensitive-content warning: traces may contain health information and
            conversation content. Expired, removed or unavailable parts cannot
            be reconstructed.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              aria-describedby="trace-export-warning"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              disabled={operation !== 'idle'}
            />{' '}
            I understand this download can contain sensitive trace content
          </label>
        </>
      )}
      <Button
        variant="outline"
        disabled={operation !== 'idle' || (includeTraces && !acknowledged)}
        onClick={() => void download()}
      >
        {operation === 'exporting'
          ? 'Preparing account export…'
          : 'Download account JSON'}
      </Button>
      <h3>Delete this account</h3>
      <p>
        Deletion blocks new activity immediately. Private removal runs in
        bounded steps when continued and cannot be undone. Unknown charges can
        delay final removal for 24 hours; offline encrypted backups rotate
        within 30 days.
      </p>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void remove();
        }}
      >
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={operation !== 'idle'}
          />
        </label>
        <label>
          Deletion confirmation
          <input
            required
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={operation !== 'idle'}
            aria-describedby="delete-confirm-hint"
          />
        </label>
        <p id="delete-confirm-hint">
          Type DELETE MY VULPES ACCOUNT exactly. Your password is checked
          through a fresh sign-in before initiation.
        </p>
        <Button
          disabled={
            operation !== 'idle' ||
            confirmation !== 'DELETE MY VULPES ACCOUNT' ||
            !password
          }
          type="submit"
        >
          {operation === 'deleting'
            ? 'Starting account deletion…'
            : 'Start account deletion'}
        </Button>
      </form>
      {message && <p role="status">{message}</p>}
    </Card>
  );
}
