import { useEffect, useRef } from 'react';
import { Database, MessageCircle, Settings, Target } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from '@/features/auth/login-page';
import { useAuth } from '@/lib/auth/auth-context';
import type { ReactNode } from 'react';
import { AskPage } from '@/features/ask/ask-page';
import { DataPage } from '@/features/data/data-page';
import { GoalsPage } from '@/features/goals/goals-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { Button } from '@/components/ui/button';
import {DeletionPage} from '@/features/settings/deletion-page';

const destinations = [
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Protected({ children }: { children: ReactNode }) {
  const { state,scope } = useAuth();
  const { pathname } = useLocation();
  if (state.kind === 'restoring'||state.kind==='checking_account') return <p role="status">Verifying your account…</p>;
  if(state.kind==='deleting'||state.kind==='deletion_completed'||state.kind==='account_unavailable')return <DeletionPage />;
  if (state.kind !== 'signed_in') return <Navigate to={`/login?returnTo=${encodeURIComponent(pathname)}`} replace />;
  return <div key={`${state.session.user.id}:${scope.epoch}`}>{children}</div>;
}

function NotFoundPage() {
  return <><header className="page-heading"><h1 tabIndex={-1}>Page not found</h1><p>This page is not part of the Vulpes preview.</p></header><Button asChild><NavLink to="/ask">Return to Ask Vulpes</NavLink></Button></>;
}

export function App() {
  const { state } = useAuth();
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = main.current?.querySelector('h1');
    const title = pathname === '/ask' ? 'Ask Vulpes' : destinations.find(item => item.to === pathname)?.label
      ?? (pathname === '/login' ? 'Sign in' : 'Page not found');
    document.title = `${title} · Vulpes`;
    if (previousPath.current !== pathname) {
      heading?.focus();
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
  }, [pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="brand-header">
        <NavLink to="/ask" aria-label="Vulpes home" className="brand-link">
          <img src="/brand/vulpes-horizontal.png" alt="Vulpes" width={3200} height={800} />
        </NavLink>
        <span className="preview-label">Private wellness prototype</span>
      </header>
      {state.kind === 'signed_in' && <nav className="primary-nav" aria-label="Primary">
        {destinations.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Icon size={20} aria-hidden="true" /><span>{label}</span></NavLink>)}
      </nav>}
      <main id="main" ref={main} tabIndex={-1} className={`main-content${pathname === '/ask' ? ' main-ask' : ''}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/ask" replace />} />
          <Route path="/ask" element={<Protected><AskPage /></Protected>} />
          <Route path="/goals" element={<Protected><GoalsPage /></Protected>} />
          <Route path="/data" element={<Protected><DataPage /></Protected>} />
          <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
