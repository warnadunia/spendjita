# Spendjita School Attendance System

## Panduan Deployment (Vercel + Supabase)

Arsitektur aplikasi menggunakan **Vercel** untuk hosting web/API serverless, **Supabase Postgres** untuk database, dan **Supabase Storage** (dengan auto-compression sisi client) untuk penyimpanan foto selfie absensi dan avatar.

---

### 1. Supabase (Database)
1. Buka **SQL Editor** di Supabase Dashboard, jalankan query berikut untuk membuat tabel penyimpanan:
```sql
create table if not exists collections (
  name text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
```
2. Dapatkan **Project URL** dan **Anon Key** (atau Service Role Key) dari menu **Project Settings > API**.

---

### 2. Supabase Storage (Foto Selfie & Avatar)
Sistem absensi ini sudah dilengkapi kompresi gambar otomatis di browser (mengecilkan foto HP dari 3-5MB menjadi ~25-40KB) sebelum diunggah ke Supabase Storage.

**Cara membuat bucket storage di Supabase:**
1. Di Dashboard Supabase, buka menu **Storage** > **New bucket**.
2. Beri nama bucket: `attendance-photos`
3. Aktifkan opsi **Public bucket** (agar foto selfie dan avatar dapat ditampilkan di web/aplikasi).
4. *(Opsional lewat SQL Editor)*:
```sql
-- Buat bucket attendance-photos jika belum ada
insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', true)
on conflict (id) do nothing;

-- Izinkan akses publik untuk melihat foto
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'attendance-photos' );

-- Izinkan upload foto
create policy "Allow Uploads"
on storage.objects for insert
with check ( bucket_id = 'attendance-photos' );
```

---

### 3. Environment Variables di Vercel
Tambahkan variabel berikut pada project settings Vercel (**Settings > Environment Variables**):
- `SUPABASE_URL` = `https://your-project-id.supabase.co`
- `SUPABASE_KEY` = `your-supabase-anon-or-service-role-key`
- `SUPABASE_STORAGE_BUCKET` = `attendance-photos` *(opsional, default: attendance-photos)*
- `BLOB_READ_WRITE_TOKEN` = *(opsional jika ingin memakai Vercel Blob sebagai alternatif)*
