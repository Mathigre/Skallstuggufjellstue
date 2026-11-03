update public.mail_connection set mailbox='skallstuggupost@gmail.com',enabled=false,last_error=null,history_id=null,history_page=null,backfill_page=null,backfill_complete=false,last_sync_at=null,lock_until=null where id=true;
select cron.alter_job(jobid,schedule:='*/5 * * * *',active:=false) from cron.job where jobname='skallstuggu-mail-every-minute';

create or replace function public.mail_store_refresh(p_token text) returns void language plpgsql security definer set search_path='' as $function$
declare secret_id uuid; cron_job bigint;
begin
 select refresh_secret_id into secret_id from public.mail_connection where id=true for update;
 if secret_id is null then select vault.create_secret(p_token,'skallstuggu_gmail_refresh') into secret_id;
 else perform vault.update_secret(secret_id,p_token);end if;
 update public.mail_connection set mailbox='skallstuggupost@gmail.com',refresh_secret_id=secret_id,enabled=true,history_id=null,history_page=null,backfill_page=null,backfill_complete=false,last_sync_at=null,last_error=null,lock_until=null where id=true;
 select jobid into cron_job from cron.job where jobname='skallstuggu-mail-every-minute';
 if cron_job is not null then perform cron.alter_job(cron_job,schedule:='*/5 * * * *',active:=true);end if;
end $function$;