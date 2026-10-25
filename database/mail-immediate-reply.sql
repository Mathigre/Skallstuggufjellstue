create function public.mail_claim_reply(p_message_id uuid) returns setof public.mail_jobs language sql set search_path='' as $$
 update public.mail_jobs j set state='processing',locked_until=now()+interval '3 minutes',attempts=attempts+1
 where j.id in(select id from public.mail_jobs where message_id=p_message_id and kind='reply' and ((state='pending' and next_at<=now()) or (state='processing' and locked_until<now())) for update skip locked limit 1)
 returning *
$$;
revoke all on function public.mail_claim_reply(uuid) from public,anon,authenticated;
grant execute on function public.mail_claim_reply(uuid) to service_role;
