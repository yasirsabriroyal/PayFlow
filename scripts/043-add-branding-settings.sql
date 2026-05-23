-- Add logo column
ALTER TABLE company_settings ADD COLUMN logo_url text;

-- Create Storage Bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('brand-assets', 'brand-assets', true);

-- Public Read Access
CREATE POLICY "Public Read Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'brand-assets');

-- Admin Insert Access
CREATE POLICY "Admin Insert" 
ON storage.objects FOR INSERT 
WITH CHECK (
  bucket_id = 'brand-assets' AND 
  (auth.uid() IN (SELECT auth_user_id FROM users WHERE role = 'admin'))
);

-- Admin Update Access
CREATE POLICY "Admin Update" 
ON storage.objects FOR UPDATE 
USING (
  bucket_id = 'brand-assets' AND 
  (auth.uid() IN (SELECT auth_user_id FROM users WHERE role = 'admin'))
);

-- Admin Delete Access
CREATE POLICY "Admin Delete" 
ON storage.objects FOR DELETE 
USING (
  bucket_id = 'brand-assets' AND 
  (auth.uid() IN (SELECT auth_user_id FROM users WHERE role = 'admin'))
);
