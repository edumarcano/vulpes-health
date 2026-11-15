import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { DataSummary } from '../../../shared/data';
import type { SeriesAnalysisResult } from '../../../shared/analysis';
import type { MeasurementDTO } from '../../../shared/domain';

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
export function DataChartView(
  props:
    | { data: DataSummary }
    | { analysis: SeriesAnalysisResult; readings?: MeasurementDTO[] },
) {
  const data =
    'data' in props
      ? {
          unit: props.data.analysis.unit,
          granularity: props.data.selection.granularity,
          timezone: props.data.selection.timezone,
          series: props.data.series,
          readings: [],
        }
      : {
          unit: props.analysis.unit,
          granularity: props.analysis.series.granularity,
          timezone: props.analysis.timezone,
          series: props.analysis.points.map((point) => ({
            localDate: point.localDate,
            value: point.value === null ? null : Number(point.value),
          })),
          readings: props.readings ?? [],
        };
  return (
    <ChartBoundary>
      <Suspense fallback={<p role="status">Loading chart…</p>}>
        <DataChart data={data} />
      </Suspense>
    </ChartBoundary>
  );
}
