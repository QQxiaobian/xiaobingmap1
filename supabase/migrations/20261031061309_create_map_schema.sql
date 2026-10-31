/*
# Create map application schema (folders, markers, tracks, profiles)

1. Purpose
- Replace the old Express + SQLite backend with Supabase-backed storage.
- Each user's data (folders, markers, tracks) is isolated to their account via RLS.
- Admin users can manage all users' data and accounts.

2. New Tables
- `profiles`: extends auth.users with a display username and role (user/admin).
- `folders`: nested folder tree for organizing favorites (like 奥维地图).
- `markers`: point markers stored in WGS84 coordinates.
- `tracks`: line/polygon tracks stored in WGS84 coordinates as JSONB point arrays.

3. Functions
- `is_admin()`: SECURITY DEFINER function checking role = 'admin'.
- `handle_new_user()`: trigger that auto-creates a profiles row; first user becomes admin.

4. Security
- RLS on all tables; owner-scoped CRUD; admins get cross-user SELECT/DELETE/UPDATE.
- Grants to authenticated; service_role for admin edge function.

5. Notes
- user_id columns default to auth.uid(); coordinate storage is always WGS84.
*/

-- ===== profiles =====
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON profiles TO authenticated;
GRANT SELECT, UPDATE, DELETE ON profiles TO service_role;

-- ===== folders =====
CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_id uuid REFERENCES folders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO service_role;

-- ===== markers =====
CREATE TABLE IF NOT EXISTS markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  remark text DEFAULT '',
  lat float8 NOT NULL,
  lng float8 NOT NULL,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE markers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_markers_user ON markers(user_id);
CREATE INDEX IF NOT EXISTS idx_markers_folder ON markers(folder_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON markers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON markers TO service_role;

-- ===== tracks =====
CREATE TABLE IF NOT EXISTS tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  remark text DEFAULT '',
  points jsonb NOT NULL DEFAULT '[]',
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tracks_user ON tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON tracks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tracks TO service_role;

-- ===== is_admin() function =====
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE EXECUTE ON FUNCTION is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- ===== handle_new_user() trigger =====
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_first boolean;
BEGIN
  SELECT COUNT(*) = 0 INTO is_first FROM profiles;
  INSERT INTO profiles (id, username, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    CASE WHEN is_first THEN 'admin' ELSE 'user' END
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ===== profiles policies =====
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON profiles;
CREATE POLICY "profiles_select_own_or_admin"
ON profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR is_admin());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON profiles;
CREATE POLICY "profiles_update_own_or_admin"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id OR is_admin())
WITH CHECK (auth.uid() = id OR is_admin());

-- ===== folders policies =====
DROP POLICY IF EXISTS "folders_select_own_or_admin" ON folders;
CREATE POLICY "folders_select_own_or_admin"
ON folders FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "folders_insert_own" ON folders;
CREATE POLICY "folders_insert_own"
ON folders FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "folders_update_own" ON folders;
CREATE POLICY "folders_update_own"
ON folders FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "folders_delete_own_or_admin" ON folders;
CREATE POLICY "folders_delete_own_or_admin"
ON folders FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR is_admin());

-- ===== markers policies =====
DROP POLICY IF EXISTS "markers_select_own_or_admin" ON markers;
CREATE POLICY "markers_select_own_or_admin"
ON markers FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "markers_insert_own" ON markers;
CREATE POLICY "markers_insert_own"
ON markers FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "markers_update_own_or_admin" ON markers;
CREATE POLICY "markers_update_own_or_admin"
ON markers FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR is_admin())
WITH CHECK (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "markers_delete_own_or_admin" ON markers;
CREATE POLICY "markers_delete_own_or_admin"
ON markers FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR is_admin());

-- ===== tracks policies =====
DROP POLICY IF EXISTS "tracks_select_own_or_admin" ON tracks;
CREATE POLICY "tracks_select_own_or_admin"
ON tracks FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "tracks_insert_own" ON tracks;
CREATE POLICY "tracks_insert_own"
ON tracks FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "tracks_update_own_or_admin" ON tracks;
CREATE POLICY "tracks_update_own_or_admin"
ON tracks FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR is_admin())
WITH CHECK (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "tracks_delete_own_or_admin" ON tracks;
CREATE POLICY "tracks_delete_own_or_admin"
ON tracks FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR is_admin());