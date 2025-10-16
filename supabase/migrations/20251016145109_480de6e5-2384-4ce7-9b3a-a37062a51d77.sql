-- Storage policies for wordpress-sites bucket to allow users access to their own folder
-- Enable RLS is already default for storage.objects, we just add policies

-- Allow users to read their own files
CREATE POLICY "Users can read their own wordpress site files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'wordpress-sites'
  AND auth.role() = 'authenticated'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to list their own folder (handled by SELECT policy with prefix matching)
-- Allow users to upload into their own folder (first folder = user_id)
CREATE POLICY "Users can upload their own wordpress site files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'wordpress-sites'
  AND auth.role() = 'authenticated'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to update files in their own folder
CREATE POLICY "Users can update their own wordpress site files"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'wordpress-sites'
  AND auth.role() = 'authenticated'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'wordpress-sites'
  AND auth.role() = 'authenticated'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to delete files in their own folder
CREATE POLICY "Users can delete their own wordpress site files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'wordpress-sites'
  AND auth.role() = 'authenticated'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
