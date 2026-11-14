import assert from 'node:assert/strict';

export type ProductSnapshot = Record<string, Array<Record<string, unknown>>>;

// Compare complete rows, allowing only the documented M1 cutover transitions.
export function assertImportUpgradePreserved(
  before: ProductSnapshot,
  after: ProductSnapshot,
) {
  const expected = structuredClone(before);
  expected.data_sources = expected.data_sources!.map((row) => ({
    ...row,
    import_defaults: null,
    settings_version: 1,
  }));
  expected.measurements = expected.measurements!.map((row) => ({
    ...row,
    event_id: null,
  }));
  expected.import_batches = expected.import_batches!.map((row) => ({
    ...row,
    contract_version: 1,
    adapter_version: null,
    registry_version: null,
    normalized_hash: null,
    source_rows: 0,
    event_count: 0,
    enriched_count: 0,
    mapping: null,
    ...(row.status === 'previewed'
      ? { status: 'failed', staging_payload_id: null }
      : {}),
  }));
  expected.private_payloads = expected.private_payloads!.filter(
    (row) =>
      row.purpose !== 'import_staging' ||
      expected.import_batches!.some(
        (batch) =>
          batch.user_id === row.user_id && batch.staging_payload_id === row.id,
      ),
  );
  expected.action_proposals = expected.action_proposals!.map((row) => ({
    ...row,
    private_content_removed_at: null,
    ...(row.state === 'pending'
      ? { state: 'conflicted', canonical_payload: null }
      : {}),
  }));
  expected.goal_revisions = expected.goal_revisions!.map((row) => ({
    ...row,
    private_content_removed_at: null,
  }));
  assert.deepEqual(
    after,
    expected,
    'Upgrade changed data outside the permitted M1 staging/proposal invalidations and column defaults.',
  );
}
