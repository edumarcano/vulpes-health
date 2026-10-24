import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LivenessResponseSchema } from '../../../shared/api';

async function getLiveness({ signal }: { signal: AbortSignal }): Promise<'ok'> {
  const response = await fetch('/api/status', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('The local API could not be reached.');
  const result: unknown = await response.json();
  const parsed = LivenessResponseSchema.safeParse(result);
  if (!parsed.success) throw new Error('The local API returned an unexpected response.');
  return parsed.data.data.status;
}

export function SettingsPage() {
  const liveness = useQuery({ queryKey: ['public-liveness'], queryFn: getLiveness, retry: false, refetchOnWindowFocus: false });
  const status = liveness.status === 'pending' ? 'Checking local API…'
    : liveness.status === 'error' ? 'Local API unavailable. Check that the full local stack is running.' : 'Local API is responding.';

  return (
    <>
      <header className="page-heading"><p className="eyebrow">Clear choices. Personal control.</p><h1 tabIndex={-1}>Settings</h1><p>Know what is available and what stays off.</p></header>
      <Card className="settings-card">
        <div className="feature-symbol"><ShieldCheck aria-hidden="true" /></div>
        <h2>Foundation preview</h2>
        <p>Sign-in, profile settings, provider consent, and spending controls are not available yet.</p>
        <dl className="settings-facts">
          <div><dt>AI requests</dt><dd>Off · unavailable in this preview</dd></div>
          <div><dt>Health data</dt><dd>No records stored</dd></div>
          <div><dt>Connections</dt><dd>Manual / CSV planned; Android Health Connect later</dd></div>
        </dl>
        <p className="connection-status" role="status">{status}</p>
      </Card>
    </>
  );
}
