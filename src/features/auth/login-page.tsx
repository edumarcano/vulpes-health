import { useState, type SubmitEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-context';

export function LoginPage() {
  const { state,signIn } = useAuth();
  const [search] = useSearchParams();
  const [password,setPassword] = useState('');
  const [email,setEmail] = useState('');
  if (state.kind === 'signed_in') return <Navigate to={['/ask','/goals','/data','/settings'].includes(search.get('returnTo') ?? '') ? search.get('returnTo')! : '/ask'} replace />;
  const unavailable = state.kind === 'unconfigured';
  const busy = state.kind === 'restoring' || state.kind === 'signing_in' || state.kind === 'signing_out';
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const secret = password; setPassword(''); await signIn(email.trim(),secret);
  }
  return <>
    <header className="page-heading"><p className="eyebrow">Personal Health Intelligence</p><h1 tabIndex={-1}>Sign in to Vulpes</h1><p>Your account keeps your measurements, goals and preferences separate.</p></header>
    <Card className="settings-card">
      {unavailable ? <p role="status">Sign-in is not configured. Ask the operator to connect authentication.</p> : <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label>Email<input name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
        <Button type="submit" disabled={busy}>{state.kind === 'signing_in' ? 'Signing in…' : 'Sign in'}</Button>
        <p role="status">{state.kind === 'restoring' ? 'Restoring your session…' : state.kind === 'signing_out' ? 'Signing out…' : state.message}</p>
      </form>}
      <p className="detail-note">Private accounts are provisioned by the operator. Public signup is unavailable. Vulpes is a wellness prototype, not a diagnostic or emergency-monitoring service. The operator controls the backend and can access stored data.</p>
    </Card>
  </>;
}
