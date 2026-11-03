import { expect, it } from 'vitest';
import { formatMeasurement } from '../../src/features/data/format.js';

it('rounds display independently while retaining nonzero small readings and changes', () => {
  expect(formatMeasurement(68.0388555, 'en-US')).toBe('68.039');
  expect(formatMeasurement(0, 'en-US')).toBe('0');
  expect(formatMeasurement(0.0001, 'en-US')).toBe('1E-4');
  expect(formatMeasurement(-0.0001, 'en-US')).toBe('-1E-4');
});
