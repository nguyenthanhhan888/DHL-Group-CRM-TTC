CREATE TABLE audit_logs (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  actor_id UUID REFERENCES auth.users(id),
  actor_name TEXT,
  actor_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  before JSONB,
  after JSONB,
  reason TEXT
);
