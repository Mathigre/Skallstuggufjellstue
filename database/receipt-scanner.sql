-- Additive receipt scanner migration. Apply once through Supabase migrations.
begin;
create table public.receipt_settings (
 id boolean primary key default true check(id),
 enabled boolean not null default true,
 real_documents_enabled boolean not null default false,
 model text not null default 'gemini-2.5-flash-lite' check(model ~ '^gemini-[a-z0-9.-]*flash-lite[a-z0-9.-]*$'),
 input_usd_per_million numeric not null default 0.10 check(input_usd_per_million >= 0),
 output_usd_per_million numeric not null default 0.40 check(output_usd_per_million >= 0),
 admin_daily_limit integer not null default 10 check(admin_daily_limit between 1 and 10),
 total_daily_limit integer not null default 20 check(total_daily_limit between 1 and 20)
);
insert into public.receipt_settings(id) values(true);
create table public.receipts (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 original_path text not null unique,
 original_name text not null,
 analysis_path text,
 analysis_mime text,
 mime_type text not null,
 file_size integer not null check(file_size between 1 and 10485760),
 file_hash text not null unique check(length(file_hash)=64),
 synthetic boolean not null default false,
 revision integer not null default 1,
 ai_status text not null default 'new' check(ai_status in ('new','processing','ready','error')),
 ai_data jsonb,
 reviewed_data jsonb,
 review_status text not null default 'draft' check(review_status in ('draft','approved')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 deleted_at timestamptz,
 active_analysis_id uuid
);
create table public.receipt_analysis_runs (
 id uuid primary key default gen_random_uuid(),
 receipt_id uuid not null references public.receipts(id),
 admin_id uuid not null references auth.users(id),
 quota_day date not null default ((now() at time zone 'Europe/Oslo')::date),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 status text not null default 'reserved' check(status in ('reserved','success','error','unknown')),
 model text not null,
 input_rate numeric not null,
 output_rate numeric not null,
 input_tokens integer,
 output_tokens integer,
 estimated_usd numeric,
 error_code text
);
create index receipt_analysis_day on public.receipt_analysis_runs(quota_day,admin_id);
create index receipt_analysis_receipt on public.receipt_analysis_runs(receipt_id,started_at desc);
create index receipts_created on public.receipts(created_at desc);
alter table public.receipt_settings enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_analysis_runs enable row level security;
-- Only verified admin Edge Function accesses these tables. No browser write policy.
revoke all on public.receipt_settings,public.receipts,public.receipt_analysis_runs from anon,authenticated;
grant all on public.receipt_settings,public.receipts,public.receipt_analysis_runs to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('kvitteringer','kvitteringer',false,10485760,
 array['image/jpeg','image/png','image/heic','image/heif','application/pdf']);
-- Storage has RLS; deliberately no anon/authenticated bucket policies.
create function public.receipt_reserve(p_receipt uuid,p_admin uuid,p_revision integer,p_reanalyze boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.receipt_settings; r public.receipts; v_id uuid; day date := (now() at time zone 'Europe/Oslo')::date;
begin
 perform pg_advisory_xact_lock(781291004);
 if not exists(select 1 from public.admin_users where user_id=p_admin) then raise exception 'ADMIN_REQUIRED'; end if;
 select * into s from public.receipt_settings where id=true;
 if not s.enabled then raise exception 'DISABLED'; end if;
 select * into r from public.receipts where id=p_receipt for update;
 if not found or r.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
 if r.revision is distinct from p_revision then raise exception 'CONFLICT'; end if;
 if not s.real_documents_enabled and not r.synthetic then raise exception 'SYNTHETIC_ONLY'; end if;
 if exists(select 1 from public.receipt_analysis_runs where receipt_id=p_receipt and status='reserved' and started_at>now()-interval '5 minutes') then raise exception 'BUSY'; end if;
 if exists(select 1 from public.receipt_analysis_runs where receipt_id=p_receipt) and not p_reanalyze then raise exception 'CONFIRM_REANALYSIS'; end if;
 if (select count(*) from public.receipt_analysis_runs where quota_day=day)>=s.total_daily_limit then raise exception 'TOTAL_QUOTA'; end if;
 if (select count(*) from public.receipt_analysis_runs where quota_day=day and admin_id=p_admin)>=s.admin_daily_limit then raise exception 'ADMIN_QUOTA'; end if;
 update public.receipt_analysis_runs set status='unknown',finished_at=now(),error_code='STALE'
 where receipt_id=p_receipt and status='reserved';
 insert into public.receipt_analysis_runs(receipt_id,admin_id,model,input_rate,output_rate)
 values(p_receipt,p_admin,s.model,s.input_usd_per_million,s.output_usd_per_million) returning id into v_id;
 update public.receipts set active_analysis_id=v_id,ai_status='processing',updated_at=now(),revision=revision+1 where id=p_receipt;
 return jsonb_build_object('run_id',v_id,'model',s.model,'input_rate',s.input_usd_per_million,'output_rate',s.output_usd_per_million);
end $$;
create function public.receipt_finish(p_run uuid,p_data jsonb,p_error text,p_input integer,p_output integer)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.receipt_analysis_runs;
begin
 select * into v from public.receipt_analysis_runs where id=p_run for update;
 if not found or v.status<>'reserved' then return; end if;
 update public.receipt_analysis_runs set status=case when p_error is null then 'success' else 'error' end,
 finished_at=now(),error_code=p_error,input_tokens=p_input,output_tokens=p_output,
 estimated_usd=case when p_input is null or p_output is null then null else (p_input*v.input_rate+p_output*v.output_rate)/1000000 end where id=p_run;
 update public.receipts set ai_status=case when p_error is null then 'ready' else 'error' end,
 ai_data=case when p_error is null then p_data else ai_data end,updated_at=now(),revision=revision+1
 where id=v.receipt_id and active_analysis_id=p_run;
end $$;
-- Optimistic locking protects manual edits from other tabs. Review data is never replaced by AI.
create function public.receipt_edit(p_id uuid,p_admin uuid,p_revision integer,p_action text,p_data jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.receipts;
begin
 if not exists(select 1 from public.admin_users where user_id=p_admin) then raise exception 'ADMIN_REQUIRED'; end if;
 select * into r from public.receipts where id=p_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if r.revision is distinct from p_revision then raise exception 'CONFLICT'; end if;
 if p_action='recover' then
 if r.ai_status<>'processing' or exists(select 1 from public.receipt_analysis_runs where id=r.active_analysis_id and started_at>now()-interval '5 minutes') then raise exception 'BUSY'; end if;
 update public.receipt_analysis_runs set status='unknown',finished_at=now(),error_code='MANUAL_RECOVERY' where id=r.active_analysis_id and status='reserved';
 update public.receipts set ai_status='error',active_analysis_id=null where id=p_id;
 elsif r.ai_status='processing' then raise exception 'BUSY';
 elsif p_action in ('save','approve') and r.deleted_at is null then
 update public.receipts set reviewed_data=p_data,review_status=case when p_action='approve' then 'approved' else 'draft' end,
 reviewed_by=p_admin,reviewed_at=now() where id=p_id;
 elsif p_action='delete' then update public.receipts set deleted_at=now() where id=p_id;
 elsif p_action='restore' then update public.receipts set deleted_at=null where id=p_id;
 else raise exception 'INVALID_ACTION'; end if;
 update public.receipts set revision=revision+1,updated_at=now() where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.receipt_reserve(uuid,uuid,integer,boolean),public.receipt_finish(uuid,jsonb,text,integer,integer),public.receipt_edit(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.receipt_reserve(uuid,uuid,integer,boolean),public.receipt_finish(uuid,jsonb,text,integer,integer),public.receipt_edit(uuid,uuid,integer,text,jsonb) to service_role;
commit;

