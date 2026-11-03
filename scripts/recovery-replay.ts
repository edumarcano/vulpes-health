import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { DeletionJournalSchema } from '../server/services/account.js';
import { AccountStatusSchema } from '../shared/account.js';
import { recoveryRequiredPublicTables } from './recovery-database.js';
import { recoveryAccountingExpression } from './recovery-accounting.js';

type Journal = z.infer<typeof DeletionJournalSchema>;
export interface RecoveryReplayActions {
  accounting: () => Promise<string>;
  replay: (journal: Journal) => Promise<{
    deletionsReplayed: number;
    deletionSteps: number;
    unaffectedRowsPreserved: true;
    sharedChargesPreserved: true;
  }>;
  revokeSessions: () => Promise<{
    sessionsRemoved: number;
    refreshTokensRemoved: number;
  }>;
  validate: () => Promise<{
    sessionsRemaining: 0;
    refreshTokensRemaining: 0;
    profilesTested: number;
    oldSessionsTested: number;
    oldSessionsDenied: true;
    twoOwnerRlsVerified: boolean;
  }>;
}
const owned = recoveryRequiredPublicTables.filter(
  (t) =>
    ![
      'account_deletion_receipts',
      'ai_route_cost_blocks',
      'vertex_policy_approval',
    ].includes(t),
);
const jsonLiteral = (v: unknown) =>
  "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const hashQuery = (table: string, where = 'true') =>
  `select encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),'' order by to_jsonb(r)::text),''),'UTF8')),'hex') from ${table} r where ${where};`;

export function recoveryReplayActions(
  sql: (statement: string, role?: string) => string,
  assertFenced: () => Promise<void>,
  authorize: () => void,
): RecoveryReplayActions {
  let oldSessions: { id: string; user_id: string }[] = [];
  const readSessions = () =>
    z
      .array(z.object({ id: z.uuid(), user_id: z.uuid() }))
      .max(10000)
      .parse(
        JSON.parse(
          sql(
            "select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id)),'[]') from(select id,user_id from auth.sessions order by id limit 10001) s;",
          ),
        ),
      );
  async function guard() {
    authorize();
    await assertFenced();
  }
  function absence(owner: string) {
    for (const table of owned)
      if (
        sql(
          `select count(*) from public.${table} where user_id='${owner}';`,
        ) !== '0'
      )
        throw new Error('Restored deletion has owned remnants.');
    if (sql(`select count(*) from auth.users where id='${owner}';`) !== '0')
      throw new Error('Restored deletion identity remains.');
  }
  return {
    accounting: async () => {
      await guard();
      return z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(
          sql(
            'begin read only;select ' +
              recoveryAccountingExpression +
              ';rollback;',
          ),
        );
    },
    replay: async (input) => {
      const journal = DeletionJournalSchema.parse(input);
      if (
        journal.rows.length > 100 ||
        journal.rows.some((r) => r.outcome === 'waiting_for_accounting')
      )
        throw new Error(
          'Journal replay exceeds bounds or has unsettled source accounting.',
        );
      await guard();
      oldSessions = readSessions();
      const owners = journal.rows.map((r) => r.user_id),
        set = owners.length
          ? owners.map((id) => "'" + id + "'").join(',')
          : 'null';
      const unaffected = () => {
        const values: Record<string, string> = {};
        for (const table of [...owned, 'account_deletion_receipts'] as const)
          values[table] = sql(
            hashQuery(
              'public.' + table,
              owners.length
                ? `user_id is not null and user_id not in (${set})`
                : 'user_id is not null',
            ),
          );
        values.auth = sql(
          hashQuery(
            'auth.users',
            owners.length ? `id not in (${set})` : 'true',
          ),
        );
        for (const table of ['ai_route_cost_blocks', 'vertex_policy_approval'])
          values[table] = sql(hashQuery('public.' + table));
        return values;
      };
      const shared = () =>
        JSON.parse(
          sql(
            "select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('allocated_ceiling_usd',allocated_ceiling_usd::text,'spent_usd',spent_usd::text,'reserved_usd',reserved_usd::text) order by id),'[]') from public.usage_buckets b where user_id is null;",
          ),
        ) as {
          id: string;
          allocated_ceiling_usd: string;
          spent_usd: string;
          reserved_usd: string;
        }[];
      const before = unaffected(),
        buckets = shared();
      const missing = sql(
        `select count(*) from public.account_deletion_receipts where phase<>'completed' ${owners.length ? `and user_id not in (${set})` : ''};`,
      );
      if (missing !== '0')
        throw new Error('Current journal omits a restored unfinished request.');
      let steps = 0;
      for (const row of journal.rows) {
        await guard();
        const owner = row.user_id,
          existing = JSON.parse(
            sql(
              `select coalesce((select to_jsonb(d) from public.account_deletion_receipts d where user_id='${owner}'),'null');`,
            ),
          ) as { id: string; phase: string } | null;
        if (
          existing &&
          (existing.id !== row.id ||
            (existing.phase === 'completed' && row.phase !== 'completed'))
        )
          throw new Error('Restored journal identity or phase conflicts.');
        const profile =
          sql(
            `select count(*) from public.profiles where user_id='${owner}';`,
          ) === '1';
        if (profile) {
          if (existing?.phase === 'completed')
            throw new Error('Completed deletion has a restored profile.');
          sql(
            `begin;select public.begin_account_deletion_v1('${owner}',clock_timestamp());update public.account_deletion_receipts set id='${row.id}',requested_at='${row.requested_at}'::timestamptz where user_id='${owner}';commit;`,
            'supabase_admin',
          );
        } else if (!existing) {
          // Accounts created after the backup have no restored data. Retain their
          // independent authorization and verify absence before recording completion.
          sql(
            `insert into public.account_deletion_receipts(user_id,id,phase,requested_at) values('${owner}','${row.id}','auth_removal_pending','${row.requested_at}'::timestamptz);`,
            'supabase_admin',
          );
        }
        let completed = false;
        for (let pass = 0; pass < 100; pass++) {
          if (++steps > 1000)
            throw new Error('Recovery deletion continuation limit reached.');
          await guard();
          const status = AccountStatusSchema.parse(
            JSON.parse(
              sql(
                `select public.continue_account_deletion_v1('${owner}',100);`,
                'supabase_admin',
              ),
            ),
          );
          if (
            status.state !== 'deleting' ||
            status.outcome === 'waiting_for_accounting'
          )
            throw new Error(
              'Recovery deletion is unconfirmed or waiting for accounting.',
            );
          if (status.phase === 'auth_removal_pending') {
            sql(
              `begin;delete from auth.refresh_tokens where user_id='${owner}';delete from auth.sessions where user_id='${owner}';delete from auth.users where id='${owner}';select public.finish_account_deletion_v1('${owner}',true);commit;`,
              'supabase_admin',
            );
          }
          if (
            status.phase === 'completed' ||
            status.phase === 'auth_removal_pending'
          ) {
            absence(owner);
            completed = true;
            break;
          }
        }
        if (!completed)
          throw new Error('Recovery deletion remains unfinished.');
        if (row.phase === 'completed')
          sql(
            `update public.account_deletion_receipts set requested_at='${row.requested_at}'::timestamptz,completed_at='${row.completed_at}'::timestamptz,updated_at='${row.updated_at}'::timestamptz where user_id='${owner}' and phase='completed';`,
            'supabase_admin',
          );
        const receipt = JSON.parse(
          sql(
            `select to_jsonb(d) from public.account_deletion_receipts d where user_id='${owner}';`,
          ),
        ) as { id: string; phase: string };
        if (receipt.id !== row.id || receipt.phase !== 'completed')
          throw new Error('Recovery completion receipt mismatch.');
      }
      if (!isDeepStrictEqual(before, unaffected()))
        throw new Error('Unaffected recovery data changed.');
      const after = shared();
      if (
        after.length !== buckets.length ||
        after.some(
          (b, i) =>
            !isDeepStrictEqual(
              { ...b, spent_usd: undefined, reserved_usd: undefined },
              { ...buckets[i]!, spent_usd: undefined, reserved_usd: undefined },
            ) ||
            new Decimal(b.spent_usd).lt(buckets[i]!.spent_usd) ||
            new Decimal(b.reserved_usd).lt(0),
        )
      )
        throw new Error(
          'Shared recovery allocation or charges changed unsafely.',
        );
      return {
        deletionsReplayed: journal.rows.length,
        deletionSteps: steps,
        unaffectedRowsPreserved: true,
        sharedChargesPreserved: true,
      };
    },
    revokeSessions: async () => {
      await guard();
      oldSessions = [
        ...new Map(
          [...oldSessions, ...readSessions()].map((s) => [s.id, s]),
        ).values(),
      ];
      if (oldSessions.length > 10000)
        throw new Error('Restored session inventory exceeds bounds.');
      const counts = JSON.parse(
        sql(
          "begin;select jsonb_build_object('sessionsRemoved',(select count(*) from auth.sessions),'refreshTokensRemoved',(select count(*) from auth.refresh_tokens));delete from auth.refresh_tokens;delete from auth.sessions;commit;",
          'supabase_admin',
        ),
      ) as { sessionsRemoved: number; refreshTokensRemoved: number };
      return counts;
    },
    validate: async () => {
      await guard();
      if (
        sql('select count(*) from auth.sessions;') !== '0' ||
        sql('select count(*) from auth.refresh_tokens;') !== '0'
      )
        throw new Error('Restored sessions were not revoked.');
      for (const s of oldSessions) {
        const claims = {
          sub: s.user_id,
          role: 'authenticated',
          session_id: s.id,
        };
        const valid = sql(
          `begin;set local role authenticated;set local request.jwt.claims=${jsonLiteral(claims).replace(/::jsonb$/, '')};select public.owned_session_valid_v1();rollback;`,
        );
        if (valid !== 'f')
          throw new Error('Restored old session is still accepted.');
      }
      const users = z
        .array(z.object({ user_id: z.uuid() }))
        .max(2)
        .parse(
          JSON.parse(
            sql(
              "select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id)),'[]') from(select user_id from public.profiles where account_state='active' order by user_id limit 2) p;",
            ),
          ),
        );
      for (const u of users) {
        const session = randomUUID(),
          claims = {
            sub: u.user_id,
            role: 'authenticated',
            session_id: session,
          };
        const proof = JSON.parse(
          sql(
            `begin;insert into auth.sessions(id,user_id) values('${session}','${u.user_id}');set local role authenticated;set local request.jwt.claims=${jsonLiteral(claims).replace(/::jsonb$/, '')};select jsonb_build_object('valid',public.owned_session_valid_v1(),'owned',(select count(*) from public.profiles where user_id='${u.user_id}'),'foreign',(select count(*) from public.profiles where user_id<>'${u.user_id}'),'foreignConversations',(select count(*) from public.conversations where user_id<>'${u.user_id}'),'privateAllowed',has_table_privilege('authenticated','public.private_payloads','select'));rollback;`,
            'supabase_admin',
          ),
        ) as {
          valid: boolean;
          owned: number;
          foreign: number;
          foreignConversations: number;
          privateAllowed: boolean;
        };
        if (
          !proof.valid ||
          proof.owned !== 1 ||
          proof.foreign !== 0 ||
          proof.foreignConversations !== 0 ||
          proof.privateAllowed
        )
          throw new Error('Restored SQL role isolation failed.');
      }
      if (sql('select count(*) from auth.sessions;') !== '0')
        throw new Error('Recovery probe session persisted.');
      return {
        sessionsRemaining: 0,
        refreshTokensRemaining: 0,
        profilesTested: users.length,
        oldSessionsTested: oldSessions.length,
        oldSessionsDenied: true,
        twoOwnerRlsVerified: users.length === 2,
      };
    },
  };
}
