-- Chạy SQL này trong Supabase Dashboard -> SQL Editor nếu bạn muốn xem/quản lý
-- trực tiếp dữ liệu trong Table Editor (bảng public.router_state).
-- Lưu ý: Kể cả khi chưa chạy SQL này, 9Router vẫn tự động tạo Storage Bucket
-- `9router-state` và đồng bộ dữ liệu bằng SUPABASE_SECRET_KEY.

create table if not exists public.router_state (
  id text primary key default 'default',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.router_state enable row level security;
