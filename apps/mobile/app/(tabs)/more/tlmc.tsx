import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_AGENT_COMMAND,
  fetchMyWaySettings as fetchSharedMyWaySettings,
  type KeyVisibility,
  makeDefaultVisibility,
} from "@/src/lib/kingdomSettings";
import { View, Vibration,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ImageBackground,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { getSessionSync } from "@/src/lib/kristoSession";
import { TLMC_UNIVERSE_IMAGE, preloadTlmcAssets } from "@/src/lib/tlmcPreload";
import {
  MY_WAY_COMMAND_LENGTH,
  normalizeMyWayCommandCode,
  resolveMyWayCommand,
} from "@/src/lib/myWayCommands";

const BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.92)";
const BLUE = "rgba(0,145,255,0.92)";
const PAD = 16;

const CROSS_COLOR = "rgba(214,78,78,0.78)";

const STORAGE_DEVICE_ID = "tlmc.myway.deviceId.v2";
const STORAGE_SECURITY = "tlmc.myway.security.v2";
const STORAGE_AGENT_COMMAND = "tlmc.quickCommand.agent.v1";
const STORAGE_KEY_VISIBILITY = "tlmc.myway.keyVisibility.v1";
const DEFAULT_SECRET = "SEHEMUYANGU";
const SHOW_TLMC_COMMAND_PAD_ACTIONS = false;
const ALL_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

type Attempt = {
  userId: string;
  deviceId: string;
  at: string;
};

type MyWaySecurity = {
  ownerUserId: string | null;
  secretCode: string;
  trustedDeviceId: string | null;
  pendingAttempt: Attempt | null;
  rotationRequired: boolean;
};
type PadMode = "unlock" | "changeOld" | "changeNew";
type QuickCommand = "A" | "MYWAY" | null;
type OfficeTab = "overview" | "security" | "access" | "commands";

const BASE_KEY_ROWS = [
  ["A", "B", "C", "D", "E"],
  ["F", "G", "H", "I", "J"],
  ["K", "L", "M", "N", "O"],
  ["P", "Q", "R", "S", "T"],
  ["U", "V", "W", "X", "Y"],
  ["Z", "0", "1", "2", "3"],
  ["4", "5", "6", "7", "8"],
  ["9"],
] as const;

const KEY_COLORS: Record<string, string> = {
  A: "rgba(118,38,66,0.24)",
  B: "rgba(120,74,28,0.22)",
  C: "rgba(210,70,70,0.72)",
  D: "rgba(28,88,106,0.22)",
  E: "rgba(24,70,118,0.22)",
  F: "rgba(68,40,122,0.24)",
  G: "rgba(84,88,98,0.18)",
  H: "rgba(210,70,70,0.72)",
  I: "rgba(255,120,120,0.22)",
  J: "rgba(108,78,34,0.20)",
  K: "rgba(42,64,112,0.22)",
  L: "rgba(76,48,120,0.22)",
  M: "rgba(210,70,70,0.72)",
  N: "rgba(28,92,82,0.20)",
  O: "rgba(92,82,38,0.18)",
  P: "rgba(210,70,70,0.72)",
  Q: "rgba(210,70,70,0.72)",
  R: "rgba(210,70,70,0.72)",
  S: "rgba(210,70,70,0.72)",
  T: "rgba(210,70,70,0.72)",
  U: "rgba(62,48,116,0.22)",
  V: "rgba(82,44,66,0.22)",
  W: "rgba(210,70,70,0.72)",
  X: "rgba(42,78,100,0.20)",
  Y: "rgba(88,66,34,0.20)",
  Z: "rgba(82,30,66,0.22)",
  "0": "rgba(66,72,82,0.16)",
  "1": "rgba(210,70,70,0.72)",
  "2": "rgba(94,68,28,0.18)",
  "3": "rgba(98,82,28,0.18)",
  "4": "rgba(24,72,78,0.18)",
  "5": "rgba(26,58,98,0.18)",
  "6": "rgba(210,70,70,0.72)",
  "7": "rgba(18,82,60,0.18)",
  "8": "rgba(78,46,54,0.18)",
  "9": "rgba(210,70,70,0.72)",
};

const CROSS_KEYS = ["C", "H", "M", "R", "W", "1", "6", "9", "P", "Q", "S", "T"];
const isCrossKey = (k: string) => CROSS_KEYS.includes(k);

const TOP_LEFT_KEYS = ["A", "B", "F", "G", "K", "L"];
const TOP_RIGHT_KEYS = ["D", "E", "I", "J", "N", "O"];
const BOTTOM_LEFT_KEYS = ["U", "V", "Z", "0", "4", "5"];
const BOTTOM_RIGHT_KEYS = ["Y", "2", "3", "7", "8"];

function getKeyTone(k: string) {
  if (CROSS_KEYS.includes(k)) return "cross";
  if (TOP_LEFT_KEYS.includes(k)) return "topLeft";
  if (TOP_RIGHT_KEYS.includes(k)) return "topRight";
  if (BOTTOM_LEFT_KEYS.includes(k)) return "bottomLeft";
  if (BOTTOM_RIGHT_KEYS.includes(k)) return "bottomRight";
  return "normal";
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function buildHeaders() {
  const auth = getSessionSync();
  const authAny = auth as any;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (auth?.userId) headers["x-kristo-user-id"] = auth.userId;
  if (auth?.role) headers["x-kristo-role"] = auth.role;
  if (auth?.churchId) headers["x-kristo-church-id"] = auth.churchId;
  if (authAny?.fullName || authAny?.displayName || authAny?.name) {
    headers["x-kristo-user-name"] =
      String(authAny.fullName || authAny.displayName || authAny.name || "").trim();
  }

  return headers;
}

function apiBase() {
  return String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
}
async function fetchMyWaySettings(): Promise<{
  ownerUserId: string | null;
  agentCommand: string;
  agentCommands: string[];
  commandCount: number;
  keyVisibility: KeyVisibility;
}> {
  const data = await fetchSharedMyWaySettings();
  return {
    ownerUserId: data.ownerUserId,
    agentCommand: data.agentCommand,
    agentCommands: (data.agentCommands || [data.agentCommand || DEFAULT_AGENT_COMMAND]).slice(0, 3),
    commandCount: Math.max(
      1,
      Math.min(3, Number(data.commandCount || data.agentCommands?.length || 1))
    ),
    keyVisibility: {
      ...makeDefaultVisibility(),
      ...(data.keyVisibility || {}),
    },
  };
}
async function getOrCreateDeviceId() {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_DEVICE_ID);
    if (existing) return existing;
    const next = makeId("dev");
    await AsyncStorage.setItem(STORAGE_DEVICE_ID, next);
    return next;
  } catch {
    return makeId("dev");
  }
}

async function loadSecurity(): Promise<MyWaySecurity> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_SECURITY);
    if (!raw) {
      return {
        ownerUserId: null,
        secretCode: DEFAULT_SECRET,
        trustedDeviceId: null,
        pendingAttempt: null,
        rotationRequired: false,
      };
    }
    const parsed = JSON.parse(raw || "{}");
    return {
      ownerUserId: parsed?.ownerUserId ? String(parsed.ownerUserId) : null,
      secretCode: String(parsed?.secretCode || DEFAULT_SECRET),
      trustedDeviceId: parsed?.trustedDeviceId ? String(parsed.trustedDeviceId) : null,
      pendingAttempt: parsed?.pendingAttempt
        ? {
            userId: String(parsed.pendingAttempt.userId || ""),
            deviceId: String(parsed.pendingAttempt.deviceId || ""),
            at: String(parsed.pendingAttempt.at || ""),
          }
        : null,
      rotationRequired: !!parsed?.rotationRequired,
    };
  } catch {
    return {
      ownerUserId: null,
      secretCode: DEFAULT_SECRET,
      trustedDeviceId: null,
      pendingAttempt: null,
      rotationRequired: false,
    };
  }
}

async function saveSecurity(next: MyWaySecurity) {
  try {
    await AsyncStorage.setItem(STORAGE_SECURITY, JSON.stringify(next));
  } catch {}
}

async function loadAgentSettings() {
  return await fetchMyWaySettings();
}

async function loadAgentCommand() {
  const data = await fetchMyWaySettings();
  return data.agentCommand;
}

async function loadKeyVisibility(): Promise<KeyVisibility> {
  const data = await fetchMyWaySettings();
  return data.keyVisibility;
}



const COMMAND_MAP: Record<string, { key: "A" | "MYWAY"; title: string; desc: string }> = {
  A: {
    key: "A",
    title: "KINGDOM",
    desc: "Private access for owner tools, direction, and internal help.",
  },
  MYWAY: {
    key: "MYWAY",
    title: "MY WAY Core",
    desc: "Main private dashboard and owner control center.",
  },
};

const DEV_ROLE_COMMANDS = {} as const;


export default function TLMCScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useKristoSession();

  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [security, setSecurity] = useState<MyWaySecurity>({
    ownerUserId: null,
    secretCode: DEFAULT_SECRET,
    trustedDeviceId: null,
    pendingAttempt: null,
    rotationRequired: false,
  });

  const [cmd, setCmd] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [padMode, setPadMode] = useState<PadMode>("unlock");
  const [oldVerified, setOldVerified] = useState(false);
  const [openedCommand, setOpenedCommand] = useState<QuickCommand>(null);
  const [agentCommand, setAgentCommand] = useState(DEFAULT_AGENT_COMMAND);
  const [agentCommands, setAgentCommands] = useState<string[]>([DEFAULT_AGENT_COMMAND]);
  const [commandCount, setCommandCount] = useState(1);
  const [unlockStep, setUnlockStep] = useState(0);
  const [keyVisibility, setKeyVisibility] = useState<KeyVisibility>(makeDefaultVisibility());
  const [officeTab, setOfficeTab] = useState<OfficeTab>("overview");
  const [runningCommand, setRunningCommand] = useState(false);
  const myWayInputLogRef = useRef("");

  const currentUserId = useMemo(() => {
    return String(session?.userId || "guest-user").trim() || "guest-user";
  }, [session?.userId]);

  const isOwner = !!security.ownerUserId && security.ownerUserId === currentUserId;
  const pendingAttempt = security.pendingAttempt;
  const canUseQuickCommand =
    !!security.ownerUserId &&
    security.ownerUserId == currentUserId;

  const activeUnlockCommands = useMemo(() => {
    const base = Array.isArray(agentCommands) && agentCommands.length ? agentCommands : [agentCommand || DEFAULT_AGENT_COMMAND];
    return base.slice(0, Math.max(1, Math.min(4, commandCount)));
  }, [agentCommands, agentCommand, commandCount]);

  const visibleKeyRows = useMemo(() => {
    const forced = new Set(
      activeUnlockCommands
        .join("")
        .trim()
        .toUpperCase()
        .split("")
        .filter((k) => /^[A-Z0-9]$/.test(k))
    );

    return BASE_KEY_ROWS
      .map((row) =>
        row.filter((k) => forced.has(k) || keyVisibility[k] !== false)
      )
      .filter((row) => row.length > 0);
  }, [activeUnlockCommands, keyVisibility]);

  const masked = cmd ? cmd.replace(/./g, "•") : "";

  const requiredCommandLength = useMemo(() => {
    if (padMode === "changeOld" || padMode === "changeNew") {
      return Math.max(1, String(security.secretCode || DEFAULT_SECRET).trim().length);
    }
    const commands =
      activeUnlockCommands.length > 0
        ? activeUnlockCommands
        : [agentCommand || DEFAULT_AGENT_COMMAND];
    const current = String(commands[unlockStep] || commands[0] || DEFAULT_AGENT_COMMAND).trim();
    return Math.max(1, current.length);
  }, [padMode, security.secretCode, activeUnlockCommands, unlockStep, agentCommand]);

  const isMyWayUnlockPad = padMode === "unlock";
  const isRunReady = isMyWayUnlockPad
    ? cmd.trim().length === MY_WAY_COMMAND_LENGTH
    : cmd.trim().length >= requiredCommandLength;

  const crossGlow = useRef(new Animated.Value(0.82)).current;
  const crossScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    void preloadTlmcAssets();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void preloadTlmcAssets();
    }, [])
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      const [d, sec, settings] = await Promise.all([
        getOrCreateDeviceId(),
        loadSecurity(),
        loadAgentSettings(),
      ]);
      if (!alive) return;

      let nextSec = sec;
      if (!nextSec.ownerUserId && settings.ownerUserId) {
        nextSec = {
          ...nextSec,
          ownerUserId: settings.ownerUserId,
        };
        await saveSecurity(nextSec);
      }

      setDeviceId(d);
      setSecurity(nextSec);
      setAgentCommand(settings.agentCommand);
      setAgentCommands(settings.agentCommands || [settings.agentCommand || DEFAULT_AGENT_COMMAND]);
      setCommandCount(settings.commandCount || 1);
      setKeyVisibility(settings.keyVisibility);
      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;

      (async () => {
        const [sec, settings] = await Promise.all([
          loadSecurity(),
          loadAgentSettings(),
        ]);
        if (!alive) return;

        let nextSec = sec;
        if (!nextSec.ownerUserId && settings.ownerUserId) {
          nextSec = {
            ...nextSec,
            ownerUserId: settings.ownerUserId,
          };
          await saveSecurity(nextSec);
        }

        setSecurity(nextSec);
        setAgentCommand(settings.agentCommand);
        setAgentCommands(settings.agentCommands || [settings.agentCommand || DEFAULT_AGENT_COMMAND]);
        setCommandCount(settings.commandCount || 1);
        setKeyVisibility(settings.keyVisibility);
      })();

      return () => {
        alive = false;
      };
    }, [])
  );

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(crossGlow, {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(crossGlow, {
            toValue: 0.82,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
        Animated.sequence([
          Animated.timing(crossScale, {
            toValue: 1.035,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(crossScale, {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [crossGlow, crossScale]);

  function resetPadState(nextMode: PadMode = "unlock") {
    setPadMode(nextMode);
    setCmd("");
    setErr(null);
    setUnlockStep(0);
Vibration.vibrate(120);
    if (nextMode !== "changeNew") setOldVerified(false);
  }

  const appendKey = (ch: string) => {
    setErr(null);
Vibration.vibrate(120);
    const maxLen = padMode === "unlock" ? MY_WAY_COMMAND_LENGTH : 16;
    setCmd((p) => (p + ch).slice(0, maxLen));
  };

  const backspace = () => {
    setErr(null);
Vibration.vibrate(120);
    setCmd((p) => p.slice(0, -1));
  };

  const clearCmd = () => {
    setErr(null);
Vibration.vibrate(120);
    setCmd("");
  };

  async function applySecurity(next: MyWaySecurity) {
    setSecurity(next);
    await saveSecurity(next);
  }

  async function submitUnlock() {
    const raw = String(cmd || "").trim();
    const v = raw.toUpperCase();

    if (!v) {
      setErr("Ingiza command code kwanza.");
      Vibration.vibrate(120);
      return;
    }

    if (raw.toLowerCase() === "help") {
      setErr('Tumia secret code yako. Mfano wa mwanzo: "SEHEMUYANGU".');
      Vibration.vibrate(120);
      return;
    }

    if (raw.toLowerCase() === "vault") {
      setErr("Imefungwa. Ingiza command code.");
      Vibration.vibrate(120);
      return;
    }

    const requiredCommands =
      activeUnlockCommands && activeUnlockCommands.length
        ? activeUnlockCommands
        : [agentCommand || DEFAULT_AGENT_COMMAND];

    const currentRequired = String(
      requiredCommands[unlockStep] || requiredCommands[0] || DEFAULT_AGENT_COMMAND
    )
      .trim()
      .toUpperCase();

    // BUILD MODE:
    // Kwa sasa yeyote anayejua command ya Kingdom anaweza kuingia.
    if (v === currentRequired) {
      const nextStep = unlockStep + 1;

      if (nextStep >= requiredCommands.length) {
        setUnlocked(false);
        setGuestMode(false);
        setOpenedCommand("A");
        setShowPad(false);
        setCmd("");
        setErr(null);
        setUnlockStep(0);
        Vibration.vibrate(120);
        router.push("/more/kingdom" as any);
        return;
      }

      setCmd("");
      setUnlockStep(nextStep);
      setErr(`Sawa. Sasa weka command ${nextStep + 1} ya ${requiredCommands.length}.`);
      Vibration.vibrate(120);
      return;
    }

    if (
      COMMAND_MAP[v] &&
      requiredCommands.length === 1 &&
      v === String(agentCommand || DEFAULT_AGENT_COMMAND).trim().toUpperCase()
    ) {
      setUnlocked(false);
      setGuestMode(false);
      setOpenedCommand(COMMAND_MAP[v].key);
      setShowPad(false);
      setCmd("");
      setErr(null);
      setUnlockStep(0);
      Vibration.vibrate(120);
      router.push("/more/kingdom" as any);
      return;
    }

    if (v !== String(security.secretCode || DEFAULT_SECRET).toUpperCase()) {
      setErr("Command code si sahihi.");
      Vibration.vibrate(120);
      return;
    }

    if (!security.ownerUserId) {
      const next: MyWaySecurity = {
        ...security,
        ownerUserId: currentUserId,
        trustedDeviceId: deviceId,
        pendingAttempt: null,
        rotationRequired: false,
      };
      await applySecurity(next);
      setUnlocked(true);
      setGuestMode(false);
      setOpenedCommand("MYWAY");
      setShowPad(false);
      setCmd("");
      setErr(null);
      setUnlockStep(0);
      Vibration.vibrate(120);
      return;
    }

    if (security.ownerUserId === currentUserId) {
      if (!security.trustedDeviceId || security.trustedDeviceId === deviceId) {
        const next: MyWaySecurity = {
          ...security,
          trustedDeviceId: security.trustedDeviceId || deviceId,
        };
        await applySecurity(next);
        setUnlocked(true);
        setGuestMode(false);
        setOpenedCommand("MYWAY");
        setShowPad(false);
        setCmd("");
        setErr(null);
        setUnlockStep(0);
        Vibration.vibrate(120);
        return;
      }

      setErr("Device hii bado haija-trustiwa kwa owner.");
      Vibration.vibrate(120);
      return;
    }

    const next: MyWaySecurity = {
      ...security,
      pendingAttempt: {
        userId: currentUserId,
        deviceId,
        at: new Date().toISOString(),
      },
    };
    await applySecurity(next);
    setUnlocked(false);
    setGuestMode(true);
    setShowPad(false);
    setCmd("");
    setErr(null);
    setUnlockStep(0);
    Vibration.vibrate(120);
  }

  async function submitChangeOld() {
    const v = String(cmd || "").trim().toUpperCase();
    if (!isOwner) {
      setErr("Owner tu anaweza kubadilisha secret code.");
Vibration.vibrate(120);
      return;
    }
    if (v !== String(security.secretCode || DEFAULT_SECRET).toUpperCase()) {
      setErr("Old secret code si sahihi.");
Vibration.vibrate(120);
      return;
    }
    setOldVerified(true);
    setCmd("");
    setErr("Sasa ingiza NEW secret code.");
Vibration.vibrate(120);
    setPadMode("changeNew");
  }

  async function submitChangeNew() {
    const v = String(cmd || "").trim().toUpperCase();

    if (!isOwner) {
      setErr("Owner tu anaweza kubadilisha secret code.");
Vibration.vibrate(120);
      return;
    }
    if (!oldVerified) {
      setErr("Thibitisha old code kwanza.");
Vibration.vibrate(120);
      return;
    }
    if (v.length < 6) {
      setErr("New secret code iwe angalau herufi/number 6.");
Vibration.vibrate(120);
      return;
    }
    if (v === String(security.secretCode || DEFAULT_SECRET).toUpperCase()) {
      setErr("Tumia code mpya tofauti.");
Vibration.vibrate(120);
      return;
    }

    const next: MyWaySecurity = {
      ...security,
      secretCode: v,
      rotationRequired: false,
      pendingAttempt: null,
      trustedDeviceId: deviceId,
    };
    await applySecurity(next);

    setUnlocked(true);
    setGuestMode(false);
    setShowPad(false);
    setPadMode("unlock");
    setOldVerified(false);
    setCmd("");
    setErr(null);
Vibration.vibrate(120);
  }

  async function submit() {
    if (padMode === "changeOld") {
      await submitChangeOld();
      return;
    }

    if (padMode === "changeNew") {
      await submitChangeNew();
      return;
    }

    await submitUnlock();
  }

  async function handleTrustAttempt() {
    if (!isOwner || !pendingAttempt) return;
    const next: MyWaySecurity = {
      ...security,
      trustedDeviceId: pendingAttempt.deviceId,
      pendingAttempt: null,
    };
    await applySecurity(next);
  }

  async function handleDenyAttempt() {
    if (!isOwner || !pendingAttempt) return;
    const next: MyWaySecurity = {
      ...security,
      pendingAttempt: null,
      rotationRequired: true,
    };
    await applySecurity(next);
    setUnlocked(false);
    setGuestMode(false);
    setOpenedCommand(null);
  }

  function openUnlockPad() {
    console.log("KRISTO_MY_WAY_OPEN", {
      userId: currentUserId,
      padMode: "unlock",
    });
    setUnlocked(false);
    setGuestMode(false);
    setOpenedCommand(null);
    setShowPad(true);
    resetPadState("unlock");
  }

  function openChangeCodePad() {
    setShowPad(true);
    setUnlocked(false);
    setGuestMode(false);
    resetPadState("changeOld");
  }

  useEffect(() => {
    if (!showPad || padMode !== "unlock") return;
    const sig = `${cmd.length}|${cmd}`;
    if (myWayInputLogRef.current === sig) return;
    myWayInputLogRef.current = sig;
    console.log("KRISTO_MY_WAY_COMMAND_INPUT", {
      length: cmd.length,
      ready: cmd.length === MY_WAY_COMMAND_LENGTH,
      userId: currentUserId,
    });
  }, [cmd, showPad, padMode, currentUserId]);

  async function handleRunMyWayCommand() {
    if (!isRunReady || runningCommand) return;

    const code = normalizeMyWayCommandCode(cmd);
    if (code.length !== MY_WAY_COMMAND_LENGTH) {
      setErr("Enter a 6-character command code.");
      Vibration.vibrate(120);
      return;
    }

    console.log("KRISTO_MY_WAY_COMMAND_RUN", {
      code,
      length: code.length,
      userId: currentUserId,
    });

    setRunningCommand(true);
    setErr(null);

    try {
      const resolved = await resolveMyWayCommand(code);

      if (!resolved || resolved.action !== "navigate" || !resolved.route) {
        console.log("KRISTO_MY_WAY_COMMAND_NOT_FOUND", {
          code,
          userId: currentUserId,
        });
        setErr("Command not found. Check the code and try again.");
        Vibration.vibrate(120);
        return;
      }

      console.log("KRISTO_MY_WAY_COMMAND_RESOLVED", {
        code,
        title: resolved.title,
        route: resolved.route,
        source: resolved.source,
        userId: currentUserId,
      });

      setShowPad(false);
      setCmd("");
      setErr(null);
      setUnlockStep(0);
      Vibration.vibrate(120);

      console.log("KRISTO_MY_WAY_NAVIGATION", {
        code,
        route: resolved.route,
        title: resolved.title,
        userId: currentUserId,
      });

      router.push(resolved.route as any);
    } catch (error) {
      setErr("Command not found. Check the code and try again.");
      Vibration.vibrate(120);
      console.log("KRISTO_MY_WAY_COMMAND_NOT_FOUND", {
        code,
        userId: currentUserId,
        error: String((error as Error)?.message || error || "unknown"),
      });
    } finally {
      setRunningCommand(false);
    }
  }

  if (!ready) {
    return (
      <View style={s.screen}>
        <ImageBackground source={TLMC_UNIVERSE_IMAGE} style={s.universeBg} resizeMode="cover" />
        <View style={[s.loadingWrap, { paddingTop: insets.top + 10 }]}>
          <Text style={{ color: "white", fontWeight: "800" }}>Loading MY WAY...</Text>
        </View>
      </View>
    );
  }

  const ownerLabel = security.ownerUserId || "Hakuna owner bado";
  const padTitle =
    padMode === "changeOld" ? "OLD CODE" : padMode === "changeNew" ? "NEW CODE" : "KARIBU";

  const padHint =
    padMode === "changeOld"
      ? "Thibitisha code ya zamani"
      : padMode === "changeNew"
      ? "Weka code mpya ya siri"
      : commandCount > 1
      ? `Ingiza command ${unlockStep + 1} ya ${commandCount}`
      : "Ingiza command code";

  const officeSummary = [
    { key: "overview", label: "Overview", icon: "grid-outline" as const },
    { key: "security", label: "Security", icon: "shield-checkmark-outline" as const },
    { key: "access", label: "Access", icon: "key-outline" as const },
    { key: "commands", label: "Commands", icon: "flash-outline" as const },
  ];

  return (
    <View style={s.screen}>
      <ImageBackground source={TLMC_UNIVERSE_IMAGE} style={s.universeBg} resizeMode="cover" />

      {!showPad ? (
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <Text style={t.title}>TLMC</Text>
          <Text style={t.sub}>The Last Mission of Christ</Text>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          padding: showPad ? 10 : PAD,
          paddingTop: showPad ? Math.max(insets.top, 4) : PAD,
          paddingBottom: insets.bottom + (showPad ? 24 : 28),
          justifyContent: showPad ? "flex-start" : "center",
        }}
      >
        <View
          style={[
            s.card,
            s.cardGold,
            showPad
              ? {
                  flex: 1,
                  minHeight: 0,
                  borderRadius: 28,
                  padding: 10,
                }
              : null,
          ]}
        >
          {!showPad ? (
            <Pressable
              onPress={openUnlockPad}
              style={({ pressed }) => [
                s.heroCta,
                pressed ? { opacity: 0.92, transform: [{ scale: 0.992 }] } : null,
              ]}
            >
              <View pointerEvents="none" style={s.heroCtaLeftGlow} />
              <View pointerEvents="none" style={s.heroCtaCenterGlow} />
              <View pointerEvents="none" style={s.heroCtaRightGlow} />
              <View pointerEvents="none" style={s.heroCtaTopShine} />
              <View pointerEvents="none" style={s.heroCtaBottomShade} />
              <View pointerEvents="none" style={s.heroCtaInnerRing} />
              <View pointerEvents="none" style={s.heroCtaCenterGloss} />
              <Ionicons name="sparkles" size={17} color="rgba(96,56,14,0.94)" />
              <Text style={t.heroCtaText}>MY WAY</Text>
              <Ionicons name="chevron-forward" size={18} color="rgba(96,56,14,0.94)" />
            </Pressable>
          ) : null}

          {showPad ? (
            <View style={s.padWrap}>
              <View style={s.padTopRow}>
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingLeft: 8 }}>
                  <Text style={t.padTitle}>{padTitle}</Text>
                  <Text style={t.padHint}>{padHint}</Text>
                </View>

                <Pressable
                  onPress={() => {
                    setShowPad(false);
                    resetPadState("unlock");
                  }}
                  style={({ pressed }) => [s.padClose, pressed ? { opacity: 0.9 } : null]}
                  hitSlop={10}
                >
                  <Ionicons name="close" size={18} color="rgba(255,255,255,0.88)" />
                </Pressable>
              </View>

              <View style={s.padDisplay}>
                <Text style={t.padDisplayText}>{masked || "••••••"}</Text>
              </View>

              {err ? <Text style={t.err}>{err}</Text> : null}

              <View style={s.padGrid}>
                {visibleKeyRows.map((row, rowIndex) => (
                  <View key={`row-${rowIndex}`} style={[s.padRow, row.length === 1 ? s.padRowCenter : null]}>
                    {row.map((k) => {
                      const cross = isCrossKey(k);
                      const tone = getKeyTone(k);

                      return (
                        <Animated.View
                          key={k}
                          style={[
                            s.padKeyWrap,
                            row.length === 1 ? s.padKeySolo : null,
                            cross
                              ? {
                                  opacity: crossGlow,
                                  transform: [{ scale: crossScale }],
                                }
                              : null,
                          ]}
                        >
                          <Pressable
                            onPress={() => appendKey(k)}
                            style={({ pressed }) => [
                              s.padKey,
                              cross ? s.padKeyCross : null,
                              tone === "topLeft" ? s.padKeyTopLeft : null,
                              tone === "topRight" ? s.padKeyTopRight : null,
                              tone === "bottomLeft" ? s.padKeyBottomLeft : null,
                              tone === "bottomRight" ? s.padKeyBottomRight : null,
                              {
                                backgroundColor: cross
                                  ? CROSS_COLOR
                                  : KEY_COLORS[k] || "rgba(255,255,255,0.06)",
                              },
                              pressed ? { opacity: 0.92, transform: [{ scale: 0.985 }] } : null,
                            ]}
                          >
                            {cross ? <View pointerEvents="none" style={s.crossKeyGlow} /> : null}
                            {cross ? <View pointerEvents="none" style={s.crossKeyShine} /> : null}
                            {cross ? <View pointerEvents="none" style={s.crossKeyGoldRing} /> : null}
                            {tone === "topLeft" ? <View pointerEvents="none" style={s.cornerGlowTopLeft} /> : null}
                            {tone === "topRight" ? <View pointerEvents="none" style={s.cornerGlowTopRight} /> : null}
                            {tone === "bottomLeft" ? <View pointerEvents="none" style={s.cornerGlowBottomLeft} /> : null}
                            {tone === "bottomRight" ? <View pointerEvents="none" style={s.cornerGlowBottomRight} /> : null}
                            <Text style={[t.padKeyText, cross ? t.padKeyCrossText : null]}>{k}</Text>
                          </Pressable>
                        </Animated.View>
                      );
                    })}
                  </View>
                ))}
              </View>

              <View style={[s.padRunFooter, { marginBottom: Math.max(6, insets.bottom > 0 ? 4 : 8) }]}>
                <Pressable
                  onPress={handleRunMyWayCommand}
                  disabled={!isRunReady || runningCommand}
                  style={({ pressed }) => [
                    s.padRunCenterBtn,
                    !isRunReady ? s.padRunCenterBtnDisabled : null,
                    isRunReady && pressed ? { opacity: 0.92, transform: [{ scale: 0.985 }] } : null,
                  ]}
                  hitSlop={8}
                >
                  <View pointerEvents="none" style={s.padRunCenterGlow} />
                  <View pointerEvents="none" style={s.padRunCenterShine} />
                  <Text style={[t.padRunCenterText, !isRunReady ? t.padRunCenterTextDisabled : null]}>
                    ⚡ Run
                  </Text>
                </Pressable>
              </View>

              {SHOW_TLMC_COMMAND_PAD_ACTIONS ? (
              <View style={s.padActions}>
                <Pressable
                  onPress={backspace}
                  style={({ pressed }) => [
                    s.padActionBtn,
                    s.padBackBtn,
                    pressed ? { opacity: 0.9, transform: [{ scale: 0.992 }] } : null,
                  ]}
                >
                  <Ionicons name="backspace" size={18} color="rgba(255,255,255,0.65)" />
                  <Text style={t.padActionText}>Back</Text>
                </Pressable>

                <Pressable
                  onPress={clearCmd}
                  style={({ pressed }) => [
                    s.padActionBtn,
                    s.padClearBtn,
                    pressed ? { opacity: 0.9, transform: [{ scale: 0.992 }] } : null,
                  ]}
                >
                  <Ionicons name="trash" size={18} color="rgba(255,255,255,0.65)" />
                  <Text style={t.padActionText}>Clear</Text>
                </Pressable>

                <Pressable
                  onPress={submit}
                  style={({ pressed }) => [
                    s.padActionBtn,
                    s.padRunBtn,
                    pressed ? { opacity: 0.92, transform: [{ scale: 0.992 }] } : null,
                  ]}
                >
                  <Ionicons name="flash" size={18} color={GOLD} />
                  <Text style={t.padRunText}>
                    {padMode === "changeNew" ? "Save" : padMode === "changeOld" ? "Next" : "Run"}
                  </Text>
                </Pressable>
              </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {pendingAttempt && isOwner && !showPad ? (
          <View style={[s.card, s.cardBlue, { marginTop: 14 }]}>
            <Text style={t.sectionTitle}>Tahadhari ya kuingia</Text>
            <Text style={t.metaText}>User: {pendingAttempt.userId}</Text>
            <Text style={t.metaText}>Device: {pendingAttempt.deviceId}</Text>
            <Text style={t.metaText}>Time: {pendingAttempt.at}</Text>

            <View style={s.alertActions}>
              <Pressable onPress={handleTrustAttempt} style={s.alertBtnBlue}>
                <Text style={t.alertBtnText}>Na-trust</Text>
              </Pressable>
              <Pressable onPress={handleDenyAttempt} style={s.alertBtnRed}>
                <Text style={t.alertBtnText}>Si yangu</Text>
              </Pressable>
            </View>

            <Text style={t.smallHint}>
              Ukichagua "Si yangu", system itakulazimisha ubadilishe secret code.
            </Text>
          </View>
        ) : null}

        {guestMode && !showPad ? (
          <View style={[s.card, { marginTop: 14, borderColor: "rgba(255,170,170,0.22)" }]}>
            <Text style={t.sectionTitle}>Guest Mode</Text>
            <Text style={t.metaText}>
              Hii MY WAY inadhibitiwa na owner mmoja tu. Wewe umeingia kama mgeni.
            </Text>
            <Text style={t.metaText}>
              Jaribio lako limehifadhiwa ili owner alipitie na kuamua kama ana-trust au la.
            </Text>
          </View>
        ) : null}

        {unlocked && isOwner && !showPad ? (
          <View style={[s.card, s.cardBlue, { marginTop: 14 }]}>
            <View style={s.tlmcDashTop}>
              <View style={s.tlmcDashBadge}>
                <Ionicons name="business" size={18} color={BG} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={t.cardTitle}>MY WAY Office</Text>
                <Text style={t.tlmcDashSub}>Control center • owner only • security • command planning</Text>
              </View>

              <Pressable
                onPress={() => {
                  setUnlocked(false);
                  setShowPad(false);
                  setErr(null);
Vibration.vibrate(120);
                  setCmd("");
                }}
                style={({ pressed }) => [s.btnGhost, pressed ? { opacity: 0.9 } : null]}
              >
                <Text style={t.btnGhostText}>Lock</Text>
              </Pressable>
            </View>

            <View style={s.officeHero}>
              <View style={s.officeHeroItem}>
                <Text style={t.officeHeroLabel}>Main command</Text>
                <Text style={t.officeHeroValue}>{agentCommand}</Text>
              </View>

              <View style={s.officeHeroDivider} />

              <View style={s.officeHeroItem}>
                <Text style={t.officeHeroLabel}>Command count</Text>
                <Text style={t.officeHeroValue}>{commandCount}</Text>
              </View>

              <View style={s.officeHeroDivider} />

              <View style={s.officeHeroItem}>
                <Text style={t.officeHeroLabel}>Sequence</Text>
                <Text style={t.officeHeroValueSmall}>{activeUnlockCommands.join(" • ")}</Text>
              </View>
            </View>

            <View style={s.officeTabs}>
              {officeSummary.map((item) => {
                const active = officeTab === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setOfficeTab(item.key as OfficeTab)}
                    style={({ pressed }) => [
                      s.officeTabBtn,
                      active ? s.officeTabBtnActive : null,
                      pressed ? { opacity: 0.92, transform: [{ scale: 0.99 }] } : null,
                    ]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={16}
                      color={active ? BG : "rgba(255,255,255,0.78)"}
                    />
                    <Text style={[t.officeTabText, active ? t.officeTabTextActive : null]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={s.tlmcSection}>
              <View style={s.tlmcSectionHead}>
                <Text style={t.tlmcSectionTitle}>
                  {officeTab === "overview"
                    ? "Office Overview"
                    : officeTab === "security"
                    ? "Security Room"
                    : officeTab === "access"
                    ? "Access Room"
                    : "Commands Room"}
                </Text>
                <Text style={t.tlmcSectionHint}>Pangilio la control</Text>
              </View>

              {officeTab === "overview" ? (
                <View style={s.officeGrid}>
                  <View style={[s.officeCard, s.officeCardGold]}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Security</Text>
                      <View style={s.codePillGold}>
                        <Text style={t.codePillText}>SAFE</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValue}>{security.secretCode}</Text>
                    <Text style={t.officeMeta}>Secret code ya office yako</Text>
                  </View>

                  <View style={[s.officeCard, s.officeCardBlue]}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Access</Text>
                      <View style={s.codePillBlue}>
                        <Text style={t.codePillText}>TRUST</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValueSmall}>{security.trustedDeviceId || "No device"}</Text>
                    <Text style={t.officeMeta}>Device iliyopewa ruhusa</Text>
                  </View>

                  <View style={[s.officeCard, s.officeCardRed]}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Owner</Text>
                      <View style={s.codePillRed}>
                        <Text style={t.codePillText}>ONLY</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValueSmall}>{ownerLabel}</Text>
                    <Text style={t.officeMeta}>Mmiliki wa office hii</Text>
                  </View>

                  <View style={s.officeCard}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Commands</Text>
                      <View style={s.officePillDark}>
                        <Text style={t.officePillText}>FLOW</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValue}>{activeUnlockCommands.join(" → ")}</Text>
                    <Text style={t.officeMeta}>Mpangilio wa kuingia</Text>
                  </View>
                </View>
              ) : null}

              {officeTab === "security" ? (
                <View style={s.officeGrid}>
                  <Pressable
                    onPress={openChangeCodePad}
                    style={({ pressed }) => [
                      s.changeCodeBtn,
                      pressed ? { opacity: 0.92, transform: [{ scale: 0.995 }] } : null,
                    ]}
                  >
                    <Ionicons name="key-outline" size={18} color={BG} />
                    <Text style={t.changeCodeBtnText}>Badili Secret Code</Text>
                  </Pressable>

                  <View style={[s.officeCard, s.officeCardGold]}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Current Secret</Text>
                      <View style={s.codePillGold}>
                        <Text style={t.codePillText}>ACTIVE</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValue}>{security.secretCode}</Text>
                    <Text style={t.officeMeta}>Hii ndiyo code kuu ya office yako</Text>
                    <View style={s.officeMetaRow}>
                      <Text style={t.officeMetaLabel}>Owner</Text>
                      <Text style={t.officeMetaValue}>{ownerLabel}</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {officeTab === "access" ? (
                <View style={s.officeGrid}>
                  <View style={[s.officeCard, s.officeCardBlue]}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Trusted Device</Text>
                      <View style={s.codePillBlue}>
                        <Text style={t.codePillText}>DEVICE</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValueSmall}>{security.trustedDeviceId || "No"}</Text>
                    <Text style={t.officeMeta}>Device inayoruhusiwa kwa owner</Text>
                  </View>

                  <View style={[s.officeCard, s.officeCardRed]}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Current Owner</Text>
                      <View style={s.codePillRed}>
                        <Text style={t.codePillText}>OWNER</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValueSmall}>{currentUserId}</Text>
                    <Text style={t.officeMeta}>Only this owner can unlock MY WAY</Text>
                  </View>
                </View>
              ) : null}

              {officeTab === "commands" ? (
                <View style={s.officeGrid}>
                  <View style={s.officeCard}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Main Command</Text>
                      <View style={s.officePillDark}>
                        <Text style={t.officePillText}>MAIN</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValue}>{agentCommand}</Text>
                    <Text style={t.officeMeta}>Command kuu ya mfumo</Text>
                  </View>

                  <View style={s.officeCard}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Command Count</Text>
                      <View style={s.officePillDark}>
                        <Text style={t.officePillText}>COUNT</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValue}>{commandCount}</Text>
                    <Text style={t.officeMeta}>System inaweza kutumia 1 hadi 3 command</Text>
                  </View>

                  <View style={s.officeCard}>
                    <View style={s.officeCardTop}>
                      <Text style={t.officeCardTitle}>Run Order</Text>
                      <View style={s.officePillDark}>
                        <Text style={t.officePillText}>ORDER</Text>
                      </View>
                    </View>
                    <Text style={t.officeCardValue}>{activeUnlockCommands.join(" → ")}</Text>
                    <Text style={t.officeMeta}>Huu ndio mpangilio wa kufungua</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {unlocked && isOwner && openedCommand && !showPad ? (
          <View style={[s.card, { marginTop: 14, borderColor: "rgba(217,179,95,0.22)" }]}>
            <Text style={t.sectionTitle}>
              Opened Command: {openedCommand === "A" ? agentCommand : openedCommand}
            </Text>
            <Text style={t.metaText}>{COMMAND_MAP[openedCommand].title}</Text>
            <Text style={t.metaText}>{COMMAND_MAP[openedCommand].desc}</Text>
            <Text style={t.smallHint}>
              {`Tumia ${agentCommand} kwa KINGDOM, au ingiza secret code kufungua MY WAY kuu.`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  keyBtnCross: {
    backgroundColor: "rgba(214,78,78,0.25)",
    borderColor: "rgba(214,78,78,0.8)",
    shadowColor: "rgba(214,78,78,0.9)",
  },

  keyBtnActive: {
    transform: [{ scale: 0.92 }],
    backgroundColor: "rgba(217,179,95,0.25)",
    borderColor: "rgba(217,179,95,0.8)",
  },

  universeBg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.58,
  } as any,

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  } as any,

  screen: { flex: 1, backgroundColor: BG } as any,

  header: {
    paddingHorizontal: PAD,
    paddingTop: 14,
    paddingBottom: 10,
  } as any,

  card: {
    borderRadius: 32,
    padding: 22,
    backgroundColor: "rgba(12,14,24,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  } as any,

  cardGold: {
    width: "86%",
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 26,
    borderColor: "rgba(170,45,55,0.10)",
    backgroundColor: "rgba(40,10,18,0.08)",
  } as any,

  cardBlue: {
    borderColor: "rgba(0,145,255,0.24)",
    backgroundColor: "rgba(0,145,255,0.10)",
  } as any,

  heroCtaLeftGlow: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "31%",
    backgroundColor: "rgba(176,116,46,0.74)",
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
  } as any,

  heroCtaCenterGlow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "23%",
    width: "52%",
    backgroundColor: "rgba(228,193,94,0.82)",
  } as any,

  heroCtaRightGlow: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: "25%",
    backgroundColor: "rgba(148,140,58,0.68)",
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
  } as any,

  heroCtaTopShine: {
    position: "absolute",
    top: 2,
    left: 18,
    right: 18,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,248,220,0.08)",
  } as any,

  heroCtaBottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 14,
    backgroundColor: "rgba(92,58,12,0.10)",
  } as any,

  heroCtaInnerRing: {
    position: "absolute",
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,232,170,0.10)",
  } as any,

  heroCtaCenterGloss: {
    position: "absolute",
    top: 12,
    bottom: 12,
    left: "40%",
    width: "10%",
    borderRadius: 14,
    backgroundColor: "rgba(255,245,210,0.02)",
  } as any,

  heroCta: {
    borderRadius: 24,
    minHeight: 68,
    paddingVertical: 17,
    paddingHorizontal: 24,
    backgroundColor: "rgba(220,182,86,0.97)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    borderWidth: 1,
    borderColor: "rgba(255,228,150,0.20)",
    overflow: "hidden",
  } as any,

  btnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.01)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as any,

  changeCodeBtn: {
    marginBottom: 12,
    minHeight: 50,
    borderRadius: 17,
    backgroundColor: "rgba(217,179,95,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,235,180,0.22)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
  } as any,

  tlmcDashTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  } as any,

  tlmcDashBadge: {
    width: 42,
    height: 42,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BLUE,
  } as any,

  tlmcSection: {
    marginTop: 16,
  } as any,

  tlmcSectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } as any,

  codesList: {
    gap: 10,
  } as any,

  codeCard: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 17,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as any,

  codeTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as any,

  codePillGold: {
    minWidth: 68,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
  } as any,

  codePillBlue: {
    minWidth: 68,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,145,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,145,255,0.26)",
  } as any,

  codePillRed: {
    minWidth: 68,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(214,78,78,0.14)",
    borderWidth: 1,
    borderColor: "rgba(214,78,78,0.26)",
  } as any,

  padWrap: {
    flex: 1,
    paddingTop: 0,
    justifyContent: "flex-start",
  } as any,

  padTopRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  } as any,

  padClose: {
    width: 30,
    height: 30,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as any,

  padDisplay: {
    marginTop: 4,
    minHeight: 46,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(10,12,20,0.24)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  } as any,

  padGrid: {
    marginTop: 6,
    gap: 3,
    alignSelf: "center",
    width: "100%",
    maxWidth: 320,
  } as any,

  padRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  } as any,

  padRowCenter: {
    justifyContent: "center",
  } as any,

  padKeyWrap: {
    width: 56,
    height: 56,
  } as any,

  padKeySolo: {
    width: 56,
    alignSelf: "center",
  } as any,

  padKey: {
    flex: 1,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  } as any,

  padKeyCross: {
    borderColor: "rgba(255,214,170,0.24)",
    shadowColor: "#D44E4E",
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  } as any,

  padKeyTopLeft: { borderColor: "rgba(160,120,255,0.16)" } as any,
  padKeyTopRight: { borderColor: "rgba(120,190,255,0.16)" } as any,
  padKeyBottomLeft: { borderColor: "rgba(140,120,255,0.14)" } as any,
  padKeyBottomRight: { borderColor: "rgba(255,210,120,0.14)" } as any,

  crossKeyGlow: {
    position: "absolute",
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 19,
    backgroundColor: "rgba(255,210,210,0.05)",
  } as any,

  crossKeyShine: {
    position: "absolute",
    top: 4,
    left: 8,
    right: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,240,220,0.14)",
  } as any,

  crossKeyGoldRing: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(255,220,170,0.22)",
  } as any,

  cornerGlowTopLeft: {
    position: "absolute",
    top: -14,
    left: -12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(182,122,255,0.14)",
  } as any,

  cornerGlowTopRight: {
    position: "absolute",
    top: -14,
    right: -12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(82,170,255,0.14)",
  } as any,

  cornerGlowBottomLeft: {
    position: "absolute",
    bottom: -14,
    left: -12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(122,100,255,0.12)",
  } as any,

  cornerGlowBottomRight: {
    position: "absolute",
    bottom: -14,
    right: -12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,196,102,0.12)",
  } as any,

  padActions: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as any,

  padActionBtn: {
    flex: 1,
    height: 62,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(12,16,24,0.55)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  } as any,

  padBackBtn: {
    backgroundColor: "rgba(18,22,30,0.46)",
    borderColor: "rgba(255,255,255,0.10)",
  } as any,

  padClearBtn: {
    backgroundColor: "rgba(18,22,30,0.46)",
    borderColor: "rgba(255,255,255,0.10)",
  } as any,

  padRunBtn: {
    flex: 1,
    height: 62,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(12,16,24,0.55)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  } as any,

  padRunFooter: {
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  } as any,

  padRunCenterBtn: {
    width: 160,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.52)",
    backgroundColor: "rgba(217,179,95,0.16)",
    shadowColor: "rgba(217,179,95,0.85)",
    shadowOpacity: 0.42,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  } as any,

  padRunCenterBtnDisabled: {
    opacity: 0.5,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.07)",
    shadowOpacity: 0.12,
  } as any,

  padRunCenterGlow: {
    position: "absolute",
    top: -8,
    left: 12,
    right: 12,
    height: 22,
    borderRadius: 999,
    backgroundColor: "rgba(255,232,170,0.18)",
  } as any,

  padRunCenterShine: {
    position: "absolute",
    top: 1,
    left: 10,
    right: 10,
    height: 1,
    borderRadius: 999,
    backgroundColor: "rgba(255,248,220,0.28)",
  } as any,

  comingSoonBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  } as any,

  comingSoonBackdropTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,8,14,0.42)",
  } as any,

  comingSoonCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    shadowColor: "rgba(217,179,95,0.55)",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  } as any,

  comingSoonCardGlow: {
    position: "absolute",
    top: -40,
    left: "18%",
    right: "18%",
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(217,179,95,0.14)",
  } as any,

  comingSoonCardGlass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(12,16,26,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  } as any,

  comingSoonContent: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: "center",
  } as any,

  comingSoonIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.10)",
    shadowColor: "rgba(217,179,95,0.65)",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  } as any,

  comingSoonOkBtn: {
    marginTop: 22,
    minWidth: 132,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
    backgroundColor: "rgba(217,179,95,0.18)",
    shadowColor: "rgba(217,179,95,0.55)",
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  } as any,

  comingSoonOkGlow: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,240,200,0.12)",
  } as any,

  alertActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  } as any,

  alertBtnBlue: {
    flex: 1,
    minHeight: 46,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,145,255,0.90)",
  } as any,

  alertBtnRed: {
    flex: 1,
    minHeight: 46,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,78,78,0.92)",
  } as any,

  officeHero: {
    marginTop: 16,
    marginBottom: 6,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as any,

  officeTabs: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  } as any,

  officeTabBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  } as any,

  officeTabBtnActive: {
    backgroundColor: "rgba(217,179,95,0.96)",
    borderColor: "rgba(255,235,180,0.24)",
  } as any,

  officeHeroItem: {
    flex: 1,
    minHeight: 56,
    justifyContent: "center",
    gap: 4,
  } as any,

  officeHeroDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.08)",
  } as any,

  officeGrid: {
    gap: 10,
  } as any,

  officeCard: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as any,

  officeCardGold: {
    backgroundColor: "rgba(217,179,95,0.08)",
    borderColor: "rgba(217,179,95,0.18)",
  } as any,

  officeCardBlue: {
    backgroundColor: "rgba(0,145,255,0.08)",
    borderColor: "rgba(0,145,255,0.18)",
  } as any,

  officeCardRed: {
    backgroundColor: "rgba(214,78,78,0.08)",
    borderColor: "rgba(214,78,78,0.18)",
  } as any,

  officeCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  } as any,

  officeMetaRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as any,

  officePillDark: {
    minWidth: 62,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as any,
});

const t = StyleSheet.create({
  title: {
    color: "white",
    fontSize: 31,
    fontWeight: "900",
    letterSpacing: 0.4,
  } as any,

  sub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.68)",
    fontWeight: "700",
    fontSize: 14,
  } as any,

  heroCtaText: {
    color: "rgba(96,56,14,0.96)",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1.1,
  } as any,

  padTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  } as any,

  padHint: {
    marginTop: 1,
    color: "rgba(255,255,255,0.74)",
    fontSize: 11,
    fontWeight: "700",
  } as any,

  padDisplayText: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2.6,
  } as any,

  err: {
    marginBottom: 8,
    textAlign: "center",
    color: "#FF8D8D",
    fontWeight: "900",
    fontSize: 13,
  } as any,

  padKeyText: {
    color: "white",
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 0.2,
  } as any,

  padKeyCrossText: {
    color: "rgba(255,248,246,0.98)",
  } as any,

  padActionText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  } as any,

  padRunText: {
    color: "rgba(217,179,95,0.96)",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.2,
  } as any,

  padRunSmallText: {
    color: "rgba(217,179,95,0.96)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  } as any,

  padRunCenterText: {
    color: "rgba(255,248,230,0.98)",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.6,
    textShadowColor: "rgba(217,179,95,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  } as any,

  padRunCenterTextDisabled: {
    color: "rgba(255,248,230,0.72)",
    textShadowRadius: 0,
  } as any,

  comingSoonTitle: {
    color: "rgba(255,255,255,0.98)",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.3,
    textAlign: "center",
  } as any,

  comingSoonBrand: {
    marginTop: 4,
    color: "rgba(217,179,95,0.88)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.4,
    textTransform: "uppercase",
    textAlign: "center",
  } as any,

  comingSoonMessage: {
    marginTop: 14,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
  } as any,

  comingSoonOkText: {
    color: "rgba(255,248,230,0.98)",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.4,
  } as any,

  sectionTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  } as any,

  metaText: {
    marginTop: 6,
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
  } as any,

  smallHint: {
    marginTop: 12,
    color: "rgba(255,255,255,0.56)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  } as any,

  alertBtnText: {
    color: "white",
    fontWeight: "900",
    fontSize: 14,
  } as any,

  cardTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
  } as any,

  tlmcDashSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.66)",
    fontSize: 12,
    fontWeight: "700",
  } as any,

  btnGhostText: {
    color: "white",
    fontWeight: "800",
  } as any,

  changeCodeBtnText: {
    color: BG,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 0.2,
  } as any,

  tlmcSectionTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
  } as any,

  tlmcSectionHint: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "700",
  } as any,

  codeValue: {
    flex: 1,
    color: "white",
    fontWeight: "900",
    fontSize: 16,
  } as any,

  codePillText: {
    color: "white",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.5,
  } as any,

  codePurpose: {
    marginTop: 6,
    color: "rgba(255,255,255,0.76)",
    fontWeight: "700",
    fontSize: 13,
  } as any,

  codeExpire: {
    marginTop: 4,
    color: "rgba(255,255,255,0.48)",
    fontWeight: "700",
    fontSize: 12,
  } as any,

  officeHeroLabel: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  } as any,

  officeHeroValue: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
  } as any,

  officeHeroValueSmall: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
  } as any,

  officeTabText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "800",
  } as any,

  officeTabTextActive: {
    color: BG,
  } as any,

  officeCardTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
  } as any,

  officeCardValue: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
  } as any,

  officeCardValueSmall: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  } as any,

  officeMeta: {
    marginTop: 6,
    color: "rgba(255,255,255,0.74)",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 19,
  } as any,

  officeMetaLabel: {
    color: "rgba(255,255,255,0.48)",
    fontWeight: "800",
    fontSize: 12,
  } as any,

  officeMetaValue: {
    flex: 1,
    textAlign: "right",
    color: "white",
    fontWeight: "800",
    fontSize: 12,
  } as any,

  officePillText: {
    color: "rgba(255,255,255,0.86)",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.5,
  } as any,
});
