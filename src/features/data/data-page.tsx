import { Database } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function DataPage() {
  return (
    <>
      <header className="page-heading"><p className="eyebrow">The foundation for understanding</p><h1 tabIndex={-1}>Data</h1><p>Your measurements, with their source and context.</p></header>
      <Card className="empty-card"><div className="feature-symbol"><Database aria-hidden="true" /></div><h2>No measurements loaded</h2><p>Manual entry and CSV import are not available in this foundation preview. No health records are stored or shown.</p><p className="detail-note">Planned for v0.1.0: manual measurements and CSV imports.<br />Android Health Connect is planned for a later release.</p></Card>
    </>
  );
}
