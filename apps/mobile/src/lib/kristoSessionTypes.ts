export type KristoRole =
  | "Pastor"
  | "Member"
  | "Church_Admin"
  | "System_Admin"
  | "Leader"
  | "Ministry_Leader";

export type KristoMediaCategory =
  | "Teacher"
  | "Singer"
  | "Counselor"
  | "Preacher"
  | "Motivational Speaker"
  | "Testimony Creator"
  | "Bible Educator"
  | "Church Media";

export type KristoMediaProfile = {
  mediaName: string;
  category: KristoMediaCategory;
  subCategory: string;
  language: string;
  country: string;
  targetAudience: string;
  contentStyle: string;
  bio: string;
  tags: string[];
};

export type KristoSession = {
  userId: string;
  sessionToken?: string;
  kristoId?: string;
  role: KristoRole;
  churchId: string;
  activeChurchId?: string;
  name?: string;
  displayName?: string;
  gender?: string;
  phone?: string;
  email?: string;
  avatarUri?: string;
  avatarUrl?: string;
  profileImage?: string;
  address?: string;
  city?: string;
  country?: string;
  churchPhone?: string;
  churchCountry?: string;
  churchProvince?: string;
  churchCity?: string;
  churchPrimaryLanguage?: string;
  churchName?: string;
  churchRole?: KristoRole;
  mediaProfile?: KristoMediaProfile | null;
  createdAt?: number;
  lastSeenAt?: number;
  expiresAt?: number;
};
