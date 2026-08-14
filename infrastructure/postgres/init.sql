CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS evidence_chunks (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  page_number INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_chunks_scope_idx
  ON evidence_chunks (tenant_id, listing_id, content_type);
CREATE INDEX IF NOT EXISTS evidence_chunks_embedding_idx
  ON evidence_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS roomproof_runs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  status TEXT NOT NULL,
  graph_version TEXT NOT NULL,
  model_manifest JSONB NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  university TEXT NOT NULL,
  role TEXT NOT NULL,
  university_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS listings_created_idx ON listings(created_at DESC);
