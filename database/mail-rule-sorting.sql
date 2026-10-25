-- Lightweight rules run only when a new incoming message is saved.
alter table public.mail_threads add column category text not null default 'review' check(category in ('customer','newsletter','review'));
alter table public.mail_threads add column category_reason text not null default 'Ikke vurdert automatisk';
alter table public.mail_threads add column category_manual boolean not null default false;
create function public.mail_classify(p_source text,p_subject text,p_body text,p_labels jsonb default '[]') returns jsonb language plpgsql immutable set search_path='' as $$
declare content text:=lower(coalesce(p_subject,'')||' '||left(coalesce(p_body,''),12000));
begin
 if p_source='contact' then return jsonb_build_object('category','customer','reason','Sendt gjennom kontaktskjemaet'); end if;
 if p_labels ? 'CATEGORY_PROMOTIONS' or (content ~ '(unsubscribe|meld deg av|avmeld|nyhetsbrev)' and content ~ '(rabatt|kampanje|nyhetsbrev|newsletter|salg|tilbud)') then
  return jsonb_build_object('category','newsletter','reason','Gmail-kategori eller tydelige tegn på nyhetsbrev/reklame');
 end if;
 if content ~ '(leie|leige|overnatt|ledig|booking|bestill|bryllup|selskap|firma|skallstuggu|glamping)' and content ~ '(\?|ønsker|ynskjer|kan vi|kan jeg|har dere|har de |pris|koster|tilgjengelig|forespørsel)' then
  return jsonb_build_object('category','customer','reason','Spørsmål eller ønske om leie, opphold eller arrangement');
 end if;
 return jsonb_build_object('category','review','reason','Ingen sikker regel traff – vurder meldingen manuelt');
end $$;
revoke all on function public.mail_classify(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mail_classify(text,text,text,jsonb) to service_role;
create function public.mail_sort_incoming() returns trigger language plpgsql set search_path='' as $$
declare t public.mail_threads; result jsonb;
begin
 select * into t from public.mail_threads where id=new.thread_id for update;
 if t.category_manual then return new; end if;
 if t.category='customer' then return new; end if;
 result:=public.mail_classify(t.source,t.subject,new.body,new.source_labels);
 update public.mail_threads set category=result->>'category',category_reason=result->>'reason' where id=t.id;
 return new;
end $$;
revoke all on function public.mail_sort_incoming() from public,anon,authenticated;
create trigger mail_sort_new_incoming after insert on public.mail_messages for each row when(new.direction='incoming') execute function public.mail_sort_incoming();
-- Existing submissions are known customers; all other existing threads stay in review.
update public.mail_threads set category='customer',category_reason='Sendt gjennom kontaktskjemaet' where source='contact';
create function public.mail_list_categorized(p_filter text default 'unanswered',p_search text default '',p_offset int default 0,p_category text default 'all') returns jsonb language sql stable set search_path='' as $$
 with all_threads as (
  select t.*, (last_incoming_at is not null and (answered_through_at is null or last_incoming_at>answered_through_at)) as unanswered,
   (last_incoming_at is not null and (read_at is null or last_incoming_at>read_at)) as unread
  from public.mail_threads t where p_category='all' or t.category=p_category
 ), matches as (
  select * from all_threads where (p_search='' or position(lower(p_search) in lower(contact_name||' '||contact_email||' '||contact_phone||' '||subject||' '||preview))>0)
   and (p_filter='all' or (p_filter='new' and unread) or (p_filter='unanswered' and unanswered) or (p_filter='answered' and not unanswered and last_outgoing_at is not null))
 ) select jsonb_build_object(
  'counts',(select jsonb_build_object('all',count(*),'new',count(*) filter(where unread),'unanswered',count(*) filter(where unanswered),'answered',count(*) filter(where not unanswered and last_outgoing_at is not null)) from all_threads),
  'total',(select count(*) from matches),
  'threads',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select * from matches order by last_message_at desc,id limit 40 offset greatest(0,least(p_offset,100000))) s)
 )
$$;
revoke all on function public.mail_list_categorized(text,text,int,text) from public,anon,authenticated;
grant execute on function public.mail_list_categorized(text,text,int,text) to service_role;
