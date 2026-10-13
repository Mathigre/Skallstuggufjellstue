create table public.admin_push_settings (
 id boolean primary key default true check (id),
 public_key text not null,
 private_key text not null
);
alter table public.admin_push_settings enable row level security;
revoke all on public.admin_push_settings from public, anon, authenticated;
grant all on public.admin_push_settings to service_role;
create table public.admin_push_subscriptions (
 endpoint text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 p256dh text not null,
 auth text not null,
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '90 days')
);
create index admin_push_subscriptions_user_idx on public.admin_push_subscriptions(user_id);
alter table public.admin_push_subscriptions enable row level security;
revoke all on public.admin_push_subscriptions from public, anon, authenticated;
grant all on public.admin_push_subscriptions to service_role;
comment on table public.admin_push_settings is 'VAPID signing keys. Service-role only; never return private_key to clients.';
comment on table public.admin_push_subscriptions is 'Admin devices managed by authenticated admin-push function. No direct client access.';
