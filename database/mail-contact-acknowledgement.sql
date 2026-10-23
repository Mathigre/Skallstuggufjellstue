-- New submissions only: queue acknowledgement atomically with owner notification.
-- No customer addresses are used for delivery while backend test mode is active.
alter table public.mail_jobs drop constraint mail_jobs_kind_check;
alter table public.mail_jobs add constraint mail_jobs_kind_check check(kind in ('owner_email','reply','push','acknowledgement'));
create function public.mail_queue_acknowledgement() returns trigger
language plpgsql set search_path='' as $$
begin
 insert into public.mail_jobs(message_id,kind) values(new.message_id,'acknowledgement') on conflict(message_id,kind) do nothing;
 return new;
end $$;
revoke all on function public.mail_queue_acknowledgement() from public,anon,authenticated;
create trigger mail_contact_acknowledgement after insert on public.mail_jobs
for each row when(new.kind='owner_email') execute function public.mail_queue_acknowledgement();
