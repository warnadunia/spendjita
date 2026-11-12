# Spendjita School Attendance System

## Konfigurasi Deployment (Vercel + Supabase + Vercel Blob)

### 1. Supabase (Database)
Aplikasi ini sudah dilengkapi adapter cloud database ke Supabase.
Di Supabase Dashboard:
1. Buka **SQL Editor**, jalankan query ini untuk membuat tabel penampung data:
```sql
create table if not exists collections (
  name text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
```
2. Ambil **Project URL** dan **Anon Key** (atau Service Role Key) dari menu **Project Settings > API**.

---

### 2. Vercel Blob (Storage Media/Selfie)
1. Di dashboard project Vercel kamu, buka tab **Storage**.
2. Klik **Create Database / Storage** dan pilih **Blob**.
3. Hubungkan (Connect) Blob Store ke project Vercel kamu. Environment variable `BLOB_READ_WRITE_TOKEN` akan otomatis terpasang.

---

### 3. Environment Variables di Vercel
Tambahkan variabel berikut pada project settings Vercel (**Settings > Environment Variables**):
- `SUPABASE_URL` = `https://your-project-id.supabase.co`
- `SUPABASE_KEY` = `your-supabase-anon-or-service-role-key`
- `BLOB_READ_WRITE_TOKEN` = `(otomatis terisi saat menghubungkan Vercel Blob)`

