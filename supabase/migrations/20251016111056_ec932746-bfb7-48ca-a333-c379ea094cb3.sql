-- Create profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Create trigger for auto-profile creation
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Create sites table for cloud metadata
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  is_initialized boolean default false,
  created_at timestamptz default now(),
  last_modified timestamptz default now(),
  last_synced_at timestamptz,
  cloud_storage_path text,
  unique(user_id, id)
);

alter table public.sites enable row level security;

create policy "Users can view own sites"
  on public.sites for select
  using (auth.uid() = user_id);

create policy "Users can insert own sites"
  on public.sites for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sites"
  on public.sites for update
  using (auth.uid() = user_id);

create policy "Users can delete own sites"
  on public.sites for delete
  using (auth.uid() = user_id);

-- Create storage bucket
insert into storage.buckets (id, name, public)
values ('wordpress-sites', 'wordpress-sites', false);

-- Create storage policies
create policy "Users can upload own site files"
on storage.objects for insert
with check (
  bucket_id = 'wordpress-sites' 
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can view own site files"
on storage.objects for select
using (
  bucket_id = 'wordpress-sites'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can update own site files"
on storage.objects for update
using (
  bucket_id = 'wordpress-sites'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete own site files"
on storage.objects for delete
using (
  bucket_id = 'wordpress-sites'
  and auth.uid()::text = (storage.foldername(name))[1]
);