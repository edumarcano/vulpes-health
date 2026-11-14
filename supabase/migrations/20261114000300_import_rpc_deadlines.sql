begin;

alter function public.inspect_import_v2(jsonb,jsonb) set statement_timeout='30s';
alter function public.register_import_v2(uuid,text) set statement_timeout='30s';
alter function public.review_import_v2(uuid,text,uuid,text) set statement_timeout='30s';
alter function public.commit_import_v2(jsonb,text) set statement_timeout='30s';

notify pgrst,'reload schema';

commit;
