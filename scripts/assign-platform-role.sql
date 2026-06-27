-- Platform roles (offline activation) — separate from church membership roles.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS kristo_platform_roles (
  user_id TEXT PRIMARY KEY,
  platform_role TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kristo_platform_roles_role_check
    CHECK (platform_role IN ('System_Admin', 'Supervisor', 'Agent'))
);

CREATE INDEX IF NOT EXISTS kristo_platform_roles_role_idx
  ON kristo_platform_roles (platform_role);

-- Bootstrap System Admin for local dev / production user
INSERT INTO kristo_platform_roles (user_id, platform_role, note, updated_at)
VALUES (
  'u_c4fc383d7119a19ee3e8d2b6',
  'System_Admin',
  'manual bootstrap platform admin',
  NOW()
)
ON CONFLICT (user_id) DO UPDATE SET
  platform_role = EXCLUDED.platform_role,
  note = EXCLUDED.note,
  updated_at = NOW();

-- Verify
SELECT user_id, platform_role, note, updated_at
FROM kristo_platform_roles
WHERE user_id = 'u_c4fc383d7119a19ee3e8d2b6';
