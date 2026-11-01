// Shared logical schema/row comparison used by local and hosted-source recovery.
export const recoverySchemaSql=`create temporary table normalized_constraints(schema_name text,table_name text,name text,definition text,validated boolean);
 do $$ declare c record; definition text; begin for c in select n.nspname,t.relname,p.oid,p.conname,p.contype,p.convalidated from pg_constraint p join pg_class t on t.oid=p.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','auth','storage') loop
 definition:=pg_get_constraintdef(c.oid);
 if c.contype='c' then
  execute format('create temporary table check_probe (like %I.%I)',c.nspname,c.relname);
  execute 'alter table pg_temp.check_probe add constraint canonical_check '||definition;
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='pg_temp.check_probe'::regclass and conname='canonical_check';
  drop table pg_temp.check_probe;
 end if;
 insert into normalized_constraints values(c.nspname,c.relname,c.conname,definition,c.convalidated);end loop;end $$;
 select jsonb_build_object(
 'columns',(select jsonb_agg(to_jsonb(c)-array['ordinal_position','dtd_identifier'] order by table_schema,table_name,column_name) from information_schema.columns c where table_schema in ('public','auth','storage')),
 'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner),case when p.proacl is null then null else array(select a::text from unnest(p.proacl) a order by a::text) end) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','storage') and p.prokind='f'),
 'constraints',(select jsonb_agg(to_jsonb(c) order by schema_name,table_name,name) from normalized_constraints c),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth','storage')),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in ('public','auth','storage')),
 'grants',(select jsonb_agg(to_jsonb(g) order by table_schema,table_name,grantee,privilege_type,grantor,is_grantable) from information_schema.role_table_grants g where table_schema in ('public','auth','storage')),
 'rls',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind='r'));`;
export const recoveryInventorySql=`create temporary table restore_inventory(name text,amount bigint,hash text);
 do $$ declare t record; n bigint; h text; begin for t in select schemaname,tablename from pg_tables where schemaname in ('public','auth','storage','supabase_migrations') order by schemaname,tablename loop
 execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex''),'''' order by to_jsonb(r)::text),''''),''UTF8'')),''hex'') from %I.%I r',t.schemaname,t.tablename) into n,h;
 insert into restore_inventory values(t.schemaname||'.'||t.tablename,n,h);end loop;end $$;
 select jsonb_object_agg(name,jsonb_build_object('count',amount,'hash',hash)) from restore_inventory;`;

// Hosted sources remain read-only: dynamic row aggregation returns only hashes.
export const recoveryReadInventorySql=`select jsonb_object_agg(name,jsonb_build_object('count',((xpath('/row/amount/text()',report))[1]::text)::bigint,'hash',(xpath('/row/hash/text()',report))[1]::text))
 from(select schemaname||'.'||tablename as name,query_to_xml(format('select count(*) as amount,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex''),'''' order by to_jsonb(r)::text),''''),''UTF8'')),''hex'') as hash from %I.%I r',schemaname,tablename),false,true,'') as report
 from pg_tables where schemaname in ('public','auth','storage','supabase_migrations')) inventory;`;
export const recoveryReadCatalogSql=recoverySchemaSql.slice(recoverySchemaSql.indexOf(' select jsonb_build_object(')).replace(
 "from normalized_constraints c)",
 "from(select n.nspname as schema_name,t.relname as table_name,p.conname as name,pg_get_constraintdef(p.oid) as definition,p.convalidated as validated from pg_constraint p join pg_class t on t.oid=p.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','auth','storage')) c)")
 .replace("array['ordinal_position','dtd_identifier']","array['ordinal_position','dtd_identifier','table_catalog','udt_catalog','domain_catalog']")
 .replace("'grants',(select jsonb_agg(to_jsonb(g) order by","'grants',(select jsonb_agg(to_jsonb(g)-'table_catalog' order by");

// Reparse both expected and restored CHECK expressions only inside the fenced
// destination. Equivalent pg_dump boolean trees compare without source DDL.
export function normalizeRecoveryConstraintsSql(rows:unknown[]){
 const literal=JSON.stringify(rows).replaceAll("'","''");
 return `create temporary table canonical_constraints(schema_name text,table_name text,name text,definition text,validated boolean);
 do $$ declare c record; definition text; begin for c in select * from jsonb_to_recordset('${literal}'::jsonb) as r(schema_name text,table_name text,name text,definition text,validated boolean) loop
 definition:=c.definition;
 if definition like 'CHECK %' then execute format('create temporary table check_probe (like %I.%I)',c.schema_name,c.table_name);
 execute 'alter table pg_temp.check_probe add constraint canonical_check '||definition;
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='pg_temp.check_probe'::regclass and conname='canonical_check';drop table pg_temp.check_probe;end if;
 insert into canonical_constraints values(c.schema_name,c.table_name,c.name,definition,c.validated);end loop;end $$;
 select jsonb_agg(to_jsonb(c) order by schema_name,table_name,name) from canonical_constraints c;`;
}
