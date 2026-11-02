export function formatMeasurement(value: number, locale?: string): string {
  const options: Intl.NumberFormatOptions =
    value !== 0 && Math.abs(value) < 0.0005
      ? { notation: 'scientific', maximumSignificantDigits: 4 }
      : { maximumFractionDigits: 3 };
  return new Intl.NumberFormat(locale, options).format(value);
}
