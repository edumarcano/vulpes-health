import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Database, MessageCircle, Settings, Target } from 'lucide-react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { LoginPage } from '@/features/auth/login-page';
import { useAuth } from '@/lib/auth/auth-context';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DeletionPage } from '@/features/settings/deletion-page';
const AskPage = lazy(() =>
  import('@/features/ask/ask-page').then((m) => ({ default: m.AskPage })),
);
const DataPage = lazy(() =>
  import('@/features/data/data-page').then((m) => ({ default: m.DataPage })),
);
const GoalsPage = lazy(() =>
  import('@/features/goals/goals-page').then((m) => ({ default: m.GoalsPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page').then((m) => ({
    default: m.SettingsPage,
  })),
);

const destinations = [
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert">
        <p>This page could not be loaded.</p>
        <Button onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function PageContent({
  children,
  focus,
}: {
  children: ReactNode;
  focus: boolean;
}) {
  useEffect(() => {
    if (focus) {
      document.querySelector<HTMLElement>('#main h1')?.focus();
      window.scrollTo(0, 0);
    }
  }, [focus]);
  return children;
}

function Protected({
  children,
  focus,
}: {
  children: ReactNode;
  focus: boolean;
}) {
  const { state, scope } = useAuth();
  const { pathname } = useLocation();
  if (state.kind === 'restoring' || state.kind === 'checking_account')
    return <p role="status">Verifying your account…</p>;
  if (
    state.kind === 'deleting' ||
    state.kind === 'deletion_completed' ||
    state.kind === 'account_unavailable'
  )
    return <DeletionPage />;
  if (state.kind !== 'signed_in')
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(pathname)}`}
        replace
      />
    );
  return (
    <div
      key={`${state.session.user.id}:${scope.epoch}`}
      className={
        pathname === '/ask' ? 'h-full flex flex-col flex-1 min-h-0' : undefined
      }
    >
      <PageBoundary key={pathname}>
        <Suspense fallback={<p role="status">Loading page…</p>}>
          <PageContent focus={focus}>{children}</PageContent>
        </Suspense>
      </PageBoundary>
    </div>
  );
}

function NotFoundPage() {
  return (
    <>
      <header className="page-heading">
        <h1 tabIndex={-1}>Page not found</h1>
        <p>This page is not part of the Vulpes preview.</p>
      </header>
      <Button asChild>
        <NavLink to="/ask">Return to Ask Vulpes</NavLink>
      </Button>
    </>
  );
}

export function App() {
  const { state } = useAuth();
  const { pathname, key: locationKey } = useLocation();
  const [initialLocationKey] = useState(locationKey);
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = main.current?.querySelector('h1');
    const title =
      pathname === '/ask'
        ? 'Ask Vulpes'
        : (destinations.find((item) => item.to === pathname)?.label ??
          (pathname === '/login' ? 'Sign in' : 'Page not found'));
    document.title = `${title} · Vulpes`;
    if (previousPath.current !== pathname) {
      heading?.focus();
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
  }, [pathname]);

  return (
    <div className={`app-shell${pathname === '/ask' ? ' app-shell-ask' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="brand-header">
        <NavLink to="/ask" aria-label="Vulpes home" className="brand-link">
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              srcSet="/brand/vulpes-reversed.png"
            />
            <img
              src="/brand/vulpes-horizontal.png"
              alt="Vulpes"
              width={2945}
              height={940}
            />
          </picture>
        </NavLink>
      </header>
      {state.kind === 'signed_in' && (
        <nav className="primary-nav" aria-label="Primary">
          {destinations.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-link${isActive ? ' active' : ''}`
              }
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={`main-content${pathname === '/ask' ? ' main-ask' : ''}`}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/ask" replace />} />
          <Route
            path="/ask"
            element={
              <Protected focus={initialLocationKey !== locationKey}>
                <AskPage />
              </Protected>
            }
          />
          <Route
            path="/goals"
            element={
              <Protected focus={initialLocationKey !== locationKey}>
                <GoalsPage />
              </Protected>
            }
          />
          <Route
            path="/data"
            element={
              <Protected focus={initialLocationKey !== locationKey}>
                <DataPage />
              </Protected>
            }
          />
          <Route
            path="/settings"
            element={
              <Protected focus={initialLocationKey !== locationKey}>
                <SettingsPage />
              </Protected>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
