CREATE TABLE IF NOT EXISTS company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'Royal Development',
  address text,
  city text,
  province text,
  postal_code text,
  phone text,
  email text,
  website text,
  hst_number text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO company_settings (company_name, email)
VALUES ('Royal Development', 'info@royaldevelopment.ca')
ON CONFLICT DO NOTHING;
