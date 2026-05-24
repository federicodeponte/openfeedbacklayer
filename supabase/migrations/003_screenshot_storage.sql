-- OpenFeedbackLayer: OPTIONAL screenshot storage
--
-- Run this ONLY if you want screenshot attachments. It requires Supabase
-- Storage (the `storage` schema). The core feedback table (001) and the
-- journey columns (002) do NOT depend on this; skip this file if you do not
-- use screenshots or are not on Supabase.

-- Create storage bucket for screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback',
  'feedback',
  true,
  5242880,  -- 5MB max
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Uploads are intentionally server-only. The bundled route handlers receive
-- multipart uploads, magic-byte sniff the file, enforce the 5MB cap, and then
-- upload with SUPABASE_SERVICE_ROLE_KEY. Do not grant anon/authenticated INSERT
-- here; direct browser uploads bypass the server-side validation path.

-- Storage policy: allow public reads
DROP POLICY IF EXISTS "Allow public reads from feedback bucket" ON storage.objects;
CREATE POLICY "Allow public reads from feedback bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback');
