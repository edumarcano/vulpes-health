import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertProject, isLocalDockerHost, localEnvironment, parseLocalStatus } from '../../scripts/local-database.js';

const config = readFileSync('supabase/config.toml', 'utf8');
it('restricts the test harness to the dedicated project and disabled public signup', () => {
  expect(() => assertProject(config)).not.toThrow();
  for (const changed of [config.replace('vulpes-health-pr03-test', 'production'), config.replace('enable_signup = false', 'enable_signup = true'), config.replace('54322', '54323')]) {
    expect(() => assertProject(changed)).toThrow();
  }
});
it.each(['tcp://remote:2375', 'ssh://operator@example.test', 'http://127.0.0.1:2375'])('rejects remote Docker endpoint %s', (endpoint) => {
  expect(isLocalDockerHost(endpoint)).toBe(false);
  expect(() => localEnvironment({ DOCKER_HOST: endpoint })).toThrow();
  expect(() => localEnvironment({ docker_host: endpoint })).toThrow();
});
it.each(['unix:///var/run/docker.sock', 'npipe:////./pipe/dockerDesktopLinuxEngine'])('allows local Docker endpoint %s', (endpoint) => {
  expect(isLocalDockerHost(endpoint)).toBe(true);
});
it('does not forward cloud credentials or live-provider configuration to the CLI', () => {
  expect(localEnvironment({ PATH: 'synthetic-path', SUPABASE_ACCESS_TOKEN: 'private', OPENROUTER_API_KEY: 'private', VULPES_LIVE_AI_ENABLED: 'true' }))
    .toEqual({ PATH: 'synthetic-path', DO_NOT_TRACK: '1' });
});
it('validates status endpoints before using any administrative key', () => {
  const status = { API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres', ANON_KEY: 'synthetic-public', SERVICE_ROLE_KEY: 'synthetic-admin' };
  expect(parseLocalStatus(JSON.stringify(status)).apiUrl).toBe(status.API_URL);
  for (const changed of [{ ...status, API_URL: 'https://remote.example.test' }, { ...status, DB_URL: 'postgresql://postgres@remote.example.test/postgres' }, { ...status, SERVICE_ROLE_KEY: '' }]) {
    expect(() => parseLocalStatus(JSON.stringify(changed))).toThrow();
  }
});
