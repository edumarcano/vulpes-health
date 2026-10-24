import { useEffect, useRef } from 'react';
import { Database, MessageCircle, Settings, Target } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AskPage } from '@/features/ask/ask-page';
import { DataPage } from '@/features/data/data-page';
import { GoalsPage } from '@/features/goals/goals-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const destinations = [
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function UnavailablePage() {
  return <><header className="page-heading"><h1 tabIndex={-1}>Sign-in unavailable</h1></header><Card><h2>Accounts are not connected yet</h2><p>Authentication is not available in this foundation preview. No account has been created or signed in.</p></Card></>;
}

function NotFoundPage() {
  return <><header className="page-heading"><h1 tabIndex={-1}>Page not found</h1><p>This page is not part of the Vulpes preview.</p></header><Button asChild><NavLink to="/ask">Return to Ask Vulpes</NavLink></Button></>;
}

export function App() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = main.current?.querySelector('h1');
    document.title = `${heading?.textContent ?? 'Vulpes'} · Vulpes`;
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
          <img className="logo-light" src="/brand/vulpes-horizontal.png" alt="Vulpes" width={3200} height={800} />
          <img className="logo-dark" src="/brand/vulpes-reversed.png" alt="Vulpes" width={3200} height={1060} />
        </NavLink>
        <span className="preview-label">Foundation preview</span>
      </header>
      <nav className="primary-nav" aria-label="Primary">
        {destinations.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Icon size={20} aria-hidden="true" /><span>{label}</span></NavLink>)}
      </nav>
      <main id="main" ref={main} tabIndex={-1} className={`main-content${pathname === '/ask' ? ' main-ask' : ''}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/ask" replace />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login/*" element={<UnavailablePage />} />
          <Route path="/auth/*" element={<UnavailablePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
