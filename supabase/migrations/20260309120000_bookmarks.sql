-- Bookmarks table: universal saves across notes, piazza posts, announcements
create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('note', 'piazza_post', 'announcement', 'assignment')),
  ref_id text not null,              -- id of the referenced item
  title text not null,
  url text,                          -- deep link or web url (optional)
  metadata jsonb default '{}'::jsonb, -- extra data: course_id, snippet, etc.
  created_at timestamptz default now() not null,
  unique (user_id, type, ref_id)     -- no duplicate bookmarks
);

-- Index for fast user lookups
create index if not exists bookmarks_user_id_idx on bookmarks(user_id);
create index if not exists bookmarks_user_type_idx on bookmarks(user_id, type);

-- RLS: users can only see/modify their own bookmarks
alter table bookmarks enable row level security;

create policy "bookmarks_select" on bookmarks
  for select using (auth.uid() = user_id);

create policy "bookmarks_insert" on bookmarks
  for insert with check (auth.uid() = user_id);

create policy "bookmarks_delete" on bookmarks
  for delete using (auth.uid() = user_id);
