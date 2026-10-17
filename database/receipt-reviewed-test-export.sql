create or replace function public.receipt_fiken_claim(p_receipt uuid,p_admin uuid,p_revision integer,p_request uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.receipts;
begin
 if not exists(select 1 from public.admin_users where user_id=p_admin) then raise exception 'ADMIN_REQUIRED'; end if;
 select * into r from public.receipts where id=p_receipt for update;
 if not found or r.deleted_at is not null or r.review_status<>'approved' or r.reviewed_data is null then raise exception 'NOT_APPROVED_TEST'; end if;
 if r.revision is distinct from p_revision then raise exception 'CONFLICT'; end if;
 if coalesce(r.reviewed_data->>'organization_number','')<>'' and coalesce(r.reviewed_data->>'purchase_date','')<>'' and coalesce(r.reviewed_data->>'gross','')<>'' and exists(
 select 1 from public.receipts duplicate where duplicate.id<>p_receipt and duplicate.deleted_at is null
 and duplicate.reviewed_data->>'organization_number'=r.reviewed_data->>'organization_number'
 and duplicate.reviewed_data->>'purchase_date'=r.reviewed_data->>'purchase_date'
 and duplicate.reviewed_data->>'gross'=r.reviewed_data->>'gross') then raise exception 'POSSIBLE_DUPLICATE'; end if;
 update public.receipt_fiken_exports set request_id=p_request,receipt_revision=p_revision,requested_by=p_admin,state='processing',error_code=null,updated_at=now()
 where receipt_id=p_receipt and state='error' and draft_id is null and error_code in ('FIKEN_REJECTED','CHECKED_NO_DRAFT');
 if found then return; end if;
 insert into public.receipt_fiken_exports(receipt_id,request_id,receipt_revision,requested_by,state,company_slug)
 values(p_receipt,p_request,p_revision,p_admin,'processing','apiskallstuggu');
 exception when unique_violation then raise exception 'ALREADY_EXPORTED_OR_UNCERTAIN';
end $$;
revoke all on function public.receipt_fiken_claim(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.receipt_fiken_claim(uuid,uuid,integer,uuid) to service_role;
