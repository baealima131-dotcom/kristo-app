// app/api/church/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const runtime = "nodejs";

/* =========================
   TYPES
   ========================= */

type ID = string;

type Church = {
  id: ID;
  name: string;
  country?: string;
  city?: string;
  pastorName: string;
  pastorId: string;
  createdAt: number;
};

type MemberRole = "Member" | "Leader" | "Assistant" | "Treasurer" | "Secretary" | "Elder" | "Deacon" | "Usher";

type MembershipStatus = "Requested" | "Active" | "Rejected" | "Banned";

type Member = {
  id: ID;
  churchId: ID;
  fullName: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  status: MembershipStatus;
  createdAt: number;
  updatedAt: number;
};

type Role = {
  id: ID;
  churchId: ID;
  name: string; // e.g. "Choir Leader", "Women Prayer Coordinator"
  code?: string; // e.g. "CHOIR_LEADER" (optional)
  description?: string;
  createdAt: number;
  updatedAt: number;
};

type Ministry = {
  id: ID;
  churchId: ID;
  name: string; // e.g. "Choir", "Women", "Youth"
  description?: string;
  createdAt: number;
  updatedAt: number;
};

type MinistryMember = {
  id: ID;
  churchId: ID;
  ministryId: ID;
  memberId: ID;

  // optional: position label inside ministry
  position?: string; // e.g. "Leader", "Assistant", "Treasurer"
  createdAt: number;
};

type MinistryRoleLink = {
  id: ID;
  churchId: ID;
  ministryId: ID;
  roleId: ID;

  // optional: what this role means in that ministry
  label?: string; // e.g. "Leader", "Assistant", "Treasurer"
  createdAt: number;
};

type ChurchDB = {
  churches: Church[];
  members: Member[];
  roles: Role[];
  ministries: Ministry[];
  ministryMembers: MinistryMember[];
  ministryRoleLinks: MinistryRoleLink[];
  audit: { id: ID; at: string; action: string; meta?: any }[];
};

/* =========================
   DB (JSON FILE)
   ========================= */

const DB_PATH = path.join(process.cwd(), "app", "api", "church", "church_db.json");

function now() {
  return Date.now();
}

function nowISO() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function safeDb(): ChurchDB {
  return {
    churches: [],
    members: [],
    roles: [],
    ministries: [],
    ministryMembers: [],
    ministryRoleLinks: [],
    audit: [],
  };
}

function readDB(): ChurchDB {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const seed = seedDB();
      writeDB(seed);
      return seed;
    }
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      ...safeDb(),
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    const seed = seedDB();
    writeDB(seed);
    return seed;
  }
}

function writeDB(db: ChurchDB) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function audit(db: ChurchDB, action: string, meta?: any) {
  db.audit.unshift({ id: id("aud"), at: nowISO(), action, meta });
  db.audit = db.audit.slice(0, 400);
}

function seedDB(): ChurchDB {
  const db = safeDb();

  const c1: Church = {
    id: "c1",
    name: "Kristo Church - Dallas",
    country: "US",
    city: "Dallas",
    pastorName: "Pastor Daniel",
    pastorId: "pastor_1",
    createdAt: now(),
  };

  const c2: Church = {
    id: "c2",
    name: "Kristo Church - Burundi",
    country: "BI",
    city: "Bujumbura",
    pastorName: "Pastor Jean",
    pastorId: "pastor_2",
    createdAt: now(),
  };

  db.churches.push(c1, c2);

  const m1: Member = {
    id: "mb1",
    churchId: "c1",
    fullName: "Prince Fariji",
    phone: "",
    email: "",
    city: "Dallas",
    country: "US",
    status: "Active",
    createdAt: now(),
    updatedAt: now(),
  };

  const m2: Member = {
    id: "mb2",
    churchId: "c1",
    fullName: "Amina K.",
    city: "Dallas",
    country: "US",
    status: "Active",
    createdAt: now(),
    updatedAt: now(),
  };

  db.members.push(m1, m2);

  const choir: Ministry = {
    id: "min1",
    churchId: "c1",
    name: "Choir",
    description: "Waimbaji / Worship team",
    createdAt: now(),
    updatedAt: now(),
  };

  const women: Ministry = {
    id: "min2",
    churchId: "c1",
    name: "Women",
    description: "Idara ya wamama",
    createdAt: now(),
    updatedAt: now(),
  };

  db.ministries.push(choir, women);

  const rLeader: Role = {
    id: "role1",
    churchId: "c1",
    name: "Ministry Leader",
    code: "MIN_LEADER",
    description: "Kiongozi mkuu wa ministry",
    createdAt: now(),
    updatedAt: now(),
  };

  const rAssistant: Role = {
    id: "role2",
    churchId: "c1",
    name: "Ministry Assistant",
    code: "MIN_ASSISTANT",
    description: "Msaidizi wa kiongozi",
    createdAt: now(),
    updatedAt: now(),
  };

  const rTreasurer: Role = {
    id: "role3",
    churchId: "c1",
    name: "Ministry Treasurer",
    code: "MIN_TREASURER",
    description: "Mweka hazina",
    createdAt: now(),
    updatedAt: now(),
  };

  db.roles.push(rLeader, rAssistant, rTreasurer);

  // Link roles to Choir
  db.ministryRoleLinks.push(
    { id: id("mrl"), churchId: "c1", ministryId: "min1", roleId: "role1", label: "Leader", createdAt: now() },
    { id: id("mrl"), churchId: "c1", ministryId: "min1", roleId: "role2", label: "Assistant", createdAt: now() },
    { id: id("mrl"), churchId: "c1", ministryId: "min1", roleId: "role3", label: "Treasurer", createdAt: now() }
  );

  // Assign member to choir
  db.ministryMembers.push(
    { id: id("mm"), churchId: "c1", ministryId: "min1", memberId: "mb1", position: "Leader", createdAt: now() },
    { id: id("mm"), churchId: "c1", ministryId: "min1", memberId: "mb2", position: "Member", createdAt: now() }
  );

  audit(db, "seed_db", { churches: db.churches.length });

  return db;
}

/* =========================
   HELPERS
   ========================= */

function ok(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function str(x: any) {
  return String(x ?? "").trim();
}

function pickChurchOrFail(db: ChurchDB, churchId: string) {
  const cid = str(churchId);
  const church = db.churches.find((c) => c.id === cid) || null;
  if (!church) throw new Error("Invalid churchId");
  return { cid, church };
}

function ensureSameChurch(entityChurchId: string, cid: string) {
  if (str(entityChurchId) !== str(cid)) throw new Error("Cross-church access blocked");
}

function enrichMinistry(db: ChurchDB, min: Ministry) {
  const links = db.ministryRoleLinks.filter((x) => x.ministryId === min.id);
  const roleMap = new Map(db.roles.map((r) => [r.id, r]));
  const roles = links
    .map((l) => {
      const r = roleMap.get(l.roleId);
      if (!r) return null;
      return {
        linkId: l.id,
        roleId: r.id,
        roleName: r.name,
        roleCode: r.code,
        label: l.label || "",
        createdAt: l.createdAt,
      };
    })
    .filter(Boolean);

  const mm = db.ministryMembers.filter((x) => x.ministryId === min.id);
  const memberMap = new Map(db.members.map((m) => [m.id, m]));
  const members = mm
    .map((x) => {
      const m = memberMap.get(x.memberId);
      if (!m) return null;
      return {
        id: x.id,
        memberId: m.id,
        fullName: m.fullName,
        status: m.status,
        position: x.position || "",
        createdAt: x.createdAt,
      };
    })
    .filter(Boolean);

  return { ...min, roles, members, membersCount: members.length, rolesCount: roles.length };
}

/* =========================
   GET
   ========================= */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = str(url.searchParams.get("action"));

  const db = readDB();

  try {
    // --- debug/health
    if (!action || action === "health") {
      return ok({ message: "church api ready", dbPath: DB_PATH });
    }

    // --- core
    if (action === "db") {
      return ok({ db });
    }

    if (action === "churches") {
      return ok({ churches: db.churches });
    }

    // --- members
    if (action === "members") {
      const churchId = str(url.searchParams.get("churchId"));
      if (!churchId) return bad("churchId is required", 400);
      pickChurchOrFail(db, churchId);

      const members = db.members.filter((m) => m.churchId === churchId);
      return ok({ churchId, members });
    }

    // --- roles
    if (action === "roles") {
      const churchId = str(url.searchParams.get("churchId"));
      if (!churchId) return bad("churchId is required", 400);
      pickChurchOrFail(db, churchId);

      const roles = db.roles.filter((r) => r.churchId === churchId);
      return ok({ churchId, roles });
    }

    // --- ministries
    if (action === "ministries") {
      const churchId = str(url.searchParams.get("churchId"));
      if (!churchId) return bad("churchId is required", 400);
      pickChurchOrFail(db, churchId);

      const ministries = db.ministries
        .filter((m) => m.churchId === churchId)
        .map((m) => enrichMinistry(db, m));

      return ok({ churchId, ministries });
    }

    if (action === "ministry") {
      const churchId = str(url.searchParams.get("churchId"));
      const ministryId = str(url.searchParams.get("ministryId"));
      if (!churchId) return bad("churchId is required", 400);
      if (!ministryId) return bad("ministryId is required", 400);

      pickChurchOrFail(db, churchId);

      const min = db.ministries.find((m) => m.id === ministryId) || null;
      if (!min) return bad("Ministry not found", 404);
      ensureSameChurch(min.churchId, churchId);

      return ok({ churchId, ministry: enrichMinistry(db, min) });
    }

    if (action === "audit") {
      return ok({ audit: db.audit });
    }

    return bad("Unknown action", 400);
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}

/* =========================
   POST
   ========================= */

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return bad("Expected application/json", 415);
  }

  const body = await req.json().catch(() => ({}));
  const action = str(body?.action);

  const db = readDB();

  try {
    if (!action) return bad("action is required", 400);

    /* =========================
       CHURCH
       ========================= */

    if (action === "seed_reset") {
      const fresh = seedDB();
      writeDB(fresh);
      return ok({ reset: true, db: fresh });
    }

    if (action === "create_church") {
      const name = str(body?.name);
      const pastorName = str(body?.pastorName);
      const pastorId = str(body?.pastorId);
      if (!name) return bad("name is required", 400);
      if (!pastorName) return bad("pastorName is required", 400);
      if (!pastorId) return bad("pastorId is required", 400);

      const church: Church = {
        id: id("ch"),
        name,
        country: str(body?.country) || undefined,
        city: str(body?.city) || undefined,
        pastorName,
        pastorId,
        createdAt: now(),
      };

      db.churches.unshift(church);
      audit(db, "create_church", { churchId: church.id, name: church.name });
      writeDB(db);

      return ok({ church });
    }

    /* =========================
       MEMBERS
       ========================= */

    if (action === "create_member") {
      const churchId = str(body?.churchId);
      const fullName = str(body?.fullName);
      if (!churchId) return bad("churchId is required", 400);
      if (!fullName) return bad("fullName is required", 400);

      pickChurchOrFail(db, churchId);

      const member: Member = {
        id: id("mb"),
        churchId,
        fullName,
        phone: str(body?.phone) || undefined,
        email: str(body?.email) || undefined,
        city: str(body?.city) || undefined,
        country: str(body?.country) || undefined,
        status: (["Requested", "Active", "Rejected", "Banned"].includes(str(body?.status))
          ? str(body?.status)
          : "Active") as MembershipStatus,
        createdAt: now(),
        updatedAt: now(),
      };

      db.members.unshift(member);
      audit(db, "create_member", { churchId, memberId: member.id });
      writeDB(db);

      return ok({ member });
    }

    if (action === "update_member") {
      const churchId = str(body?.churchId);
      const memberId = str(body?.memberId);
      if (!churchId) return bad("churchId is required", 400);
      if (!memberId) return bad("memberId is required", 400);

      pickChurchOrFail(db, churchId);

      const m = db.members.find((x) => x.id === memberId) || null;
      if (!m) return bad("Member not found", 404);
      ensureSameChurch(m.churchId, churchId);

      const fullName = str(body?.fullName);
      if (fullName) m.fullName = fullName;

      const status = str(body?.status);
      if (status && ["Requested", "Active", "Rejected", "Banned"].includes(status)) {
        m.status = status as MembershipStatus;
      }

      const phone = str(body?.phone);
      const email = str(body?.email);
      const city = str(body?.city);
      const country = str(body?.country);

      if (phone !== "") m.phone = phone || undefined;
      if (email !== "") m.email = email || undefined;
      if (city !== "") m.city = city || undefined;
      if (country !== "") m.country = country || undefined;

      m.updatedAt = now();

      audit(db, "update_member", { churchId, memberId });
      writeDB(db);

      return ok({ member: m });
    }

    /* =========================
       ROLES
       ========================= */

    if (action === "create_role") {
      const churchId = str(body?.churchId);
      const name = str(body?.name);
      if (!churchId) return bad("churchId is required", 400);
      if (!name) return bad("name is required", 400);

      pickChurchOrFail(db, churchId);

      const role: Role = {
        id: id("role"),
        churchId,
        name,
        code: str(body?.code) || undefined,
        description: str(body?.description) || undefined,
        createdAt: now(),
        updatedAt: now(),
      };

      db.roles.unshift(role);
      audit(db, "create_role", { churchId, roleId: role.id });
      writeDB(db);

      return ok({ role });
    }

    if (action === "update_role") {
      const churchId = str(body?.churchId);
      const roleId = str(body?.roleId);
      if (!churchId) return bad("churchId is required", 400);
      if (!roleId) return bad("roleId is required", 400);

      pickChurchOrFail(db, churchId);

      const r = db.roles.find((x) => x.id === roleId) || null;
      if (!r) return bad("Role not found", 404);
      ensureSameChurch(r.churchId, churchId);

      const name = str(body?.name);
      const code = str(body?.code);
      const description = str(body?.description);

      if (name) r.name = name;
      if (code !== "") r.code = code || undefined;
      if (description !== "") r.description = description || undefined;

      r.updatedAt = now();

      audit(db, "update_role", { churchId, roleId });
      writeDB(db);

      return ok({ role: r });
    }

    /* =========================
       MINISTRIES
       ========================= */

    if (action === "create_ministry") {
      const churchId = str(body?.churchId);
      const name = str(body?.name);
      if (!churchId) return bad("churchId is required", 400);
      if (!name) return bad("name is required", 400);

      pickChurchOrFail(db, churchId);

      const ministry: Ministry = {
        id: id("min"),
        churchId,
        name,
        description: str(body?.description) || undefined,
        createdAt: now(),
        updatedAt: now(),
      };

      db.ministries.unshift(ministry);
      audit(db, "create_ministry", { churchId, ministryId: ministry.id });
      writeDB(db);

      return ok({ ministry: enrichMinistry(db, ministry) });
    }

    if (action === "update_ministry") {
      const churchId = str(body?.churchId);
      const ministryId = str(body?.ministryId);
      if (!churchId) return bad("churchId is required", 400);
      if (!ministryId) return bad("ministryId is required", 400);

      pickChurchOrFail(db, churchId);

      const min = db.ministries.find((x) => x.id === ministryId) || null;
      if (!min) return bad("Ministry not found", 404);
      ensureSameChurch(min.churchId, churchId);

      const name = str(body?.name);
      const description = str(body?.description);

      if (name) min.name = name;
      if (description !== "") min.description = description || undefined;

      min.updatedAt = now();

      audit(db, "update_ministry", { churchId, ministryId });
      writeDB(db);

      return ok({ ministry: enrichMinistry(db, min) });
    }

    /* =========================
       ROLES ↔ MINISTRIES (LINKING)
       (kiongozi, assistant, treasurer)
       ========================= */

    if (action === "link_role_to_ministry") {
      const churchId = str(body?.churchId);
      const ministryId = str(body?.ministryId);
      const roleId = str(body?.roleId);
      const label = str(body?.label);

      if (!churchId) return bad("churchId is required", 400);
      if (!ministryId) return bad("ministryId is required", 400);
      if (!roleId) return bad("roleId is required", 400);

      pickChurchOrFail(db, churchId);

      const min = db.ministries.find((m) => m.id === ministryId) || null;
      if (!min) return bad("Ministry not found", 404);
      ensureSameChurch(min.churchId, churchId);

      const role = db.roles.find((r) => r.id === roleId) || null;
      if (!role) return bad("Role not found", 404);
      ensureSameChurch(role.churchId, churchId);

      const exists = db.ministryRoleLinks.find((x) => x.ministryId === ministryId && x.roleId === roleId) || null;
      if (exists) {
        // update label only
        if (label !== "") exists.label = label || undefined;
        audit(db, "update_ministry_role_link", { churchId, ministryId, roleId });
        writeDB(db);
        return ok({ link: exists, ministry: enrichMinistry(db, min) });
      }

      const link: MinistryRoleLink = {
        id: id("mrl"),
        churchId,
        ministryId,
        roleId,
        label: label || undefined,
        createdAt: now(),
      };

      db.ministryRoleLinks.unshift(link);
      audit(db, "link_role_to_ministry", { churchId, ministryId, roleId, label: link.label });
      writeDB(db);

      return ok({ link, ministry: enrichMinistry(db, min) });
    }

    if (action === "unlink_role_from_ministry") {
      const churchId = str(body?.churchId);
      const linkId = str(body?.linkId);
      if (!churchId) return bad("churchId is required", 400);
      if (!linkId) return bad("linkId is required", 400);

      pickChurchOrFail(db, churchId);

      const link = db.ministryRoleLinks.find((x) => x.id === linkId) || null;
      if (!link) return bad("Link not found", 404);
      ensureSameChurch(link.churchId, churchId);

      db.ministryRoleLinks = db.ministryRoleLinks.filter((x) => x.id !== linkId);

      const min = db.ministries.find((m) => m.id === link.ministryId) || null;

      audit(db, "unlink_role_from_ministry", { churchId, linkId });
      writeDB(db);

      return ok({ removed: true, ministry: min ? enrichMinistry(db, min) : null });
    }

    /* =========================
       MEMBERS ↔ MINISTRIES (ASSIGNMENT)
       ========================= */

    if (action === "add_member_to_ministry") {
      const churchId = str(body?.churchId);
      const ministryId = str(body?.ministryId);
      const memberId = str(body?.memberId);
      const position = str(body?.position);

      if (!churchId) return bad("churchId is required", 400);
      if (!ministryId) return bad("ministryId is required", 400);
      if (!memberId) return bad("memberId is required", 400);

      pickChurchOrFail(db, churchId);

      const min = db.ministries.find((m) => m.id === ministryId) || null;
      if (!min) return bad("Ministry not found", 404);
      ensureSameChurch(min.churchId, churchId);

      const mem = db.members.find((m) => m.id === memberId) || null;
      if (!mem) return bad("Member not found", 404);
      ensureSameChurch(mem.churchId, churchId);

      const existing = db.ministryMembers.find((x) => x.ministryId === ministryId && x.memberId === memberId) || null;
      if (existing) {
        if (position !== "") existing.position = position || undefined;
        audit(db, "update_ministry_member", { churchId, ministryId, memberId });
        writeDB(db);
        return ok({ membership: existing, ministry: enrichMinistry(db, min) });
      }

      const mm: MinistryMember = {
        id: id("mm"),
        churchId,
        ministryId,
        memberId,
        position: position || undefined,
        createdAt: now(),
      };

      db.ministryMembers.unshift(mm);
      audit(db, "add_member_to_ministry", { churchId, ministryId, memberId, position: mm.position });
      writeDB(db);

      return ok({ membership: mm, ministry: enrichMinistry(db, min) });
    }

    if (action === "remove_member_from_ministry") {
      const churchId = str(body?.churchId);
      const membershipId = str(body?.membershipId);
      if (!churchId) return bad("churchId is required", 400);
      if (!membershipId) return bad("membershipId is required", 400);

      pickChurchOrFail(db, churchId);

      const mm = db.ministryMembers.find((x) => x.id === membershipId) || null;
      if (!mm) return bad("Membership not found", 404);
      ensureSameChurch(mm.churchId, churchId);

      db.ministryMembers = db.ministryMembers.filter((x) => x.id !== membershipId);

      const min = db.ministries.find((m) => m.id === mm.ministryId) || null;

      audit(db, "remove_member_from_ministry", { churchId, membershipId });
      writeDB(db);

      return ok({ removed: true, ministry: min ? enrichMinistry(db, min) : null });
    }

    return bad("Unknown action", 400);
  } catch (e: any) {
    return bad(e?.message || "Server error", 500);
  }
}
