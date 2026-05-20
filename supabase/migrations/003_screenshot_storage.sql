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

-- Storage policy: allow public uploads
CREATE POLICY "Allow public uploads to feedback bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'feedback');

-- Storage policy: allow public reads
CREATE POLICY "Allow public reads from feedback bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'feedback');
