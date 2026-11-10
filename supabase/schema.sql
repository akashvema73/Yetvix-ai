-- Supabase Dashboard -> SQL Editor me ye poora paste karke Run karo.
-- (Purane Nexora wale database par bhi safe hai: sirf naye columns/policies add hote hain.)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  mode text not null default 'coding',
  pinned boolean not null default false,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  attachments jsonb,
  created_at timestamptz not null default now()
);
alter table public.conversations add column if not exists pinned boolean not null default false;
alter table public.conversations add column if not exists is_shared boolean not null default false;
alter table public.messages add column if not exists attachments jsonb;

create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);
create index if not exists messages_user_day_idx on public.messages(user_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Share feature: jo chat is_shared = true hai, uska link kholne wala koi bhi (read-only) padh sakta hai.
drop policy if exists "public shared conversations" on public.conversations;
create policy "public shared conversations" on public.conversations
  for select using (is_shared = true);
drop policy if exists "public shared messages" on public.messages;
create policy "public shared messages" on public.messages
  for select using (exists (select 1 from public.conversations c where c.id = conversation_id and c.is_shared = true));
