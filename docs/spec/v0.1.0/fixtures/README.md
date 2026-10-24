# Synthetic fixtures only

None of these values are the owner's measurements, desired targets or clinical recommendations. Do not replace them with personal data in source control.

`measurements-synthetic.csv` has 28 long-form observations: 14 weight values and 14 body-fat percentage values, at 08:00 UTC on September 1-14, 2026. One synthetic source is used. The expected results are in `expected-results.json`; windows are half-open and use the DATA_MODEL daily-median-then-mean definition.

`wide-synthetic.csv` and `import-mapping.example.json` demonstrate a generic column-mapping import. They are not a RENPHO export or evidence of vendor format compatibility. The blank fat value on the third day is missing, not zero, so the mapped output contains five observations.

`eval-cases.json` provides starter behavioral tests. Add the edge cases from ACCEPTANCE_TESTS during implementation. No live model test has been performed by creating these fixtures.
