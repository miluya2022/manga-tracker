-- ============================================================
-- 追漫進度追蹤系統 - Supabase Schema & RPC Functions
-- 請將此檔案內容貼到 Supabase Dashboard -> SQL Editor 並執行
-- ============================================================

-- 1. 建立資料表
create table if not exists public.manga_progress (
  id uuid primary key default gen_random_uuid(),
  sync_key text not null,
  site text not null default 'manhuagui',
  comic_id text not null,
  title text not null,
  comic_url text not null,
  chapter_title text,
  chapter_url text not null,
  page_num integer not null default 1,
  total_pages integer,
  cover_url text,
  status text not null default 'reading'
    check (status in ('reading', 'completed', 'on_hold', 'dropped')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint manga_progress_unique_comic unique (sync_key, site, comic_id)
);

-- 索引：加速依 sync_key 與最近閱讀時間排序查詢
create index if not exists idx_manga_progress_sync_updated
  on public.manga_progress (sync_key, updated_at desc);

-- 2. 開啟 RLS（不開任何直接存取政策，強制全部透過下方 RPC 帶 sync_key 存取）
alter table public.manga_progress enable row level security;

-- 3. RPC：新增或更新閱讀進度（Userscript 呼叫）
create or replace function public.upsert_manga_progress(
  p_sync_key text,
  p_site text,
  p_comic_id text,
  p_title text,
  p_comic_url text,
  p_chapter_title text,
  p_chapter_url text,
  p_page_num integer default 1,
  p_total_pages integer default null,
  p_cover_url text default null
)
returns public.manga_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.manga_progress;
begin
  if length(coalesce(trim(p_sync_key), '')) < 8 then
    raise exception 'Invalid sync_key (must be at least 8 characters)';
  end if;

  insert into public.manga_progress (
    sync_key, site, comic_id, title, comic_url,
    chapter_title, chapter_url, page_num, total_pages, cover_url, updated_at
  )
  values (
    trim(p_sync_key),
    coalesce(nullif(trim(p_site), ''), 'manhuagui'),
    trim(p_comic_id),
    coalesce(nullif(trim(p_title), ''), '未命名漫畫'),
    trim(p_comic_url),
    nullif(trim(coalesce(p_chapter_title, '')), ''),
    trim(p_chapter_url),
    greatest(coalesce(p_page_num, 1), 1),
    p_total_pages,
    nullif(trim(coalesce(p_cover_url, '')), ''),
    now()
  )
  on conflict (sync_key, site, comic_id)
  do update set
    title = case
      when nullif(trim(excluded.title), '') is not null and excluded.title <> '未命名漫畫'
      then excluded.title
      else manga_progress.title
    end,
    comic_url = coalesce(nullif(excluded.comic_url, ''), manga_progress.comic_url),
    chapter_title = coalesce(excluded.chapter_title, manga_progress.chapter_title),
    chapter_url = excluded.chapter_url,
    page_num = excluded.page_num,
    total_pages = coalesce(excluded.total_pages, manga_progress.total_pages),
    cover_url = coalesce(excluded.cover_url, manga_progress.cover_url),
    status = case
      when manga_progress.status = 'completed' then 'reading'
      else manga_progress.status
    end,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

-- 4. RPC：列出所有漫畫進度（PWA 呼叫）
create or replace function public.list_manga_progress(p_sync_key text)
returns setof public.manga_progress
language sql
security definer
set search_path = public
as $$
  select *
  from public.manga_progress
  where sync_key = trim(p_sync_key)
    and length(coalesce(trim(p_sync_key), '')) >= 8
  order by updated_at desc;
$$;

-- 5. RPC：更新漫畫狀態（追漫中 / 已完結 / 擱置 / 棄坑）
create or replace function public.update_manga_status(
  p_sync_key text,
  p_id uuid,
  p_status text
)
returns public.manga_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.manga_progress;
begin
  update public.manga_progress
  set status = p_status,
      updated_at = now()
  where id = p_id
    and sync_key = trim(p_sync_key)
  returning * into v_result;

  return v_result;
end;
$$;

-- 6. RPC：刪除漫畫紀錄
create or replace function public.delete_manga_progress(
  p_sync_key text,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.manga_progress
  where id = p_id
    and sync_key = trim(p_sync_key);
  return found;
end;
$$;

-- 7. 授權給 anon / authenticated 角色呼叫 RPC
grant execute on function public.upsert_manga_progress(text, text, text, text, text, text, text, integer, integer, text) to anon, authenticated;
grant execute on function public.list_manga_progress(text) to anon, authenticated;
grant execute on function public.update_manga_status(text, uuid, text) to anon, authenticated;
grant execute on function public.delete_manga_progress(text, uuid) to anon, authenticated;
