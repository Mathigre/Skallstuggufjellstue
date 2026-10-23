-- Run in one transaction; fixtures, notification jobs and queued mail roll back.
begin;
do $$
declare t uuid:=gen_random_uuid(); answer uuid:=gen_random_uuid(); first_at timestamptz:=now()-interval '10 minutes'; result jsonb; j uuid; total int;
begin
 result:=public.mail_ingest(jsonb_build_object('new_thread_id',t,'provider_key','probe:'||t,'source','contact','direction','incoming','sender_name','Test Person','sender_email','probe@example.invalid','contact_email','probe@example.invalid','phone','99988777','subject','Rollback test only','body','Denne testen blir rullet tilbake.','received_at',first_at,'notify',true));
 if (result->>'thread_id')::uuid<>t then raise exception 'Wrong thread'; end if;
 result:=public.mail_ingest(jsonb_build_object('new_thread_id',t,'provider_key','probe:'||t,'source','contact','direction','incoming','sender_email','probe@example.invalid','contact_email','probe@example.invalid','subject','Duplicate','body','Duplicate','received_at',first_at));
 if not (result->>'duplicate')::boolean then raise exception 'Idempotency failed'; end if;
 select count(*) into total from public.mail_messages where thread_id=t;
 if total<>1 then raise exception 'Duplicate stored'; end if;
 if (select count(*) from public.mail_jobs where message_id in(select id from public.mail_messages where thread_id=t))<>2 then raise exception 'Notification jobs missing'; end if;
 result:=public.mail_ingest(jsonb_build_object('thread_id',t,'provider_key','reply:'||answer,'source','contact','direction','outgoing','sender_email','minsten.mg@gmail.com','contact_email','probe@example.invalid','subject','Reply','body','This is never actually sent.','received_at',first_at+interval '1 minute','delivery_state','queued','reply_through_at',first_at));
 if (select answered_through_at is not null from public.mail_threads where id=t) then raise exception 'Queued reply marked answered'; end if;
 perform public.mail_ingest(jsonb_build_object('thread_id',t,'provider_key','followup:'||t,'source','gmail','direction','incoming','sender_email','probe@example.invalid','contact_email','probe@example.invalid','subject','Followup','body','A newer question arrives while reply is queued.','received_at',first_at+interval '2 minutes'));
 select id into j from public.mail_jobs where kind='reply' and message_id=(result->>'message_id')::uuid;
 perform public.mail_complete_job(j,'test-provider-id');
 if not (select last_incoming_at>answered_through_at from public.mail_threads where id=t) then raise exception 'New question incorrectly marked answered'; end if;
 perform public.mail_complete_job(j,'test-provider-id');
 if (select state from public.mail_jobs where id=j)<>'done' then raise exception 'Job completion failed'; end if;
 if has_table_privilege('anon','public.mail_threads','SELECT') then raise exception 'Public mail read access'; end if;
 if has_function_privilege('authenticated','public.mail_ingest(jsonb)','EXECUTE') then raise exception 'User can bypass mail intake'; end if;
 if has_function_privilege('anon','public.mail_read_refresh()','EXECUTE') then raise exception 'Token RPC exposed'; end if;
 if not (select bool_and(relrowsecurity) from pg_class where oid in('public.mail_threads'::regclass,'public.mail_messages'::regclass,'public.mail_jobs'::regclass,'public.mail_connection'::regclass,'public.mail_oauth_states'::regclass)) then raise exception 'RLS missing'; end if;
end $$;
select 'mail_transaction_and_access_checks_passed' as result;
rollback;
