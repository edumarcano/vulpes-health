import { useState, type SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import {
  SettingsSchema,
  type Settings,
  type SettingsPatch,
} from '../../../shared/auth';
import { successEnvelopeSchema } from '../../../shared/api';
import { AccountActions } from './account-actions';

function ProfileForm({
  settings,
  busy,
  save,
}: {
  settings: Settings;
  busy: boolean;
  save: (changes: SettingsPatch['changes']) => void;
}) {
  const [name, setName] = useState(settings.profile.displayName ?? '');
  const [timezone, setTimezone] = useState(settings.profile.timezone);
  const [units, setUnits] = useState(settings.profile.units);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    save({ display_name: name.trim() || null, timezone, units });
  }
  return (
    <form className="settings-form" onSubmit={submit}>
      <label>
        Display name
        <input
          name="display_name"
          maxLength={200}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Timezone
        <input
          name="timezone"
          aria-describedby="timezone-hint"
          required
          maxLength={100}
          value={timezone}
          disabled={busy}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </label>
      <p id="timezone-hint" className="field-hint">
        Use an IANA timezone, such as America/New_York or UTC.
      </p>
      <label htmlFor="profile-units">Units</label>
      <select
        id="profile-units"
        name="units"
        value={units}
        disabled={busy}
        onChange={(event) =>
          setUnits(event.target.value as 'metric' | 'imperial')
        }
      >
        <option value="metric">Metric</option>
        <option value="imperial">Imperial</option>
      </select>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
function BudgetForm({
  settings,
  busy,
  save,
}: {
  settings: Settings;
  busy: boolean;
  save: (changes: SettingsPatch['changes']) => void;
}) {
  const [preference, setPreference] = useState(
    settings.budget.preferenceUSD ?? '',
  );
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        save({ monthly_spending_preference_usd: preference || null });
      }}
    >
      <label>
        Personal spending limit (USD)
        <input
          inputMode="decimal"
          pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
          maxLength={80}
          value={preference}
          disabled={busy || settings.budget.state === 'unconfigured'}
          onChange={(event) => setPreference(event.target.value)}
          aria-describedby="spending-preference-hint"
        />
      </label>
      <p id="spending-preference-hint" className="field-hint">
        Choose a monthly limit within your account AI allocation, assigned by
        the app operator. Leave blank to use that allocation. Changing this
        limit does not replenish spent funds.
      </p>
      <Button
        type="submit"
        disabled={busy || settings.budget.state === 'unconfigured'}
      >
        Save personal spending limit
      </Button>
    </form>
  );
}
export function SettingsPage() {
  const { state, scope, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const key = ['settings', session?.user.id, epoch];
  const settings = useQuery({
    queryKey: key,
    enabled: !!session,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(SettingsSchema).parse(
        await ownedJson('/api/settings', session!.access_token, scope, epoch, {
          signal,
        }),
      ).data,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (changes: SettingsPatch['changes']) => {
      const value = await ownedJson(
        '/api/settings',
        session!.access_token,
        scope,
        epoch,
        {
          method: 'PATCH',
          body: JSON.stringify({
            client_request_id: crypto.randomUUID(),
            expected_updated_at: settings.data!.profile.updatedAt,
            changes,
          }),
        },
      );
      return successEnvelopeSchema(SettingsSchema).parse(value).data;
    },
    onMutate: () => setNotice(''),
    onSuccess: (data) => {
      scope.commit(epoch, () => {
        queryClient.setQueryData(key, data);
        setNotice('Settings saved. AI remains unavailable.');
      });
    },
    onError: (error) => {
      scope.commit(epoch, () =>
        setNotice(
          error instanceof Error
            ? error.message
            : 'Settings could not be saved.',
        ),
      );
    },
  });
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Clear choices. Personal control.</p>
        <h1 tabIndex={-1}>Settings</h1>
        <p>Your profile and consent belong to this account.</p>
      </header>
      <div className="settings-stack">
        <Card className="settings-card">
          <h2>Account</h2>
          <p>{session?.user.email}</p>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
        {settings.isPending ? (
          <p role="status">Loading your settings…</p>
        ) : settings.isError ? (
          <Card>
            <p role="alert">
              Your settings could not be loaded. Sign in again if your session
              expired.
            </p>
            <Button variant="outline" onClick={() => void settings.refetch()}>
              Retry settings
            </Button>
          </Card>
        ) : (
          <>
            <Card className="settings-card">
              <h2>Profile</h2>
              <ProfileForm
                key={settings.data.profile.updatedAt}
                settings={settings.data}
                busy={mutation.isPending}
                save={(changes) => mutation.mutate(changes)}
              />
              <p role="status">{notice}</p>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setNotice('');
                  void settings.refetch();
                }}
              >
                Refresh settings
              </Button>
            </Card>
            <Card className="settings-card">
              <h2>Provider consent</h2>
              <p>
                Providers receive data only through separately enabled,
                permitted requests. No model calls are available in this
                version.
              </p>
              {settings.data.providerConsents.map((consent) => (
                <section className="consent-section" key={consent.provider}>
                  <h3>
                    {consent.provider === 'openrouter'
                      ? 'OpenRouter'
                      : 'Google Cloud'}
                  </h3>
                  <p>{consent.notice}</p>
                  <p>
                    {consent.accepted
                      ? 'Allowed for future requests. AI remains unavailable.'
                      : 'Not allowed for new requests.'}
                  </p>
                  {(consent.acceptanceAvailable ||
                    consent.acceptedVersion !== null) && (
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          provider_consent: {
                            provider: consent.provider,
                            accepted:
                              !consent.accepted &&
                              consent.acceptedVersion === null,
                            policy_version: consent.policyVersion,
                          },
                        })
                      }
                    >
                      {consent.acceptedVersion !== null
                        ? `Revoke ${consent.provider === 'openrouter' ? 'OpenRouter' : 'Google Cloud'}`
                        : 'Allow OpenRouter'}
                    </Button>
                  )}
                </section>
              ))}
            </Card>
            <Card className="settings-card">
              <h2>Spending</h2>
              <p>
                Calendar-month UTC accounting. Requests settle into their
                admission month, including after a reset.
              </p>
              {settings.data.budget.state === 'unconfigured' ? (
                <p>
                  No account AI allocation is configured. AI remains
                  unavailable.
                </p>
              ) : (
                <dl className="settings-facts">
                  <div>
                    <dt>Account AI allocation</dt>
                    <dd>${settings.data.budget.allocationUSD}</dd>
                  </div>
                  <div>
                    <dt>Recorded spend</dt>
                    <dd>${settings.data.budget.spentUSD}</dd>
                  </div>
                  <div>
                    <dt>Reserved, including uncertain charges</dt>
                    <dd>${settings.data.budget.reservedUSD}</dd>
                  </div>
                  <div>
                    <dt>Available account allocation</dt>
                    <dd>
                      ${settings.data.budget.availableUSD}; the app AI spending
                      limit also applies.
                    </dd>
                  </div>
                </dl>
              )}
              <BudgetForm
                key={settings.data.profile.updatedAt}
                settings={settings.data}
                busy={mutation.isPending}
                save={(changes) => mutation.mutate(changes)}
              />
              <p className="detail-note">
                Unknown charges retain their reservation for 24 hours, then
                settle conservatively when checked or maintained. Requests
                require provider verification, activation, consent and available
                allocation.
              </p>
            </Card>
            <Card className="settings-card">
              <h2>Privacy and availability</h2>
              <dl className="settings-facts">
                <div>
                  <dt>Full AI payload retention</dt>
                  <dd>
                    {settings.data.retention.traceDays} days; expired content is
                    unavailable even before cleanup.
                  </dd>
                </div>
                <div>
                  <dt>Import staging retention</dt>
                  <dd>{settings.data.retention.importStagingHours} hours</dd>
                </div>
                <div>
                  <dt>Connections</dt>
                  <dd>CSV/manual now; Android Health Connect planned.</dd>
                </div>
                <div>
                  <dt>AI</dt>
                  <dd>
                    {settings.data.inferenceAvailability?.state === 'available'
                      ? 'Luna configured. Requests still require consent and budget.'
                      : 'Unavailable until provider verification and activation pass.'}{' '}
                    Consent does not enable inference.
                  </dd>
                </div>
              </dl>
              <p className="detail-note">
                The deployment operator controls the database and encryption
                keys. Vulpes is not end-to-end encrypted against the operator.
              </p>
            </Card>
            <AccountActions />
          </>
        )}
      </div>
    </>
  );
}
