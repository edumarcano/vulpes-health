begin;

-- Reimports probe only unlinked readings when attaching existing observations.
create index measurements_unlinked_source_time
 on public.measurements(user_id,source_id,observed_at) where event_id is null;

commit;
