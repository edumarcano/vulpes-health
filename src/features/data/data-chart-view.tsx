import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { DataSummary } from '../../../shared/data';

const DataChart = lazy(() => import('./data-chart'));
class ChartBoundary extends Component<
  { children: ReactNode },
  { kind: 'ready' | 'failed' }
> {
  state: { kind: 'ready' | 'failed' } = { kind: 'ready' };
  static getDerivedStateFromError(): { kind: 'failed' } {
    return { kind: 'failed' };
  }
  render() {
    return this.state.kind === 'failed' ? (
      <div role="alert">
        <p>
          The chart could not be loaded. Your measurements remain available in
          the table.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload chart
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function DataChartView({ data }: { data: DataSummary }) {
  return (
    <ChartBoundary>
      <Suspense fallback={<p role="status">Loading chart…</p>}>
        <DataChart data={data} />
      </Suspense>
    </ChartBoundary>
  );
}
