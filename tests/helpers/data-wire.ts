// Keep generic fixtures readable while exercising the current HTTP wire contract.
export function dataWireBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('action' in body)) return body;
  if (body.action === 'preview_csv' && 'csv' in body) {
    const { csv, ...rest } = body;
    return {
      ...rest,
      schema_version: 2,
      csv_base64: Buffer.from(String(csv)).toString('base64'),
    };
  }
  return body.action === 'commit_import'
    ? { ...body, schema_version: 2 }
    : body;
}
