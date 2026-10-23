-- Shared inbox. Customer data never goes into source control or public assets.
create table public.mail_threads (
 id uuid primary key default gen_random_uuid(), source text not null check(source in ('contact','gmail')),
 gmail_thread_id text unique, contact_name text not null default '', contact_email text not null,
 contact_phone text not null default '', subject text not null, preview text not null default '',
 last_incoming_at timestamptz, last_outgoing_at timestamptz, answered_through_at timestamptz, read_at timestamptz,
 last_message_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.mail_messages (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.mail_threads(id),
 provider_key text unique not null, direction text not null check(direction in ('incoming','outgoing','notification')),
 sender_name text not null default '', sender_email text not null, body text not null,
 message_id text, reply_through_at timestamptz, attachments jsonb not null default '[]', source_labels jsonb not null default '[]',
 delivery_state text not null default 'received' check(delivery_state in ('received','queued','sending','sent','failed','uncertain')),
 received_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index mail_messages_thread_time on public.mail_messages(thread_id,received_at);
create index mail_threads_latest on public.mail_threads(last_message_at desc,id);
create table public.mail_jobs (
 id uuid primary key default gen_random_uuid(), message_id uuid not null references public.mail_messages(id),
 kind text not null check(kind in ('owner_email','reply','push')), state text not null default 'pending',
 attempts int not null default 0, next_at timestamptz not null default now(), locked_until timestamptz,
 provider_id text, error_code text, created_at timestamptz not null default now(), unique(message_id,kind)
);
create table public.mail_connection (
 id boolean primary key default true check(id), mailbox text not null default 'minsten.mg@gmail.com',
 refresh_secret_id uuid, history_id text, history_page text, backfill_page text, backfill_complete boolean not null default false,
 lock_until timestamptz, last_sync_at timestamptz, last_error text,
 cron_token_hash text not null, enabled boolean not null default false
);
create table public.mail_oauth_states (
 state_hash text primary key, verifier text not null, admin_id uuid not null references auth.users(id),
 expires_at timestamptz not null default now()+interval '10 minutes'
);
alter table public.mail_threads enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_jobs enable row level security;
alter table public.mail_connection enable row level security;
alter table public.mail_oauth_states enable row level security;
revoke all on public.mail_threads,public.mail_messages,public.mail_jobs,public.mail_connection,public.mail_oauth_states from anon,authenticated;
grant select on public.mail_threads,public.mail_messages to authenticated;
grant all on public.mail_threads,public.mail_messages,public.mail_jobs,public.mail_connection,public.mail_oauth_states to service_role;
create policy mail_threads_admin_read on public.mail_threads for select to authenticated using(exists(select 1 from public.admin_users where user_id=auth.uid()));
create policy mail_messages_admin_read on public.mail_messages for select to authenticated using(exists(select 1 from public.admin_users where user_id=auth.uid()));

-- Only service_role may execute these functions; the Edge Function checks admin
-- membership for every admin request. Public contact intake has a separate path.
create function public.mail_ingest(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare t uuid; m uuid; inserted boolean; incoming boolean := p->>'direction'='incoming'; outgoing boolean := p->>'direction'='outgoing'; stamp timestamptz := (p->>'received_at')::timestamptz;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p->>'provider_key',0));
 if exists(select 1 from public.mail_messages where provider_key=p->>'provider_key') then
  return jsonb_build_object('duplicate',true);
 end if;
 if p->>'thread_id' is not null then select id into t from public.mail_threads where id=(p->>'thread_id')::uuid; end if;
 if t is null and p->>'gmail_thread_id' is not null then select id into t from public.mail_threads where gmail_thread_id=p->>'gmail_thread_id'; end if;
 if t is null then
  t:=coalesce((p->>'new_thread_id')::uuid,gen_random_uuid());
  insert into public.mail_threads(id,source,gmail_thread_id,contact_name,contact_email,contact_phone,subject,last_message_at)
   values(t,p->>'source',p->>'gmail_thread_id',coalesce(p->>'sender_name',''),p->>'contact_email',coalesce(p->>'phone',''),p->>'subject',stamp)
   on conflict(gmail_thread_id) do update set gmail_thread_id=excluded.gmail_thread_id returning id into t;
 end if;
 insert into public.mail_messages(thread_id,provider_key,direction,sender_name,sender_email,body,message_id,attachments,source_labels,received_at,delivery_state,reply_through_at)
 values(t,p->>'provider_key',p->>'direction',coalesce(p->>'sender_name',''),p->>'sender_email',p->>'body',p->>'message_id',coalesce(p->'attachments','[]'),coalesce(p->'source_labels','[]'),stamp,coalesce(p->>'delivery_state','received'),(p->>'reply_through_at')::timestamptz)
 on conflict(provider_key) do nothing returning id into m;
 if m is null then return jsonb_build_object('duplicate',true); end if;
 update public.mail_threads set
  last_incoming_at=case when incoming then greatest(last_incoming_at,stamp) else last_incoming_at end,
  last_outgoing_at=case when outgoing and coalesce(p->>'delivery_state','received') in ('sent','received') then greatest(last_outgoing_at,stamp) else last_outgoing_at end,
  answered_through_at=case when outgoing and coalesce(p->>'delivery_state','received') in ('sent','received') then greatest(answered_through_at,stamp) else answered_through_at end,
  preview=case when stamp>=last_message_at then left(p->>'body',180) else preview end,
  last_message_at=greatest(last_message_at,stamp) where id=t;
 if coalesce((p->>'notify')::boolean,false) then insert into public.mail_jobs(message_id,kind) values(m,'push') on conflict do nothing; end if;
 if p->>'source'='contact' and incoming then insert into public.mail_jobs(message_id,kind) values(m,'owner_email') on conflict do nothing; end if;
 if outgoing and p->>'delivery_state'='queued' then insert into public.mail_jobs(message_id,kind) values(m,'reply') on conflict do nothing; end if;
 return jsonb_build_object('thread_id',t,'message_id',m,'duplicate',false);
end $$;

create function public.mail_list(p_filter text default 'unanswered',p_search text default '',p_offset int default 0) returns jsonb language sql stable set search_path='' as $$
 with all_threads as (
  select t.*, (last_incoming_at is not null and (answered_through_at is null or last_incoming_at>answered_through_at)) as unanswered,
   (last_incoming_at is not null and (read_at is null or last_incoming_at>read_at)) as unread
  from public.mail_threads t
 ), matches as (
  select * from all_threads where (p_search='' or position(lower(p_search) in lower(contact_name||' '||contact_email||' '||contact_phone||' '||subject||' '||preview))>0)
   and (p_filter='all' or (p_filter='new' and unread) or (p_filter='unanswered' and unanswered) or (p_filter='answered' and not unanswered and last_outgoing_at is not null))
 ) select jsonb_build_object(
  'counts',(select jsonb_build_object('all',count(*),'new',count(*) filter(where unread),'unanswered',count(*) filter(where unanswered),'answered',count(*) filter(where not unanswered and last_outgoing_at is not null)) from all_threads),
  'total',(select count(*) from matches),
  'threads',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select * from matches order by last_message_at desc,id limit 40 offset greatest(0,least(p_offset,100000))) s)
 )
$$;
create function public.mail_claim_jobs() returns setof public.mail_jobs language sql set search_path='' as $$
 update public.mail_jobs j set state='processing',locked_until=now()+interval '3 minutes',attempts=attempts+1
 where j.id in(select id from public.mail_jobs where (state='pending' and next_at<=now()) or (state='processing' and locked_until<now()) order by created_at for update skip locked limit 15)
 returning j.*
$$;
create function public.mail_claim_sync() returns setof public.mail_connection language sql set search_path='' as $$
 update public.mail_connection set lock_until=now()+interval '2 minutes'
 where id=true and enabled and (lock_until is null or lock_until<now()) returning *
$$;
create function public.mail_take_oauth(p_hash text) returns setof public.mail_oauth_states language sql set search_path='' as $$
 delete from public.mail_oauth_states where state_hash=p_hash and expires_at>now() returning *
$$;
create function public.mail_store_refresh(p_token text) returns void language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 select refresh_secret_id into secret_id from public.mail_connection where id=true for update;
 if secret_id is null then select vault.create_secret(p_token,'skallstuggu_gmail_refresh') into secret_id;
 else perform vault.update_secret(secret_id,p_token); end if;
 update public.mail_connection set refresh_secret_id=secret_id,enabled=true,history_id=null,history_page=null,backfill_page=null,backfill_complete=false,last_error=null where id=true;
end $$;
create function public.mail_read_refresh() returns text language sql security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where id=(select refresh_secret_id from public.mail_connection where id=true)
$$;
create function public.mail_check_cron(p_token text) returns boolean language sql set search_path='' as $$
 select coalesce((select cron_token_hash=encode(extensions.digest(p_token,'sha256'),'hex') from public.mail_connection where id=true),false)
$$;
create function public.mail_complete_job(p_id uuid,p_provider text default null) returns void language plpgsql set search_path='' as $$
declare j public.mail_jobs; m public.mail_messages; stamp timestamptz:=now();
begin
 select * into j from public.mail_jobs where id=p_id for update;
 if j.state='done' then return; end if;
 update public.mail_jobs set state='done',provider_id=coalesce(p_provider,provider_id),locked_until=null,error_code=null where id=p_id;
 if j.kind='reply' then
  select * into m from public.mail_messages where id=j.message_id;
  update public.mail_messages set delivery_state='sent',received_at=stamp where id=m.id;
  update public.mail_threads set last_outgoing_at=greatest(last_outgoing_at,stamp),answered_through_at=greatest(answered_through_at,m.reply_through_at),last_message_at=greatest(last_message_at,stamp) where id=m.thread_id;
 end if;
end $$;
revoke all on function public.mail_complete_job(uuid,text) from public,anon,authenticated;
grant execute on function public.mail_complete_job(uuid,text) to service_role;
-- Default privileges do not grant these privileged RPCs to public clients.
revoke all on function public.mail_ingest(jsonb),public.mail_list(text,text,int),public.mail_claim_jobs(),public.mail_claim_sync(),public.mail_take_oauth(text),public.mail_store_refresh(text),public.mail_read_refresh(),public.mail_check_cron(text) from public,anon,authenticated;
grant execute on function public.mail_ingest(jsonb),public.mail_list(text,text,int),public.mail_claim_jobs(),public.mail_claim_sync(),public.mail_take_oauth(text),public.mail_store_refresh(text),public.mail_read_refresh(),public.mail_check_cron(text) to service_role;

-- Vault-backed scheduling; no provider credentials in Git, HTML or cron SQL.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ declare token text:=gen_random_uuid()::text||gen_random_uuid()::text; begin
 perform vault.create_secret(token,'skallstuggu_mail_cron');
 insert into public.mail_connection(id,cron_token_hash) values(true,encode(extensions.digest(token,'sha256'),'hex'));
end $$;
select cron.schedule('skallstuggu-mail-every-minute','* * * * *', $job$
 select net.http_post(
  url:='https://rbphgvnwmzjeuvyrasvy.supabase.co/functions/v1/mail-center',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='skallstuggu_mail_cron')),
  body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=50000);
$job$);
