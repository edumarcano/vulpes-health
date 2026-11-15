import { useEffect, useState } from 'react';

export function PwaUpdateNotice() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const changed = () => {
      if (active) setWaiting(!!registration?.waiting);
    };
    const found = () => {
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', changed);
      changed();
    };
    void navigator.serviceWorker.ready.then((value) => {
      if (!active) return;
      registration = value;
      registration.addEventListener('updatefound', found);
      found();
    });
    return () => {
      active = false;
      registration?.removeEventListener('updatefound', found);
      installing?.removeEventListener('statechange', changed);
    };
  }, []);
  return waiting ? (
    <aside role="status" className="detail-note">
      A Vulpes update is ready. Finish or discard your current activity, then
      close all Vulpes windows and reopen the app. Pending imports will check
      their saved status when reopened.
    </aside>
  ) : null;
}
