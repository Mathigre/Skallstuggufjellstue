-- Integration assertions: rolled back, no accounting/customer data changed.
begin;
do $test$
declare u uuid; r uuid:=gen_random_uuid(); run jsonb; rev integer; n integer; caught boolean; day date:=(now() at time zone 'Europe/Oslo')::date;
begin
 select user_id into u from public.admin_users limit 1;
 if u is null then raise exception 'No admin available for test'; end if;
 if exists(select 1 from public.receipt_analysis_runs where quota_day=day) then raise exception 'Run this test in a clean test day/database'; end if;
 if has_table_privilege('anon','public.receipts','select') or has_table_privilege('authenticated','public.receipts','select') then raise exception 'Direct receipt access'; end if;
 if has_function_privilege('authenticated','public.receipt_reserve(uuid,uuid,integer,boolean)','execute') then raise exception 'Public quota RPC'; end if;
 if (select public from storage.buckets where id='kvitteringer') then raise exception 'Public bucket'; end if;
 insert into public.receipts(id,created_by,original_path,original_name,mime_type,file_size,file_hash,synthetic)
 values(r,u,r||'/original','synthetic-sql-test.png','image/png',10,encode(sha256(r::text::bytea),'hex'),true);
 run:=public.receipt_reserve(r,u,1,false);
 caught:=false;
 begin perform public.receipt_reserve(r,u,2,true);exception when others then if sqlerrm='BUSY' then caught:=true; else raise; end if;end;
 if not caught then raise exception 'Concurrent request not blocked'; end if;
 perform public.receipt_finish((run->>'run_id')::uuid,'{}',null,1000,200);
 select revision into rev from public.receipts where id=r;
 caught:=false;
 begin perform public.receipt_reserve(r,u,rev,false);exception when others then if sqlerrm='CONFIRM_REANALYSIS' then caught:=true;else raise;end if;end;
 if not caught then raise exception 'Unconfirmed repeat allowed';end if;
 caught:=false;
 begin perform public.receipt_edit(r,u,null,'save','{}');exception when others then if sqlerrm='CONFLICT' then caught:=true;else raise;end if;end;
 if not caught then raise exception 'Missing revision allowed';end if;
 for n in 2..10 loop
 select revision into rev from public.receipts where id=r;
 run:=public.receipt_reserve(r,u,rev,true);
 perform public.receipt_finish((run->>'run_id')::uuid,'{}',null,1000,200);
 end loop;
 select revision into rev from public.receipts where id=r;
 caught:=false;
 begin perform public.receipt_reserve(r,u,rev,true);exception when others then if sqlerrm='ADMIN_QUOTA' then caught:=true;else raise;end if;end;
 if not caught then raise exception 'Admin quota exceeded';end if;
 insert into public.receipt_analysis_runs(receipt_id,admin_id,model,input_rate,output_rate,status)
 select r,u,'gemini-2.5-flash-lite',0.1,0.4,'error' from generate_series(1,10);
 caught:=false;
 begin perform public.receipt_reserve(r,u,rev,true);exception when others then if sqlerrm='TOTAL_QUOTA' then caught:=true;else raise;end if;end;
 if not caught then raise exception 'Total quota exceeded';end if;
 perform public.receipt_edit(r,u,rev,'save','{"vendor":"Manual correction"}');
 if (select reviewed_data->>'vendor' from public.receipts where id=r)<>'Manual correction' then raise exception 'Manual save failed';end if;
 select revision into rev from public.receipts where id=r;
 perform public.receipt_edit(r,u,rev,'delete',null);
 if (select deleted_at from public.receipts where id=r) is null then raise exception 'Delete failed';end if;
 select revision into rev from public.receipts where id=r;
 perform public.receipt_edit(r,u,rev,'restore',null);
 if (select deleted_at from public.receipts where id=r) is not null then raise exception 'Restore failed';end if;
 if not exists(select 1 from public.receipt_analysis_runs where receipt_id=r and estimated_usd=0.00018) then raise exception 'Incorrect cost';end if;
end $test$;
rollback;
select 'Passed: private storage, grants, atomic reservation, explicit reanalysis, revision conflict, 10/20 caps, edits, trash/restore, cost. All changes rolled back.' as test_result;
