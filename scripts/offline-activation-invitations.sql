-- Offline activation supervisor invitations (Postgres)
-- Run against the same DATABASE_URL used by auth/platform roles.

CREATE TABLE IF NOT EXISTS kristo_offline_activation_invitations (
  id TEXT PRIMARY KEY,
  invitee_user_id TEXT NOT NULL,
  invitee_kristo_id TEXT NOT NULL,
  church_id TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Supervisor',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT kristo_offline_activation_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  CONSTRAINT kristo_offline_activation_invitations_role_check
    CHECK (role IN ('Supervisor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS kristo_offline_activation_invitations_pending_unique_idx
ON kristo_offline_activation_invitations (invitee_user_id, church_id, role)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS kristo_offline_activation_invitations_invitee_status_idx
ON kristo_offline_activation_invitations (invitee_user_id, status);

CREATE INDEX IF NOT EXISTS kristo_offline_activation_invitations_status_role_idx
ON kristo_offline_activation_invitations (status, role);
