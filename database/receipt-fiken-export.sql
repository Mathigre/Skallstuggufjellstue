-- Fiken export ledger: one attempt per reviewed receipt, preventing duplicate drafts.
create table if not exists public.receipt_fiken_exports (
 receipt_id uuid primary key references public.receipts(id),
 request_id uuid not null unique,
 receipt_revision integer not null,
 requested_by uuid not null references auth.users(id),
 state text not null check (state in ('processing','draft_created','ready','error','uncertain')),
 company_slug text not null check (company_slug='apiskallstuggu'),
 draft_id bigint,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.receipt_fiken_exports enable row level security;
revoke all on public.receipt_fiken_exports from public,anon,authenticated;
grant select,insert,update on public.receipt_fiken_exports to service_role;
create or replace function public.receipt_fiken_claim(p_receipt uuid,p_admin uuid,p_revision integer,p_request uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.receipts;
begin
 if not exists (select 1 from public.admin_users where user_id=p_admin) then raise exception 'ADMIN_REQUIRED'; end if;
 select * into r from public.receipts where id=p_receipt for update;
 if not found or r.deleted_at is not null or r.synthetic is not true or r.review_status <> 'approved' or r.reviewed_data is null then raise exception 'NOT_APPROVED_TEST'; end if;
 if r.revision is distinct from p_revision then raise exception 'CONFLICT'; end if;
 insert into public.receipt_fiken_exports(receipt_id,request_id,receipt_revision,requested_by,state,company_slug)
 values(p_receipt,p_request,p_revision,p_admin,'processing','apiskallstuggu');
 exception when unique_violation then raise exception 'ALREADY_EXPORTED_OR_UNCERTAIN';
end $$;
revoke all on function public.receipt_fiken_claim(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.receipt_fiken_claim(uuid,uuid,integer,uuid) to service_role;
