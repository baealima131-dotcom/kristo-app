/**
 * Postgres schema for the offline-activation program (Uvumbuzi Lab + Kristo).
 *
 * Every write that touches more than one record is ONE PL/pgSQL function call,
 * i.e. one transaction: row locks (FOR UPDATE) serialise competing requests,
 * constraints reject duplicates, and if the process dies half-way Postgres rolls
 * the whole change back. There is no time-limited application lock.
 *
 * Lock order (always the same, so no deadlocks):
 *   invite code row -> supervisor member row -> member advisory lock ->
 *   member platform-role row -> member row -> agent rows -> other rows.
 *
 * Agent registrations live in kristo_oact_agents (imported once from the old
 * `offline_activation_agents.json` document, which is kept unchanged as a
 * backup). Per-member changes are serialised with a transaction-scoped
 * advisory lock (oact_lock_user), per-supervisor changes with the supervisor's
 * member row (oact_lock_supervisor). Both are released on commit, rollback or
 * when the connection dies, so a crashed process can never leave a lock behind.
 *
 * Errors are raised as 'OACT|<http status>|<message>'.
 */

export const PROGRAM_SCHEMA_LOCK_KEY = "kristo_oact_program_schema_v1";
export const PROGRAM_JSON_MIGRATION = "json_documents_to_tables_v1";
export const PROGRAM_AGENTS_MIGRATION = "agents_document_to_table_v1";

export const PROGRAM_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS kristo_oact_members (
    user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('Supervisor', 'Agent')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    agent_limit INT CHECK (agent_limit IS NULL OR agent_limit BETWEEN 0 AND 500),
    supervisor_user_id TEXT,
    status_reason TEXT,
    status_changed_at TIMESTAMPTZ,
    status_changed_by TEXT,
    limit_updated_at TIMESTAMPTZ,
    limit_updated_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role <> 'Agent' OR supervisor_user_id IS NOT NULL)
  )`,
  // Agent registrations (formerly only in the offline_activation_agents.json document).
  `CREATE TABLE IF NOT EXISTS kristo_oact_agents (
    id TEXT PRIMARY KEY,
    supervisor_user_id TEXT NOT NULL CHECK (supervisor_user_id <> ''),
    kristo_id TEXT NOT NULL DEFAULT '',
    church_id TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'inactive', 'removed')),
    avatar_url TEXT,
    linked_user_id TEXT,
    migrated_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (linked_user_id IS NULL OR linked_user_id <> supervisor_user_id)
  )`,
  // One live registration per (supervisor, member, church); removed rows are kept as history.
  `CREATE UNIQUE INDEX IF NOT EXISTS kristo_oact_agents_registration_uidx
    ON kristo_oact_agents (supervisor_user_id, linked_user_id, church_id)
    WHERE status <> 'removed' AND linked_user_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_agents_supervisor_idx ON kristo_oact_agents (supervisor_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_agents_linked_idx ON kristo_oact_agents (linked_user_id, status)`,
  // Drop helpers of the JSON-document era (replaced below).
  `DROP FUNCTION IF EXISTS oact_used_slots(JSONB, TEXT, TEXT)`,
  `DROP FUNCTION IF EXISTS oact_lock_agents_doc()`,
  `DROP FUNCTION IF EXISTS oact_write_agents_doc(JSONB)`,
  `DROP FUNCTION IF EXISTS oact_set_member_status(TEXT, TEXT, TEXT, TEXT)`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_invite_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_preview TEXT NOT NULL,
    supervisor_user_id TEXT NOT NULL,
    max_uses INT NOT NULL CHECK (max_uses BETWEEN 1 AND 50),
    used_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT,
    CHECK (used_count >= 0 AND used_count <= max_uses)
  )`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_invite_codes_supervisor_idx ON kristo_oact_invite_codes (supervisor_user_id)`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_invite_code_uses (
    code_id TEXT NOT NULL REFERENCES kristo_oact_invite_codes(id),
    user_id TEXT NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_onboardings (
    id TEXT PRIMARY KEY,
    agent_user_id TEXT NOT NULL,
    supervisor_user_id TEXT NOT NULL,
    leader_user_id TEXT NOT NULL,
    leader_kristo_id TEXT NOT NULL,
    church_id TEXT,
    registered_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('invited', 'registered', 'training_pending',
      'awaiting_confirmation', 'confirmed', 'needs_help', 'rejected')),
    agent_report JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (agent_user_id <> leader_user_id),
    CHECK ((church_id IS NULL) = (registered_at IS NULL))
  )`,
  // A church is counted once; a leader without a church yet has one open record.
  `CREATE UNIQUE INDEX IF NOT EXISTS kristo_oact_onboardings_church_uidx
    ON kristo_oact_onboardings (church_id) WHERE church_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS kristo_oact_onboardings_open_leader_uidx
    ON kristo_oact_onboardings (leader_user_id) WHERE church_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_onboardings_agent_idx ON kristo_oact_onboardings (agent_user_id)`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_onboardings_supervisor_idx ON kristo_oact_onboardings (supervisor_user_id)`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_confirmations (
    request_id TEXT PRIMARY KEY,
    onboarding_id TEXT NOT NULL REFERENCES kristo_oact_onboardings(id),
    leader_user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'needs_help')),
    question TEXT NOT NULL,
    report_version INT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    responded_by TEXT,
    note TEXT,
    CHECK ((status = 'pending') = (responded_at IS NULL)),
    CHECK (status = 'pending' OR responded_by = leader_user_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS kristo_oact_confirmations_one_pending_uidx
    ON kristo_oact_confirmations (onboarding_id) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_confirmations_leader_idx ON kristo_oact_confirmations (leader_user_id, status)`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_audit (
    id TEXT PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS kristo_oact_audit_at_idx ON kristo_oact_audit (at)`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_admin_login_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS kristo_oact_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  /* ---------- helpers ---------- */
  `CREATE OR REPLACE FUNCTION oact_fail(p_status INT, p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'OACT|%|%', p_status, p_message;
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_audit(p_actor TEXT, p_role TEXT, p_action TEXT, p_type TEXT, p_target TEXT, p_details JSONB)
  RETURNS VOID LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO kristo_oact_audit (id, at, actor_user_id, actor_role, action, target_type, target_id, details)
    VALUES ('oaudit_' || replace(gen_random_uuid()::text, '-', ''), clock_timestamp(), coalesce(p_actor, 'system'),
      coalesce(p_role, 'unknown'), p_action, p_type, coalesce(p_target, ''), p_details);
  END $$`,

  // Locks (and creates if missing) the legacy agents document row.
  `CREATE OR REPLACE FUNCTION oact_try_ts(p_value TEXT) RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
  BEGIN
    RETURN p_value::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END $$`,

  // Per-member lock: serialises every change to one member's agent status across supervisors.
  `CREATE OR REPLACE FUNCTION oact_lock_user(p_user TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('kristo_oact_user:' || p_user));
  END $$`,

  // Agents holding a slot with a supervisor: pending or accepted, not revoked.
  // Agents holding a slot with a supervisor: pending or accepted, not revoked.
  `CREATE OR REPLACE FUNCTION oact_used_slots(p_sup TEXT, p_exclude_user TEXT DEFAULT NULL)
  RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT count(DISTINCT coalesce(nullif(a.linked_user_id, ''), nullif(a.kristo_id, ''), a.id))::int
    FROM kristo_oact_agents a
    WHERE a.supervisor_user_id = p_sup
      AND a.status IN ('pending', 'accepted')
      AND (p_exclude_user IS NULL OR coalesce(a.linked_user_id, '') <> p_exclude_user)
      AND NOT EXISTS (
        SELECT 1 FROM kristo_oact_members m
        WHERE m.user_id = coalesce(nullif(a.linked_user_id, ''), a.id) AND m.status = 'revoked')
  $$`,
  `CREATE OR REPLACE FUNCTION oact_current_supervisor(p_user TEXT, p_except_sup TEXT DEFAULT NULL)
  RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT supervisor_user_id FROM kristo_oact_agents
    WHERE linked_user_id = p_user AND status = 'accepted'
      AND (p_except_sup IS NULL OR supervisor_user_id <> p_except_sup)
    ORDER BY updated_at DESC LIMIT 1
  $$`,

  `CREATE OR REPLACE FUNCTION oact_open_code_slots(p_sup TEXT) RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT coalesce(sum(greatest(max_uses - used_count, 0)), 0)::int FROM kristo_oact_invite_codes
    WHERE supervisor_user_id = p_sup AND revoked_at IS NULL AND expires_at > NOW()
  $$`,

  // Locks the supervisor's member row (creating an 'active' row for legacy supervisors).
  `CREATE OR REPLACE FUNCTION oact_lock_supervisor(p_sup TEXT) RETURNS kristo_oact_members LANGUAGE plpgsql AS $$
  DECLARE v_m kristo_oact_members;
  BEGIN
    INSERT INTO kristo_oact_members (user_id, role, status) VALUES (p_sup, 'Supervisor', 'active')
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_m FROM kristo_oact_members WHERE user_id = p_sup FOR UPDATE;
    RETURN v_m;
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_effective_limit(p_m kristo_oact_members, p_used INT, p_default INT)
  RETURNS INT LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(p_m.agent_limit, greatest(p_default, p_used))
  $$`,

  /* ---------- supervisor: invite codes ---------- */
  `CREATE OR REPLACE FUNCTION oact_create_invite_code(p_sup TEXT, p_id TEXT, p_hash TEXT, p_preview TEXT,
    p_max_uses INT, p_expires_at TIMESTAMPTZ, p_default_limit INT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_m kristo_oact_members; v_used INT; v_reserved INT; v_limit INT;
  BEGIN
    IF (SELECT platform_role FROM kristo_platform_roles WHERE user_id = p_sup) IS DISTINCT FROM 'Supervisor' THEN
      PERFORM oact_fail(403, 'Forbidden (platform role)');
    END IF;
    v_m := oact_lock_supervisor(p_sup);
    IF v_m.status <> 'active' THEN PERFORM oact_fail(403, 'Access ' || v_m.status); END IF;
    v_used := oact_used_slots(p_sup);
    v_reserved := oact_open_code_slots(p_sup);
    v_limit := oact_effective_limit(v_m, v_used, p_default_limit);
    IF v_used + v_reserved + p_max_uses > v_limit THEN
      PERFORM oact_fail(409, format('Agent limit reached (%s agents + %s open invite slots of %s)', v_used, v_reserved, v_limit));
    END IF;
    INSERT INTO kristo_oact_invite_codes (id, code_hash, code_preview, supervisor_user_id, max_uses, expires_at, created_by)
    VALUES (p_id, p_hash, p_preview, p_sup, p_max_uses, p_expires_at, p_sup);
    PERFORM oact_audit(p_sup, 'Supervisor', 'invite_code.created', 'invite_code', p_id,
      jsonb_build_object('maxUses', p_max_uses, 'expiresAt', p_expires_at, 'preview', p_preview));
    RETURN jsonb_build_object('limit', v_limit, 'used', v_used, 'reserved', v_reserved);
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_revoke_invite_code(p_actor TEXT, p_actor_role TEXT, p_code_id TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_c kristo_oact_invite_codes;
  BEGIN
    SELECT * INTO v_c FROM kristo_oact_invite_codes WHERE id = p_code_id FOR UPDATE;
    IF NOT FOUND OR (p_actor_role = 'Supervisor' AND v_c.supervisor_user_id <> p_actor) THEN
      PERFORM oact_fail(404, 'Invite code not found');
    END IF;
    IF v_c.revoked_at IS NULL THEN
      UPDATE kristo_oact_invite_codes SET revoked_at = NOW(), revoked_by = p_actor WHERE id = p_code_id;
    END IF;
    PERFORM oact_audit(p_actor, p_actor_role, 'invite_code.revoked', 'invite_code', p_code_id, NULL);
    RETURN jsonb_build_object('id', p_code_id);
  END $$`,

  /* ---------- agent: redeem an invite code ---------- */
  `CREATE OR REPLACE FUNCTION oact_redeem_invite_code(p_user TEXT, p_hash TEXT, p_church TEXT, p_agent JSONB,
    p_default_limit INT, p_now TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_c kristo_oact_invite_codes; v_sup TEXT; v_m kristo_oact_members; v_um kristo_oact_members;
    v_sup_role TEXT; v_user_role TEXT; v_current_sup TEXT; v_used INT; v_limit INT; v_reg TEXT;
  BEGIN
    SELECT * INTO v_c FROM kristo_oact_invite_codes WHERE code_hash = p_hash FOR UPDATE;
    IF NOT FOUND THEN PERFORM oact_fail(404, 'Invite code not found'); END IF;
    IF v_c.revoked_at IS NOT NULL THEN PERFORM oact_fail(410, 'Invite code was revoked'); END IF;
    IF v_c.expires_at <= NOW() THEN PERFORM oact_fail(410, 'Invite code has expired'); END IF;
    IF v_c.used_count >= v_c.max_uses THEN PERFORM oact_fail(410, 'Invite code has been used'); END IF;
    IF v_c.supervisor_user_id = p_user THEN PERFORM oact_fail(400, 'You cannot redeem your own invite code'); END IF;
    v_sup := v_c.supervisor_user_id;

    SELECT platform_role INTO v_sup_role FROM kristo_platform_roles WHERE user_id = v_sup;
    v_m := oact_lock_supervisor(v_sup);
    IF v_sup_role IS DISTINCT FROM 'Supervisor' OR v_m.status <> 'active' THEN
      PERFORM oact_fail(410, 'Invite code is no longer valid');
    END IF;

    PERFORM oact_lock_user(p_user);
    SELECT platform_role INTO v_user_role FROM kristo_platform_roles WHERE user_id = p_user FOR UPDATE;
    IF v_user_role IN ('System_Admin', 'Supervisor') THEN
      PERFORM oact_fail(409, 'You already have the ' || v_user_role || ' role');
    END IF;
    SELECT * INTO v_um FROM kristo_oact_members WHERE user_id = p_user FOR UPDATE;
    IF FOUND AND v_um.status <> 'active' THEN PERFORM oact_fail(403, 'Access ' || v_um.status); END IF;
    IF EXISTS (SELECT 1 FROM kristo_oact_invite_code_uses WHERE code_id = v_c.id AND user_id = p_user) THEN
      PERFORM oact_fail(409, 'Invite code already redeemed by you');
    END IF;

    v_current_sup := oact_current_supervisor(p_user);
    IF v_current_sup IS NOT NULL AND v_current_sup <> v_sup THEN
      PERFORM oact_fail(409, 'You already work with another supervisor');
    END IF;
    IF v_current_sup = v_sup THEN PERFORM oact_fail(409, 'You are already an agent of this supervisor'); END IF;

    v_used := oact_used_slots(v_sup, p_user);
    v_limit := oact_effective_limit(v_m, v_used, p_default_limit);
    IF v_used + 1 > v_limit THEN
      PERFORM oact_fail(409, format('Agent limit reached (%s/%s)', v_used, v_limit));
    END IF;

    INSERT INTO kristo_oact_invite_code_uses (code_id, user_id) VALUES (v_c.id, p_user);
    UPDATE kristo_oact_invite_codes SET used_count = used_count + 1 WHERE id = v_c.id;

    SELECT id INTO v_reg FROM kristo_oact_agents
    WHERE supervisor_user_id = v_sup AND linked_user_id = p_user AND church_id = p_church AND status <> 'removed'
    FOR UPDATE;
    IF v_reg IS NOT NULL THEN
      UPDATE kristo_oact_agents SET status = 'accepted', updated_at = NOW() WHERE id = v_reg;
    ELSE
      v_reg := p_agent->>'id';
      INSERT INTO kristo_oact_agents (id, supervisor_user_id, kristo_id, church_id, full_name, phone, status, linked_user_id)
      VALUES (v_reg, v_sup, upper(coalesce(p_agent->>'kristoId', '')), p_church, coalesce(p_agent->>'fullName', ''),
        coalesce(p_agent->>'phone', ''), 'accepted', p_user);
    END IF;

    INSERT INTO kristo_oact_members (user_id, role, status, supervisor_user_id)
    VALUES (p_user, 'Agent', 'active', v_sup)
    ON CONFLICT (user_id) DO UPDATE SET role = 'Agent', status = 'active', supervisor_user_id = v_sup, updated_at = NOW();
    INSERT INTO kristo_platform_roles (user_id, platform_role, note, created_at, updated_at)
    VALUES (p_user, 'Agent', 'Agent of ' || v_sup || ' • invite code ' || v_c.id, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET platform_role = 'Agent', note = EXCLUDED.note, updated_at = NOW();

    PERFORM oact_audit(p_user, 'Member', 'agent.code_redeemed', 'invite_code', v_c.id,
      jsonb_build_object('supervisorUserId', v_sup, 'agentRegistrationId', v_reg));
    PERFORM oact_audit(p_user, 'Member', 'role.granted', 'user', p_user,
      jsonb_build_object('role', 'Agent', 'supervisorUserId', v_sup, 'via', 'invite_code'));
    RETURN jsonb_build_object('supervisorUserId', v_sup, 'agentRegistrationId', v_reg);
  END $$`,

  /* ---------- legacy: supervisor invites an agent by KRISTO ID ---------- */
  `CREATE OR REPLACE FUNCTION oact_invite_agent(p_sup TEXT, p_invitee TEXT, p_invitee_kristo TEXT, p_church TEXT,
    p_invitation_id TEXT, p_agent JSONB, p_default_limit INT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_m kristo_oact_members; v_used INT; v_reserved INT; v_limit INT; v_existing TEXT;
  BEGIN
    v_m := oact_lock_supervisor(p_sup);
    IF v_m.status <> 'active' THEN PERFORM oact_fail(403, 'Access ' || v_m.status); END IF;
    IF p_invitee = p_sup THEN PERFORM oact_fail(400, 'You cannot invite yourself'); END IF;
    PERFORM oact_lock_user(p_invitee);
    SELECT id INTO v_existing FROM kristo_oact_agents
    WHERE supervisor_user_id = p_sup AND linked_user_id = p_invitee AND church_id = p_church AND status <> 'removed';
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'exists'); END IF;
    SELECT id INTO v_existing FROM kristo_offline_activation_invitations
    WHERE invitee_user_id = p_invitee AND church_id = p_church AND role = 'Agent' AND status = 'pending';
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'alreadyPending', 'invitationId', v_existing);
    END IF;
    v_used := oact_used_slots(p_sup);
    v_reserved := oact_open_code_slots(p_sup);
    v_limit := oact_effective_limit(v_m, v_used, p_default_limit);
    IF v_used + v_reserved + 1 > v_limit THEN
      PERFORM oact_fail(409, format('Agent limit reached (%s agents + %s open invite slots of %s)', v_used, v_reserved, v_limit));
    END IF;
    INSERT INTO kristo_offline_activation_invitations (id, invitee_user_id, invitee_kristo_id, church_id,
      invited_by_user_id, role, status, created_at, responded_at)
    VALUES (p_invitation_id, p_invitee, p_invitee_kristo, p_church, p_sup, 'Agent', 'pending', NOW(), NULL);
    INSERT INTO kristo_oact_agents (id, supervisor_user_id, kristo_id, church_id, full_name, phone, status, avatar_url, linked_user_id)
    VALUES (p_agent->>'id', p_sup, upper(coalesce(p_agent->>'kristoId', '')), p_church, coalesce(p_agent->>'fullName', ''),
      coalesce(p_agent->>'phone', ''), 'pending', nullif(p_agent->>'avatarUrl', ''), p_invitee);
    PERFORM oact_audit(p_sup, 'Supervisor', 'agent.invited', 'invitation', p_invitation_id,
      jsonb_build_object('inviteeUserId', p_invitee, 'churchId', p_church));
    RETURN jsonb_build_object('outcome', 'invited', 'invitationId', p_invitation_id);
  END $$`,

  /* ---------- legacy invitations: accept / decline (Supervisor or Agent) ---------- */
  `CREATE OR REPLACE FUNCTION oact_respond_invitation(p_invitation_id TEXT, p_user TEXT, p_action TEXT, p_now TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_inv kristo_offline_activation_invitations; v_new_status TEXT; v_role TEXT; v_existing_role TEXT;
    v_member kristo_oact_members;
  BEGIN
    IF p_action NOT IN ('accept', 'decline') THEN PERFORM oact_fail(400, 'action must be accept or decline'); END IF;
    -- Lock order: supervisor first (read the invitation unlocked to find them), then the invitation.
    SELECT * INTO v_inv FROM kristo_offline_activation_invitations WHERE id = p_invitation_id;
    IF NOT FOUND THEN PERFORM oact_fail(404, 'Invitation not found'); END IF;
    IF v_inv.role = 'Agent' THEN
      PERFORM oact_lock_supervisor(v_inv.invited_by_user_id);
    END IF;
    PERFORM oact_lock_user(p_user);
    SELECT * INTO v_inv FROM kristo_offline_activation_invitations WHERE id = p_invitation_id FOR UPDATE;
    IF v_inv.invitee_user_id <> p_user THEN PERFORM oact_fail(403, 'Not authorized to respond to this invitation'); END IF;
    IF v_inv.status <> 'pending' THEN PERFORM oact_fail(409, 'Invitation is already ' || v_inv.status); END IF;
    v_new_status := CASE WHEN p_action = 'accept' THEN 'accepted' ELSE 'declined' END;
    v_role := CASE WHEN v_inv.role = 'Agent' THEN 'Agent' ELSE 'Supervisor' END;
    SELECT platform_role INTO v_existing_role FROM kristo_platform_roles WHERE user_id = p_user FOR UPDATE;
    SELECT * INTO v_member FROM kristo_oact_members WHERE user_id = p_user FOR UPDATE;

    IF p_action = 'accept' THEN
      IF v_member.status IN ('suspended', 'revoked') THEN PERFORM oact_fail(403, 'Access ' || v_member.status); END IF;
      IF v_role = 'Agent' THEN
        IF v_existing_role IN ('System_Admin', 'Supervisor') THEN
          PERFORM oact_fail(409, 'User already has the ' || v_existing_role || ' role');
        END IF;
        IF oact_current_supervisor(p_user, v_inv.invited_by_user_id) IS NOT NULL THEN
          PERFORM oact_fail(409, 'You already work with another supervisor');
        END IF;
      ELSIF v_existing_role IN ('System_Admin', 'Agent') THEN
        PERFORM oact_fail(409, 'User already has the ' || v_existing_role || ' role');
      END IF;
    END IF;

    IF v_role = 'Agent' THEN
      UPDATE kristo_oact_agents SET status = v_new_status, updated_at = NOW()
      WHERE supervisor_user_id = v_inv.invited_by_user_id AND linked_user_id = p_user
        AND church_id = v_inv.church_id AND status = 'pending';
    END IF;

    UPDATE kristo_offline_activation_invitations SET status = v_new_status, responded_at = NOW()
    WHERE id = p_invitation_id;

    IF p_action = 'accept' THEN
      INSERT INTO kristo_platform_roles (user_id, platform_role, note, created_at, updated_at)
      VALUES (p_user, v_role, v_role || ' for ' || v_inv.church_id || ' • KRISTO ' || v_inv.invitee_kristo_id
        || ' • accepted invitation ' || v_inv.id, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET platform_role = EXCLUDED.platform_role, note = EXCLUDED.note, updated_at = NOW();
      IF v_role = 'Agent' THEN
        INSERT INTO kristo_oact_members (user_id, role, status, supervisor_user_id)
        VALUES (p_user, 'Agent', 'active', v_inv.invited_by_user_id)
        ON CONFLICT (user_id) DO UPDATE SET role = 'Agent', status = 'active',
          supervisor_user_id = EXCLUDED.supervisor_user_id, updated_at = NOW();
      ELSE
        INSERT INTO kristo_oact_members (user_id, role, status) VALUES (p_user, 'Supervisor', 'active')
        ON CONFLICT (user_id) DO UPDATE SET role = 'Supervisor', status = 'active', supervisor_user_id = NULL, updated_at = NOW();
      END IF;
    END IF;

    PERFORM oact_audit(p_user, 'Member',
      CASE WHEN v_role = 'Agent' THEN 'agent.invitation_responded' ELSE 'supervisor.invitation_responded' END,
      'invitation', p_invitation_id,
      jsonb_build_object('response', v_new_status, 'invitedByUserId', v_inv.invited_by_user_id));
    IF p_action = 'accept' THEN
      PERFORM oact_audit(p_user, 'Member', 'role.granted', 'user', p_user,
        jsonb_build_object('role', v_role, 'via', 'invitation', 'invitationId', p_invitation_id));
    END IF;
    RETURN jsonb_build_object('status', v_new_status, 'platformRole', CASE WHEN p_action = 'accept' THEN v_role END);
  END $$`,

  /* ---------- admin ---------- */
  `CREATE OR REPLACE FUNCTION oact_invite_supervisor(p_actor TEXT, p_invitee TEXT, p_invitee_kristo TEXT,
    p_church TEXT, p_invitation_id TEXT, p_limit INT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_existing TEXT; v_used INT;
  BEGIN
    INSERT INTO kristo_oact_members (user_id, role, status) VALUES (p_invitee, 'Supervisor', 'active')
    ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM kristo_oact_members WHERE user_id = p_invitee FOR UPDATE;
    IF p_limit IS NOT NULL THEN
      v_used := oact_used_slots(p_invitee);
      IF p_limit < v_used THEN
        PERFORM oact_fail(409, 'The limit cannot be lower than the agents this supervisor already has');
      END IF;
      UPDATE kristo_oact_members SET agent_limit = p_limit, limit_updated_at = NOW(), limit_updated_by = p_actor,
        updated_at = NOW() WHERE user_id = p_invitee;
    END IF;
    SELECT id INTO v_existing FROM kristo_offline_activation_invitations
    WHERE invitee_user_id = p_invitee AND church_id = p_church AND role = 'Supervisor' AND status = 'pending';
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'alreadyPending', 'invitationId', v_existing);
    END IF;
    INSERT INTO kristo_offline_activation_invitations (id, invitee_user_id, invitee_kristo_id, church_id,
      invited_by_user_id, role, status, created_at, responded_at)
    VALUES (p_invitation_id, p_invitee, p_invitee_kristo, p_church, p_actor, 'Supervisor', 'pending', NOW(), NULL);
    PERFORM oact_audit(p_actor, 'System_Admin', 'supervisor.invited', 'invitation', p_invitation_id,
      jsonb_build_object('inviteeUserId', p_invitee, 'churchId', p_church, 'agentLimit', p_limit));
    RETURN jsonb_build_object('outcome', 'invited', 'invitationId', p_invitation_id);
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_set_supervisor_limit(p_actor TEXT, p_sup TEXT, p_limit INT, p_default_limit INT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_m kristo_oact_members; v_role TEXT; v_used INT; v_previous INT;
  BEGIN
    SELECT platform_role INTO v_role FROM kristo_platform_roles WHERE user_id = p_sup;
    IF v_role IS DISTINCT FROM 'Supervisor'
      AND NOT EXISTS (SELECT 1 FROM kristo_oact_members WHERE user_id = p_sup AND role = 'Supervisor') THEN
      PERFORM oact_fail(404, 'Supervisor not found');
    END IF;
    v_m := oact_lock_supervisor(p_sup);
    v_used := oact_used_slots(p_sup);
    IF p_limit < v_used THEN
      PERFORM oact_fail(409, format('This supervisor already has %s agents; the limit cannot be lower than that', v_used));
    END IF;
    v_previous := oact_effective_limit(v_m, v_used, p_default_limit);
    UPDATE kristo_oact_members SET agent_limit = p_limit, limit_updated_at = NOW(), limit_updated_by = p_actor,
      updated_at = NOW() WHERE user_id = p_sup;
    PERFORM oact_audit(p_actor, 'System_Admin', 'supervisor.limit_changed', 'user', p_sup,
      jsonb_build_object('previous', v_previous, 'next', p_limit));
    RETURN jsonb_build_object('previous', v_previous, 'next', p_limit, 'used', v_used);
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_set_member_status(p_actor TEXT, p_user TEXT, p_status TEXT, p_reason TEXT,
    p_default_limit INT DEFAULT 5)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_role TEXT; v_m kristo_oact_members; v_member_role TEXT; v_previous TEXT; v_sup TEXT;
    v_sm kristo_oact_members; v_used INT; v_limit INT;
  BEGIN
    IF p_status NOT IN ('active', 'suspended', 'revoked') THEN
      PERFORM oact_fail(400, 'status must be active, suspended or revoked');
    END IF;
    IF p_user = p_actor THEN PERFORM oact_fail(400, 'Cannot change your own access'); END IF;

    SELECT platform_role INTO v_role FROM kristo_platform_roles WHERE user_id = p_user;
    IF v_role = 'System_Admin' THEN PERFORM oact_fail(400, 'System_Admin access is not managed here'); END IF;
    SELECT * INTO v_m FROM kristo_oact_members WHERE user_id = p_user;
    v_member_role := coalesce(CASE WHEN v_role IN ('Supervisor', 'Agent') THEN v_role END, v_m.role);
    IF v_member_role IS NULL THEN PERFORM oact_fail(404, 'Supervisor or agent not found'); END IF;

    -- Lock order: supervisor -> member.
    IF v_member_role = 'Agent' THEN
      v_sup := coalesce(v_m.supervisor_user_id,
        (SELECT supervisor_user_id FROM kristo_oact_agents WHERE linked_user_id = p_user ORDER BY updated_at DESC LIMIT 1));
      IF v_sup IS NULL THEN PERFORM oact_fail(404, 'Supervisor or agent not found'); END IF;
      v_sm := oact_lock_supervisor(v_sup);
    ELSE
      PERFORM oact_lock_supervisor(p_user);
    END IF;
    PERFORM oact_lock_user(p_user);
    SELECT platform_role INTO v_role FROM kristo_platform_roles WHERE user_id = p_user FOR UPDATE;
    SELECT * INTO v_m FROM kristo_oact_members WHERE user_id = p_user FOR UPDATE;

    IF v_m.user_id IS NULL THEN
      INSERT INTO kristo_oact_members (user_id, role, status, supervisor_user_id)
      VALUES (p_user, v_member_role, 'active', CASE WHEN v_member_role = 'Agent' THEN v_sup END);
      v_previous := 'active';
    ELSE
      v_previous := v_m.status;
    END IF;

    IF p_status = 'active' AND v_previous = 'revoked' THEN
      IF v_member_role = 'Agent' THEN
        -- A reinstated agent takes a slot again: the limit still applies.
        v_used := oact_used_slots(v_sup, p_user);
        v_limit := oact_effective_limit(v_sm, v_used, p_default_limit);
        IF EXISTS (SELECT 1 FROM kristo_oact_agents WHERE linked_user_id = p_user AND supervisor_user_id = v_sup
            AND status IN ('pending', 'accepted')) AND v_used + 1 > v_limit THEN
          PERFORM oact_fail(409, format('Agent limit reached (%s/%s)', v_used, v_limit));
        END IF;
      END IF;
      INSERT INTO kristo_platform_roles (user_id, platform_role, note, created_at, updated_at)
      VALUES (p_user, v_member_role, 'Reinstated by ' || p_actor, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET platform_role = EXCLUDED.platform_role, note = EXCLUDED.note, updated_at = NOW();
      PERFORM oact_audit(p_actor, 'System_Admin', 'role.granted', 'user', p_user,
        jsonb_build_object('role', v_member_role, 'reason', 'reinstated'));
    END IF;

    UPDATE kristo_oact_members SET role = v_member_role, status = p_status, status_reason = nullif(p_reason, ''),
      status_changed_at = NOW(), status_changed_by = p_actor, updated_at = NOW(),
      supervisor_user_id = CASE WHEN v_member_role = 'Agent' THEN coalesce(supervisor_user_id, v_sup) ELSE NULL END
    WHERE user_id = p_user;

    IF p_status = 'revoked' AND v_role IS NOT NULL THEN
      DELETE FROM kristo_platform_roles WHERE user_id = p_user;
      PERFORM oact_audit(p_actor, 'System_Admin', 'role.removed', 'user', p_user,
        jsonb_build_object('role', v_member_role, 'reason', nullif(p_reason, '')));
    END IF;
    PERFORM oact_audit(p_actor, 'System_Admin', 'member.status_changed', 'user', p_user,
      jsonb_build_object('role', v_member_role, 'previous', v_previous, 'next', p_status, 'reason', nullif(p_reason, '')));
    RETURN jsonb_build_object('role', v_member_role, 'previous', v_previous, 'status', p_status);
  END $$`,

  /* ---------- legacy supervisor routes: update / remove an agent ---------- */
  `CREATE OR REPLACE FUNCTION oact_update_agent(p_sup TEXT, p_agent_id TEXT, p_full_name TEXT, p_phone TEXT,
    p_status TEXT, p_avatar TEXT, p_default_limit INT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_m kristo_oact_members; v_a kristo_oact_agents; v_next TEXT; v_um kristo_oact_members;
    v_used INT; v_limit INT; v_role TEXT;
  BEGIN
    IF (SELECT platform_role FROM kristo_platform_roles WHERE user_id = p_sup) IS DISTINCT FROM 'Supervisor' THEN
      PERFORM oact_fail(403, 'Forbidden (platform role)');
    END IF;
    v_m := oact_lock_supervisor(p_sup);
    IF v_m.status <> 'active' THEN PERFORM oact_fail(403, 'Access ' || v_m.status); END IF;
    SELECT * INTO v_a FROM kristo_oact_agents
    WHERE id = p_agent_id AND supervisor_user_id = p_sup AND status <> 'removed' FOR UPDATE;
    IF NOT FOUND THEN PERFORM oact_fail(404, 'Agent not found.'); END IF;
    IF v_a.linked_user_id IS NOT NULL THEN PERFORM oact_lock_user(v_a.linked_user_id); END IF;

    v_next := v_a.status;
    IF p_status IS NOT NULL AND (CASE WHEN p_status = 'active' THEN 'accepted' ELSE p_status END) <> v_a.status THEN
      IF v_a.status IN ('pending', 'declined') THEN
        PERFORM oact_fail(400, 'Cannot change status until the agent accepts or declines the invitation.');
      END IF;
      IF p_status = 'inactive' AND v_a.status = 'accepted' THEN
        v_next := 'inactive';
      ELSIF p_status IN ('accepted', 'active') AND v_a.status = 'inactive' THEN
        IF v_a.linked_user_id IS NOT NULL THEN
          SELECT * INTO v_um FROM kristo_oact_members WHERE user_id = v_a.linked_user_id FOR UPDATE;
          IF v_um.status IN ('suspended', 'revoked') THEN
            PERFORM oact_fail(403, 'Agent access is ' || v_um.status || ' by System Admin');
          END IF;
          SELECT platform_role INTO v_role FROM kristo_platform_roles WHERE user_id = v_a.linked_user_id;
          IF v_role IN ('System_Admin', 'Supervisor') THEN
            PERFORM oact_fail(409, 'User already has the ' || v_role || ' role');
          END IF;
          IF oact_current_supervisor(v_a.linked_user_id, p_sup) IS NOT NULL THEN
            PERFORM oact_fail(409, 'This agent already works with another supervisor');
          END IF;
        END IF;
        v_used := oact_used_slots(p_sup, v_a.linked_user_id);
        v_limit := oact_effective_limit(v_m, v_used, p_default_limit);
        IF v_used + oact_open_code_slots(p_sup) + 1 > v_limit THEN
          PERFORM oact_fail(409, format('Agent limit reached (%s agents + %s open invite slots of %s)',
            v_used, oact_open_code_slots(p_sup), v_limit));
        END IF;
        v_next := 'accepted';
      ELSE
        PERFORM oact_fail(400, 'Only accepted agents can be set inactive, or inactive agents reactivated.');
      END IF;
    END IF;

    UPDATE kristo_oact_agents SET
      full_name = coalesce(nullif(p_full_name, ''), full_name),
      phone = coalesce(p_phone, phone),
      avatar_url = CASE WHEN p_avatar IS NULL THEN avatar_url ELSE nullif(p_avatar, '') END,
      status = v_next, updated_at = NOW()
    WHERE id = p_agent_id
    RETURNING * INTO v_a;
    IF p_status IS NOT NULL THEN
      PERFORM oact_audit(p_sup, 'Supervisor', 'agent.status_changed', 'user', coalesce(v_a.linked_user_id, v_a.id),
        jsonb_build_object('agentRegistrationId', v_a.id, 'next', v_next));
    END IF;
    RETURN to_jsonb(v_a);
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_remove_agent(p_sup TEXT, p_agent_id TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_m kristo_oact_members; v_a kristo_oact_agents;
  BEGIN
    IF (SELECT platform_role FROM kristo_platform_roles WHERE user_id = p_sup) IS DISTINCT FROM 'Supervisor' THEN
      PERFORM oact_fail(403, 'Forbidden (platform role)');
    END IF;
    v_m := oact_lock_supervisor(p_sup);
    IF v_m.status <> 'active' THEN PERFORM oact_fail(403, 'Access ' || v_m.status); END IF;
    SELECT * INTO v_a FROM kristo_oact_agents
    WHERE id = p_agent_id AND supervisor_user_id = p_sup AND status <> 'removed' FOR UPDATE;
    IF NOT FOUND THEN PERFORM oact_fail(404, 'Agent not found.'); END IF;
    IF v_a.linked_user_id IS NOT NULL THEN PERFORM oact_lock_user(v_a.linked_user_id); END IF;
    IF v_a.status = 'pending' AND v_a.linked_user_id IS NOT NULL THEN
      UPDATE kristo_offline_activation_invitations SET status = 'cancelled', responded_at = NOW()
      WHERE invitee_user_id = v_a.linked_user_id AND church_id = v_a.church_id AND role = 'Agent'
        AND invited_by_user_id = p_sup AND status = 'pending';
    END IF;
    -- Soft delete: the registration stays as history and no longer holds a slot.
    UPDATE kristo_oact_agents SET status = 'removed', updated_at = NOW() WHERE id = p_agent_id;
    PERFORM oact_audit(p_sup, 'Supervisor', 'agent.removed', 'user', coalesce(v_a.linked_user_id, v_a.id),
      jsonb_build_object('agentRegistrationId', v_a.id, 'previous', v_a.status));
    RETURN jsonb_build_object('removed', TRUE, 'previous', v_a.status);
  END $$`,

  /* ---------- one-time import of the agents document ---------- */
  `CREATE OR REPLACE FUNCTION oact_migrate_agents_document() RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_count INT;
  BEGIN
    IF EXISTS (SELECT 1 FROM kristo_oact_migrations WHERE name = '${PROGRAM_AGENTS_MIGRATION}') THEN
      RETURN jsonb_build_object('skipped', TRUE);
    END IF;
    WITH src AS (
      SELECT e, o,
        row_number() OVER (PARTITION BY e->>'supervisorUserId', nullif(e->>'linkedUserId', ''), coalesce(e->>'churchId', '')
          ORDER BY oact_try_ts(e->>'updatedAt') DESC NULLS LAST, o DESC) AS dup_rank,
        row_number() OVER (PARTITION BY coalesce(nullif(e->>'id', ''), md5(e::text)) ORDER BY o) AS id_rank
      FROM kristo_offline_activation_store s,
        jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'agents') = 'array' THEN s.data->'agents' ELSE '[]'::jsonb END)
          WITH ORDINALITY t(e, o)
      WHERE s.key = 'offline_activation_agents.json' AND coalesce(e->>'supervisorUserId', '') <> ''
    )
    INSERT INTO kristo_oact_agents (id, supervisor_user_id, kristo_id, church_id, full_name, phone, status, avatar_url,
      linked_user_id, migrated_note, created_at, updated_at)
    SELECT
      coalesce(nullif(e->>'id', ''), 'oactagent_mig_' || md5(e::text)) || CASE WHEN id_rank > 1 THEN '_dup' || o ELSE '' END,
      e->>'supervisorUserId', upper(coalesce(e->>'kristoId', '')), coalesce(e->>'churchId', ''),
      coalesce(e->>'fullName', ''), coalesce(e->>'phone', ''),
      CASE WHEN dup_rank > 1 AND nullif(e->>'linkedUserId', '') IS NOT NULL THEN 'removed'
        ELSE CASE coalesce(nullif(e->>'status', ''), 'accepted')
          WHEN 'active' THEN 'accepted' WHEN 'pending' THEN 'pending' WHEN 'declined' THEN 'declined'
          WHEN 'inactive' THEN 'inactive' ELSE 'accepted' END END,
      nullif(e->>'avatarUrl', ''),
      CASE WHEN nullif(e->>'linkedUserId', '') = e->>'supervisorUserId' THEN NULL ELSE nullif(e->>'linkedUserId', '') END,
      CASE WHEN dup_rank > 1 AND nullif(e->>'linkedUserId', '') IS NOT NULL
        THEN 'duplicate registration kept as history; original status ' || coalesce(e->>'status', '') END,
      coalesce(oact_try_ts(e->>'createdAt'), NOW()), coalesce(oact_try_ts(e->>'updatedAt'), oact_try_ts(e->>'createdAt'), NOW())
    FROM src
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    INSERT INTO kristo_oact_migrations (name) VALUES ('${PROGRAM_AGENTS_MIGRATION}');
    RETURN jsonb_build_object('agents', v_count);
  END $$`,

  /* ---------- church onboarding, training, leader confirmation ---------- */
  `CREATE OR REPLACE FUNCTION oact_save_onboarding(p_agent TEXT, p_sup TEXT, p_leader TEXT, p_leader_kristo TEXT,
    p_church TEXT, p_new_id TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_o kristo_oact_onboardings; v_registered BOOLEAN := FALSE;
  BEGIN
    IF p_agent = p_leader THEN PERFORM oact_fail(400, 'An agent cannot be the leader they report on'); END IF;
    IF p_church IS NOT NULL THEN
      SELECT * INTO v_o FROM kristo_oact_onboardings WHERE church_id = p_church FOR UPDATE;
    END IF;
    IF v_o.id IS NULL THEN
      SELECT * INTO v_o FROM kristo_oact_onboardings WHERE leader_user_id = p_leader AND church_id IS NULL FOR UPDATE;
    END IF;
    IF v_o.id IS NOT NULL THEN
      IF v_o.agent_user_id <> p_agent THEN
        PERFORM oact_fail(409, 'This church is already supported by another agent');
      END IF;
      IF p_church IS NOT NULL AND v_o.church_id IS NULL THEN
        UPDATE kristo_oact_onboardings SET church_id = p_church, registered_at = NOW(),
          status = CASE WHEN status = 'invited' THEN 'registered' ELSE status END, updated_at = NOW()
        WHERE id = v_o.id;
        PERFORM oact_audit(p_agent, 'Agent', 'onboarding.church_registered', 'onboarding', v_o.id,
          jsonb_build_object('churchId', p_church));
        v_registered := TRUE;
      END IF;
      RETURN jsonb_build_object('id', v_o.id, 'created', FALSE, 'registeredNow', v_registered);
    END IF;

    BEGIN
      INSERT INTO kristo_oact_onboardings (id, agent_user_id, supervisor_user_id, leader_user_id, leader_kristo_id,
        church_id, registered_at, status)
      VALUES (p_new_id, p_agent, p_sup, p_leader, p_leader_kristo, p_church,
        CASE WHEN p_church IS NULL THEN NULL ELSE NOW() END,
        CASE WHEN p_church IS NULL THEN 'invited' ELSE 'registered' END);
    EXCEPTION WHEN unique_violation THEN
      -- Another request created it at the same moment: re-read under lock.
      SELECT * INTO v_o FROM kristo_oact_onboardings
      WHERE (p_church IS NOT NULL AND church_id = p_church) OR (leader_user_id = p_leader AND church_id IS NULL)
      LIMIT 1 FOR UPDATE;
      IF v_o.agent_user_id IS DISTINCT FROM p_agent THEN
        PERFORM oact_fail(409, 'This church is already supported by another agent');
      END IF;
      RETURN jsonb_build_object('id', v_o.id, 'created', FALSE, 'registeredNow', FALSE);
    END;
    PERFORM oact_audit(p_agent, 'Agent', 'onboarding.created', 'onboarding', p_new_id,
      jsonb_build_object('leaderUserId', p_leader, 'churchId', p_church, 'supervisorUserId', p_sup));
    IF p_church IS NOT NULL THEN
      PERFORM oact_audit(p_agent, 'Agent', 'onboarding.church_registered', 'onboarding', p_new_id,
        jsonb_build_object('churchId', p_church));
    END IF;
    RETURN jsonb_build_object('id', p_new_id, 'created', TRUE, 'registeredNow', p_church IS NOT NULL);
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_submit_report(p_agent TEXT, p_onboarding TEXT, p_church TEXT, p_report JSONB,
    p_request_id TEXT, p_question TEXT, p_now TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_o kristo_oact_onboardings; v_pending kristo_oact_confirmations; v_last_status TEXT;
    v_prev JSONB; v_version INT; v_report JSONB; v_completed BOOLEAN; v_requested BOOLEAN := FALSE;
    v_registered BOOLEAN := FALSE; v_status TEXT;
  BEGIN
    SELECT * INTO v_o FROM kristo_oact_onboardings WHERE id = p_onboarding FOR UPDATE;
    IF NOT FOUND OR v_o.agent_user_id <> p_agent THEN PERFORM oact_fail(404, 'Onboarding not found'); END IF;
    SELECT status INTO v_last_status FROM kristo_oact_confirmations WHERE onboarding_id = p_onboarding
    ORDER BY requested_at DESC LIMIT 1;
    IF v_last_status = 'confirmed' THEN PERFORM oact_fail(409, 'The leader already confirmed this training'); END IF;
    IF v_o.church_id IS NULL THEN
      IF p_church IS NULL THEN PERFORM oact_fail(400, 'Register the church (Church ID) before submitting training'); END IF;
      UPDATE kristo_oact_onboardings SET church_id = p_church, registered_at = NOW(), updated_at = NOW()
      WHERE id = p_onboarding;
      v_registered := TRUE;
      PERFORM oact_audit(p_agent, 'Agent', 'onboarding.church_registered', 'onboarding', p_onboarding,
        jsonb_build_object('churchId', p_church));
    END IF;

    v_completed := coalesce((p_report->>'trainingCompleted')::boolean, FALSE);
    v_prev := v_o.agent_report;
    SELECT * INTO v_pending FROM kristo_oact_confirmations WHERE onboarding_id = p_onboarding AND status = 'pending' FOR UPDATE;
    IF v_prev IS NOT NULL
      AND (v_prev - 'submittedAt' - 'version') = p_report
      AND (v_pending.request_id IS NOT NULL OR NOT v_completed) THEN
      RETURN jsonb_build_object('duplicate', TRUE, 'confirmationRequested', FALSE, 'registeredNow', v_registered);
    END IF;

    v_version := coalesce((v_prev->>'version')::int, 0) + 1;
    v_report := p_report || jsonb_build_object('submittedAt', p_now, 'version', v_version);
    IF v_completed THEN
      IF v_pending.request_id IS NOT NULL THEN
        UPDATE kristo_oact_confirmations SET report_version = v_version WHERE request_id = v_pending.request_id;
      ELSE
        INSERT INTO kristo_oact_confirmations (request_id, onboarding_id, leader_user_id, status, question,
          report_version, requested_at)
        VALUES (p_request_id, p_onboarding, v_o.leader_user_id, 'pending', p_question, v_version, NOW());
        v_requested := TRUE;
      END IF;
      v_status := 'awaiting_confirmation';
    ELSE
      v_status := CASE WHEN v_pending.request_id IS NOT NULL THEN 'awaiting_confirmation' ELSE 'training_pending' END;
    END IF;
    UPDATE kristo_oact_onboardings SET agent_report = v_report, status = v_status, updated_at = NOW()
    WHERE id = p_onboarding;

    PERFORM oact_audit(p_agent, 'Agent', 'onboarding.report_submitted', 'onboarding', p_onboarding,
      jsonb_build_object('version', v_version, 'trainingCompleted', v_completed,
        'followUpStatus', p_report->>'followUpStatus', 'topicCount', jsonb_array_length(coalesce(p_report->'trainingTopics', '[]'::jsonb))));
    IF v_requested THEN
      PERFORM oact_audit(p_agent, 'Agent', 'confirmation.requested', 'confirmation', p_request_id,
        jsonb_build_object('onboardingId', p_onboarding, 'leaderUserId', v_o.leader_user_id));
    END IF;
    RETURN jsonb_build_object('duplicate', FALSE, 'confirmationRequested', v_requested, 'registeredNow', v_registered);
  END $$`,

  `CREATE OR REPLACE FUNCTION oact_respond_confirmation(p_leader TEXT, p_request TEXT, p_response TEXT, p_note TEXT)
  RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_c kristo_oact_confirmations;
  BEGIN
    IF p_response NOT IN ('confirmed', 'rejected', 'needs_help') THEN
      PERFORM oact_fail(400, 'response must be confirm, reject or needs_help');
    END IF;
    SELECT * INTO v_c FROM kristo_oact_confirmations WHERE request_id = p_request FOR UPDATE;
    IF NOT FOUND OR v_c.leader_user_id <> p_leader THEN PERFORM oact_fail(404, 'Confirmation request not found'); END IF;
    IF v_c.status <> 'pending' THEN
      IF v_c.status = p_response THEN
        RETURN jsonb_build_object('duplicate', TRUE, 'onboardingId', v_c.onboarding_id, 'status', v_c.status);
      END IF;
      PERFORM oact_fail(409, 'Already answered: ' || v_c.status);
    END IF;
    UPDATE kristo_oact_confirmations SET status = p_response, responded_at = NOW(), responded_by = p_leader,
      note = nullif(p_note, '')
    WHERE request_id = p_request;
    UPDATE kristo_oact_onboardings SET status = p_response, updated_at = NOW() WHERE id = v_c.onboarding_id;
    PERFORM oact_audit(p_leader, 'Church_Leader', 'confirmation.responded', 'confirmation', p_request,
      jsonb_build_object('onboardingId', v_c.onboarding_id, 'response', p_response, 'hasNote', coalesce(p_note, '') <> ''));
    RETURN jsonb_build_object('duplicate', FALSE, 'onboardingId', v_c.onboarding_id, 'status', p_response);
  END $$`,

  /* ---------- Lab admin sign-in codes ---------- */
  `CREATE OR REPLACE FUNCTION oact_create_admin_login_code(p_user TEXT, p_hash TEXT, p_expires_at TIMESTAMPTZ)
  RETURNS VOID LANGUAGE plpgsql AS $$
  BEGIN
    DELETE FROM kristo_oact_admin_login_codes WHERE user_id = p_user OR expires_at < NOW() - INTERVAL '1 day';
    INSERT INTO kristo_oact_admin_login_codes (code_hash, user_id, expires_at) VALUES (p_hash, p_user, p_expires_at);
    PERFORM oact_audit(p_user, 'System_Admin', 'admin.login_code_created', 'admin_session', p_user,
      jsonb_build_object('expiresAt', p_expires_at));
  END $$`,

  /* ---------- one-time import of the JSON documents written before the tables existed ---------- */
  `CREATE OR REPLACE FUNCTION oact_migrate_json_documents() RETURNS JSONB LANGUAGE plpgsql AS $$
  DECLARE v_program JSONB; v_audit JSONB; v_counts JSONB;
  BEGIN
    IF EXISTS (SELECT 1 FROM kristo_oact_migrations WHERE name = '${PROGRAM_JSON_MIGRATION}') THEN
      RETURN jsonb_build_object('skipped', TRUE);
    END IF;
    SELECT data INTO v_program FROM kristo_offline_activation_store WHERE key = 'offline_activation_program.json';
    SELECT data INTO v_audit FROM kristo_offline_activation_store WHERE key = 'offline_activation_audit.json';
    v_program := coalesce(v_program, '{}'::jsonb);

    INSERT INTO kristo_oact_members (user_id, role, status, agent_limit, supervisor_user_id, status_reason,
      status_changed_at, status_changed_by, limit_updated_at, limit_updated_by, created_at, updated_at)
    SELECT k, v->>'role', coalesce(v->>'status', 'active'), (v->>'agentLimit')::int, v->>'supervisorUserId',
      v->>'statusReason', (v->>'statusChangedAt')::timestamptz, v->>'statusChangedBy',
      (v->>'limitUpdatedAt')::timestamptz, v->>'limitUpdatedBy',
      coalesce((v->>'createdAt')::timestamptz, NOW()), coalesce((v->>'updatedAt')::timestamptz, NOW())
    FROM jsonb_each(coalesce(v_program->'members', '{}'::jsonb)) AS m(k, v)
    WHERE v->>'role' IN ('Supervisor', 'Agent') AND (v->>'role' <> 'Agent' OR v->>'supervisorUserId' IS NOT NULL)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO kristo_oact_invite_codes (id, code_hash, code_preview, supervisor_user_id, max_uses, used_count,
      expires_at, created_at, created_by, revoked_at, revoked_by)
    SELECT c->>'id', c->>'codeHash', coalesce(c->>'codePreview', ''), c->>'supervisorUserId', (c->>'maxUses')::int,
      least(jsonb_array_length(coalesce(c->'uses', '[]'::jsonb)), (c->>'maxUses')::int),
      (c->>'expiresAt')::timestamptz, coalesce((c->>'createdAt')::timestamptz, NOW()),
      coalesce(c->>'createdBy', c->>'supervisorUserId'), (c->>'revokedAt')::timestamptz, c->>'revokedBy'
    FROM jsonb_array_elements(coalesce(v_program->'agentInviteCodes', '[]'::jsonb)) c
    ON CONFLICT DO NOTHING;
    INSERT INTO kristo_oact_invite_code_uses (code_id, user_id, used_at)
    SELECT c->>'id', u->>'userId', coalesce((u->>'at')::timestamptz, NOW())
    FROM jsonb_array_elements(coalesce(v_program->'agentInviteCodes', '[]'::jsonb)) c,
      jsonb_array_elements(coalesce(c->'uses', '[]'::jsonb)) u
    WHERE EXISTS (SELECT 1 FROM kristo_oact_invite_codes x WHERE x.id = c->>'id')
    ON CONFLICT DO NOTHING;

    INSERT INTO kristo_oact_onboardings (id, agent_user_id, supervisor_user_id, leader_user_id, leader_kristo_id,
      church_id, registered_at, status, agent_report, created_at, updated_at)
    SELECT o->>'id', o->>'agentUserId', o->>'supervisorUserId', o->>'leaderUserId', coalesce(o->>'leaderKristoId', ''),
      nullif(o->>'churchId', ''),
      CASE WHEN nullif(o->>'churchId', '') IS NULL THEN NULL
        ELSE coalesce((o->>'registeredAt')::timestamptz, (o->>'createdAt')::timestamptz, NOW()) END,
      coalesce(o->>'status', 'invited'), CASE WHEN jsonb_typeof(o->'agentReport') = 'object' THEN o->'agentReport' END,
      coalesce((o->>'createdAt')::timestamptz, NOW()), coalesce((o->>'updatedAt')::timestamptz, NOW())
    FROM jsonb_array_elements(coalesce(v_program->'onboardings', '[]'::jsonb)) o
    ON CONFLICT DO NOTHING;
    INSERT INTO kristo_oact_confirmations (request_id, onboarding_id, leader_user_id, status, question, report_version,
      requested_at, responded_at, responded_by, note)
    SELECT c->>'requestId', o->>'id', o->>'leaderUserId', c->>'status', coalesce(c->>'question', ''),
      coalesce((c->>'reportVersion')::int, 1), (c->>'requestedAt')::timestamptz,
      CASE WHEN c->>'status' = 'pending' THEN NULL ELSE coalesce((c->>'respondedAt')::timestamptz, NOW()) END,
      CASE WHEN c->>'status' = 'pending' THEN NULL ELSE coalesce(c->>'respondedByUserId', o->>'leaderUserId') END,
      c->>'note'
    FROM jsonb_array_elements(coalesce(v_program->'onboardings', '[]'::jsonb)) o,
      jsonb_array_elements(coalesce(o->'confirmationHistory', '[]'::jsonb)
        || CASE WHEN jsonb_typeof(o->'leaderConfirmation') = 'object' THEN jsonb_build_array(o->'leaderConfirmation')
           ELSE '[]'::jsonb END) c
    WHERE EXISTS (SELECT 1 FROM kristo_oact_onboardings x WHERE x.id = o->>'id')
    ON CONFLICT DO NOTHING;

    INSERT INTO kristo_oact_audit (id, at, actor_user_id, actor_role, action, target_type, target_id, details)
    SELECT e->>'id', (e->>'at')::timestamptz, e->>'actorUserId', e->>'actorRole', e->>'action', e->>'targetType',
      coalesce(e->>'targetId', ''), e->'details'
    FROM jsonb_array_elements(coalesce(v_audit->'events', '[]'::jsonb)) e
    ON CONFLICT DO NOTHING;

    SELECT jsonb_build_object(
      'members', (SELECT count(*) FROM kristo_oact_members),
      'codes', (SELECT count(*) FROM kristo_oact_invite_codes),
      'onboardings', (SELECT count(*) FROM kristo_oact_onboardings),
      'confirmations', (SELECT count(*) FROM kristo_oact_confirmations),
      'audit', (SELECT count(*) FROM kristo_oact_audit)) INTO v_counts;
    INSERT INTO kristo_oact_migrations (name) VALUES ('${PROGRAM_JSON_MIGRATION}');
    RETURN v_counts;
  END $$`,
];
