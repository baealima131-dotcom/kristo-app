export type KingdomProject = {
  id: string
  title: string
  createdBy: string
  scope: "GLOBAL" | "CHURCH"
  expiresAt?: string
  status: "UPCOMING" | "ACTIVE" | "ENDED"
}

export type ProjectAssignment = {
  id: string
  projectId: string
  title: string
  startAt: string
  durationMinutes: number
  order: number
  mode: "SOLO" | "MULTI"
  status: "PENDING" | "LIVE" | "DONE"
}

export type AssignmentParticipant = {
  id: string
  assignmentId: string
  userId: string
  role: "HOST" | "GUEST" | "CHOIR" | "VIEWER"
  order: number
}

type ProjectState = {
  projects: KingdomProject[]
  assignments: ProjectAssignment[]
  participants: AssignmentParticipant[]
  getActiveAssignment: (projectId: string) => ProjectAssignment | null
  getAssignmentsByProject: (projectId: string) => ProjectAssignment[]
}

const now = Date.now()

const minsAgo = (m: number) => new Date(now - m * 60000).toISOString()
const minsLater = (m: number) => new Date(now + m * 60000).toISOString()

export const projectStore: ProjectState = {
  projects: [
    {
      id: "proj_global_tlmc_1",
      title: "Kingdom TLMC Global Prayer Night",
      createdBy: "kingdom-tlmc",
      scope: "GLOBAL",
      expiresAt: minsLater(180),
      status: "ACTIVE",
    },
    {
      id: "proj_church_youth_1",
      title: "Church Youth Ministries Live Sunday",
      createdBy: "c-demo-1",
      scope: "CHURCH",
      expiresAt: minsLater(240),
      status: "ACTIVE",
    },
  ],

  assignments: [
    {
      id: "asg_global_1",
      projectId: "proj_global_tlmc_1",
      title: "Opening Prayer",
      startAt: minsAgo(10),
      durationMinutes: 25,
      order: 1,
      mode: "SOLO",
      status: "LIVE",
    },
    {
      id: "asg_global_2",
      projectId: "proj_global_tlmc_1",
      title: "Choir Presentation",
      startAt: minsLater(16),
      durationMinutes: 20,
      order: 2,
      mode: "MULTI",
      status: "PENDING",
    },
    {
      id: "asg_global_3",
      projectId: "proj_global_tlmc_1",
      title: "Guest Introductions",
      startAt: minsLater(38),
      durationMinutes: 18,
      order: 3,
      mode: "MULTI",
      status: "PENDING",
    },

    {
      id: "asg_church_1",
      projectId: "proj_church_youth_1",
      title: "Youth Host Welcome",
      startAt: minsLater(20),
      durationMinutes: 15,
      order: 1,
      mode: "SOLO",
      status: "PENDING",
    },
    {
      id: "asg_church_2",
      projectId: "proj_church_youth_1",
      title: "Youth Choir Session",
      startAt: minsLater(36),
      durationMinutes: 20,
      order: 2,
      mode: "MULTI",
      status: "PENDING",
    },
  ],

  participants: [
    { id: "p1", assignmentId: "asg_global_1", userId: "u-demo-1", role: "HOST", order: 1 },
    { id: "p2", assignmentId: "asg_global_2", userId: "u-choir-1", role: "CHOIR", order: 1 },
    { id: "p3", assignmentId: "asg_global_2", userId: "u-choir-2", role: "CHOIR", order: 2 },
    { id: "p4", assignmentId: "asg_global_3", userId: "u-guest-1", role: "GUEST", order: 1 },
    { id: "p5", assignmentId: "asg_global_3", userId: "u-guest-2", role: "GUEST", order: 2 },

    { id: "p6", assignmentId: "asg_church_1", userId: "u-demo-1", role: "HOST", order: 1 },
    { id: "p7", assignmentId: "asg_church_2", userId: "u-youth-choir-1", role: "CHOIR", order: 1 },
    { id: "p8", assignmentId: "asg_church_2", userId: "u-youth-choir-2", role: "CHOIR", order: 2 },
  ],

  getActiveAssignment(projectId) {
    const nowMs = Date.now()

    return (
      this.assignments.find((a) => {
        const start = new Date(a.startAt).getTime()
        const end = start + a.durationMinutes * 60000
        return a.projectId === projectId && nowMs >= start && nowMs <= end
      }) || null
    )
  },

  getAssignmentsByProject(projectId) {
    return this.assignments
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => a.order - b.order)
  },
}
