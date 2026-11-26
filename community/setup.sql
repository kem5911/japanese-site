-- 한일 전철 伝言板(커뮤니티) 설정 — Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run.
-- 여러 번 실행해도 괜찮아요. 맨 아래 'ADMIN-KEY-HERE' 는 운영자 비밀번호로 바꿔서 실행하세요.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.kj_posts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  parent_id bigint references public.kj_posts(id) on delete cascade,
  cat text not null default 'free' check (cat in ('idea','bug','free','ask')),
  lang text not null default 'ko' check (lang in ('ko','ja')),
  nick text not null check (char_length(nick) between 1 and 16),
  body text not null check (char_length(body) between 1 and 500),
  is_admin boolean not null default false,
  likes int not null default 0,
  replies int not null default 0,
  reports int not null default 0,
  hidden boolean not null default false,
  device text not null,
  token_hash text not null
);
create index if not exists kj_posts_parent on public.kj_posts (parent_id, id desc);
create index if not exists kj_posts_device on public.kj_posts (device, created_at desc);

create table if not exists public.kj_votes (
  post_id bigint not null references public.kj_posts(id) on delete cascade,
  device text not null,
  kind text not null check (kind in ('like','report')),
  primary key (post_id, device, kind)
);
create table if not exists public.kj_admin (key text primary key);

alter table public.kj_posts enable row level security;
alter table public.kj_votes enable row level security;
alter table public.kj_admin enable row level security;

-- 앱(누구나)은 숨겨지지 않은 글의 공개 칸만 읽을 수 있음. 쓰기는 아래 함수로만.
revoke all on public.kj_posts, public.kj_votes, public.kj_admin from anon, authenticated;
grant select (id, created_at, parent_id, cat, lang, nick, body, is_admin, likes, replies) on public.kj_posts to anon, authenticated;
drop policy if exists kj_read on public.kj_posts;
create policy kj_read on public.kj_posts for select to anon, authenticated using (not hidden);

-- 글/댓글 쓰기
create or replace function public.kj_post(p_parent bigint, p_cat text, p_lang text, p_nick text, p_body text,
                                          p_device text, p_token text, p_admin text default null)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_admin boolean; v_body text := btrim(p_body); v_nick text := btrim(p_nick);
begin
  if p_device is null or char_length(p_device) not between 8 and 64 or p_token is null or char_length(p_token) < 16 then
    raise exception 'bad_request';
  end if;
  v_admin := p_admin is not null and exists (select 1 from kj_admin where key = p_admin);
  if not v_admin then
    if exists (select 1 from kj_posts where device = p_device and created_at > now() - interval '20 seconds') then raise exception 'slow'; end if;
    if (select count(*) from kj_posts where device = p_device and created_at > now() - interval '1 hour') >= 15 then raise exception 'slow'; end if;
    if (select count(*) from kj_posts where created_at > now() - interval '1 minute') >= 30 then raise exception 'busy'; end if;
    if v_body ~* '(https?://|www\.)' then raise exception 'link'; end if;
  end if;
  if p_parent is not null then
    if not exists (select 1 from kj_posts where id = p_parent and parent_id is null and not hidden) then raise exception 'no_parent'; end if;
    p_cat := 'free';
  end if;
  insert into kj_posts (parent_id, cat, lang, nick, body, is_admin, device, token_hash)
  values (p_parent, p_cat, p_lang, v_nick, v_body, v_admin, p_device, encode(digest(p_token, 'sha256'), 'hex'))
  returning id into v_id;
  if p_parent is not null then update kj_posts set replies = replies + 1 where id = p_parent; end if;
  return v_id;
end $$;

-- 공감(like) / 신고(report). 신고 3번이면 자동으로 숨김. 공감 수를 돌려줌.
create or replace function public.kj_vote(p_id bigint, p_device text, p_kind text)
returns int language plpgsql security definer set search_path = public as $$
declare v_likes int; v_new int;
begin
  if p_device is null or char_length(p_device) not between 8 and 64 then raise exception 'bad_request'; end if;
  insert into kj_votes (post_id, device, kind) select p_id, p_device, p_kind
    where exists (select 1 from kj_posts where id = p_id and not hidden)
    on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    if p_kind = 'like' then update kj_posts set likes = likes + 1 where id = p_id;
    else update kj_posts set reports = reports + 1, hidden = (reports + 1 >= 3) or hidden where id = p_id; end if;
  end if;
  select likes into v_likes from kj_posts where id = p_id;
  return coalesce(v_likes, 0);
end $$;

-- 내가 쓴 글 지우기 (글 쓸 때 이 기기에 저장한 비밀값으로)
create or replace function public.kj_delete(p_id bigint, p_token text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_parent bigint; v_n int;
begin
  delete from kj_posts where id = p_id and token_hash = encode(digest(p_token, 'sha256'), 'hex') returning parent_id into v_parent;
  get diagnostics v_n = row_count;
  if v_n > 0 and v_parent is not null then update kj_posts set replies = greatest(replies - 1, 0) where id = v_parent; end if;
  return v_n > 0;
end $$;

-- 운영자: 숨기기/되살리기, 숨긴 글 목록, 비밀번호 확인
create or replace function public.kj_admin_hide(p_key text, p_id bigint, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from kj_admin where key = p_key) then raise exception 'not_admin'; end if;
  update kj_posts set hidden = p_hidden, reports = case when p_hidden then reports else 0 end where id = p_id;
  if not p_hidden then delete from kj_votes where post_id = p_id and kind = 'report'; end if;
  return found;
end $$;

create or replace function public.kj_admin_hidden(p_key text)
returns table (id bigint, created_at timestamptz, parent_id bigint, cat text, lang text, nick text, body text, reports int)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from kj_admin where key = p_key) then raise exception 'not_admin'; end if;
  return query select p.id, p.created_at, p.parent_id, p.cat, p.lang, p.nick, p.body, p.reports
    from kj_posts p where p.hidden order by p.id desc limit 100;
end $$;

create or replace function public.kj_admin_check(p_key text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from kj_admin where key = p_key);
$$;

revoke all on function public.kj_post(bigint,text,text,text,text,text,text,text), public.kj_vote(bigint,text,text),
  public.kj_delete(bigint,text), public.kj_admin_hide(text,bigint,boolean), public.kj_admin_hidden(text),
  public.kj_admin_check(text) from public;
grant execute on function public.kj_post(bigint,text,text,text,text,text,text,text), public.kj_vote(bigint,text,text),
  public.kj_delete(bigint,text), public.kj_admin_hide(text,bigint,boolean), public.kj_admin_hidden(text),
  public.kj_admin_check(text) to anon, authenticated;

-- 운영자 비밀번호 (앱 주소 뒤에 ?admin=비밀번호 를 붙여 한 번 열면 그 폰이 운영자 모드가 돼요)
insert into public.kj_admin (key) values ('ADMIN-KEY-HERE') on conflict do nothing;
