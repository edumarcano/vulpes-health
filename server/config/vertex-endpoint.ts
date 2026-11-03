import { models } from './models.js';

export function vertexEndpoint(
  project: string,
  location: string,
  role: 'intermediate' | 'advanced',
): string {
  if (
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
    !['global', 'us', 'eu'].includes(location)
  )
    throw new Error('vertex_identity_unavailable');
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${models[role].modelId}:streamGenerateContent?alt=sse`;
}
export function isVertexEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const match =
      /^\/v1\/projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google\/models\/([^/:]+):streamGenerateContent$/.exec(
        url.pathname,
      );
    const role =
      match?.[3] === models.intermediate.modelId
        ? 'intermediate'
        : match?.[3] === models.advanced.modelId
          ? 'advanced'
          : null;
    return (
      !!match &&
      !!role &&
      endpoint === vertexEndpoint(match[1]!, match[2]!, role)
    );
  } catch {
    return false;
  }
}
