import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { localStatus } from '../../scripts/local-database.js';
import {
  cleanupTables,
  databaseGraph,
  databaseTables,
} from '../fixtures/database-graph.js';
import type { DatabaseGraph } from '../fixtures/database-graph.js';

export class LocalSupabase {
  private readonly status = localStatus();
  private readonly users: string[] = [];
  private appId: string | undefined;
  private seededReservations = 0;

  async request(route: string, token: string | null, init: RequestInit = {}) {
    assert(
      route.startsWith('/rest/v1/') || route.startsWith('/auth/v1/'),
      'Unexpected test route.',
    );
    assert(!route.includes('://'), 'Absolute URLs are forbidden.');
    const key = token === 'admin' ? this.status.adminKey : this.status.anonKey;
    const bearer = token === 'admin' || token === 'anon' ? key : token;
    return fetch(`${this.status.apiUrl}${route}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...init.headers,
        apikey: key,
        ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
        'Content-Type': 'application/json',
      },
    });
  }

  async admin(route: string, method: string, body?: unknown) {
    const response = await this.request(route, 'admin', {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Do not include response bodies or credentials in assertion output.
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      const code =
        typeof failure?.code === 'string' &&
        /^[A-Z0-9]{4,12}$/.test(failure.code)
          ? failure.code
          : 'unavailable';
      assert.fail(
        `Synthetic setup/cleanup failed (${method}, HTTP ${response.status}, code ${code}).`,
      );
    }
    return response;
  }

  async createUser(): Promise<{
    id: string;
    token: string;
    email: string;
    password: string;
  }> {
    const email = `pr03-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const created = await this.admin('/auth/v1/admin/users', 'POST', {
      email,
      password,
      email_confirm: true,
    });
    const user = (await created.json()) as { id: string };
    assert(typeof user.id === 'string', 'Local Auth did not return a user ID.');
    this.users.push(user.id);
    const signedIn = await this.request(
      '/auth/v1/token?grant_type=password',
      'anon',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    );
    if (!signedIn.ok) {
      const error = (await signedIn.json()) as {
        error_code?: string;
        code?: string;
      };
      throw new Error(
        `Synthetic password sign-in failed (HTTP ${signedIn.status}, code ${error.error_code ?? error.code ?? 'unknown'}).`,
      );
    }
    const session = (await signedIn.json()) as {
      access_token: string;
      user: { id: string };
    };
    assert.equal(session.user.id, user.id);
    assert(typeof session.access_token === 'string');
    return { id: user.id, token: session.access_token, email, password };
  }

  async seed(
    userId: string,
    budgetSchema: 'current' | 'legacy' = 'current',
  ): Promise<DatabaseGraph> {
    if (!this.appId) {
      this.appId = randomUUID();
      await this.admin('/rest/v1/usage_buckets', 'POST', {
        id: this.appId,
        scope: budgetSchema === 'legacy' ? 'household' : 'app',
        period_start: '2026-10-01',
        allocated_ceiling_usd: '20.00',
      });
    }
    const graph = databaseGraph(userId, this.appId);
    if (budgetSchema === 'legacy') {
      graph.rows.usage_buckets.scope = 'user';
      const reservation = graph.rows.usage_reservations;
      reservation.user_bucket_id = reservation.account_bucket_id;
      reservation.household_bucket_id = reservation.app_bucket_id;
      delete reservation.account_bucket_id;
      delete reservation.app_bucket_id;
    }
    for (const table of databaseTables)
      await this.admin(`/rest/v1/${table}`, 'POST', graph.rows[table]);
    this.seededReservations++;
    await this.admin(`/rest/v1/usage_buckets?id=eq.${this.appId}`, 'PATCH', {
      reserved_usd: (this.seededReservations / 10).toFixed(2),
    });
    await this.admin(`/rest/v1/goals?id=eq.${graph.ids.goals}`, 'PATCH', {
      current_revision_id: graph.ids.goal_revisions,
    });
    return graph;
  }

  async cleanup(): Promise<void> {
    const failures: string[] = [];
    for (const userId of this.users) {
      try {
        await this.admin(`/rest/v1/goals?user_id=eq.${userId}`, 'PATCH', {
          state: 'draft',
          current_revision_id: null,
        });
        for (const table of cleanupTables)
          await this.admin(`/rest/v1/${table}?user_id=eq.${userId}`, 'DELETE');
        const removed = await this.request(
          `/auth/v1/admin/users/${userId}`,
          'admin',
          { method: 'DELETE' },
        );
        assert(
          removed.ok || removed.status === 404,
          'Synthetic Auth cleanup failed.',
        );
      } catch {
        failures.push(
          'Synthetic user cleanup failed; inspect the disposable local database.',
        );
      }
    }
    if (this.appId) {
      try {
        await this.admin(
          `/rest/v1/usage_buckets?id=eq.${this.appId}`,
          'DELETE',
        );
      } catch {
        failures.push('Synthetic app cleanup failed.');
      }
    }
    assert.equal(failures.length, 0, failures.join(' '));
  }
}
