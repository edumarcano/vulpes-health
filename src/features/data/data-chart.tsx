import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { Granularity, MeasurementDTO } from '../../../shared/domain';

export default function DataChart({
  data,
}: {
  data: {
    unit: string;
    granularity: Granularity;
    timezone: string;
    series: Array<{ localDate: string; value: number | null }>;
    readings: MeasurementDTO[];
  };
}) {
  const [connect, setConnect] = useState(true);
  const [raw, setRaw] = useState(true);
  const rawPoints = data.readings.map((reading) => ({
    localDate:
      reading.localDate ??
      Temporal.Instant.from(reading.observedAt)
        .toZonedDateTimeISO(data.timezone)
        .toPlainDate()
        .toString(),
    value: Number(reading.canonicalValue ?? reading.value),
  }));
  if (data.granularity === 'session_total')
    return (
      <p>
        Session observations are listed individually in the table. They are not
        combined into daily totals.
      </p>
    );
  return (
    <figure className="data-chart">
      <figcaption id="chart-caption">
        {data.granularity === 'daily_total'
          ? 'Selected daily totals'
          : 'Daily medians of observed readings'}{' '}
        ({data.unit}). Gaps represent missing or conflicting data. The
        measurement table provides individual readings.
      </figcaption>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          <input
            type="checkbox"
            checked={connect}
            onChange={(event) => setConnect(event.target.checked)}
          />{' '}
          Connect daily points
        </label>
        {rawPoints.length > 0 && (
          <label>
            <input
              type="checkbox"
              checked={raw}
              onChange={(event) => setRaw(event.target.checked)}
            />{' '}
            Show loaded raw readings
          </label>
        )}
      </div>
      {rawPoints.length > 0 && (
        <p className="text-xs">
          Raw points show the loaded measurement-table pages; load more readings
          to inspect additional points. The daily calculation covers the full
          selected interval.
        </p>
      )}
      <div
        role="img"
        aria-labelledby="chart-caption"
        className="data-chart-canvas"
      >
        <ResponsiveContainer width="100%" height={260} minWidth={0}>
          <LineChart
            data={data.series}
            margin={{ top: 12, right: 18, left: 0, bottom: 12 }}
            accessibilityLayer
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="localDate"
              allowDuplicatedCategory={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              minTickGap={30}
            />
            <YAxis
              domain={['auto', 'auto']}
              width={60}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--card)',
                color: 'var(--foreground)',
                borderColor: 'var(--border)',
              }}
            />
            <Line
              type="linear"
              dataKey="value"
              stroke={connect ? 'var(--accent-foreground)' : 'none'}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {raw && rawPoints.length > 0 && (
              <Line
                name="Raw reading"
                data={rawPoints}
                dataKey="value"
                stroke="none"
                dot={{ r: 2, fill: 'var(--muted-foreground)' }}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
