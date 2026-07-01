import { useState, useEffect, useRef, useCallback } from "react";
import { IndexData, IndexGroup, QPMessage, PluginSettings, DEFAULT_SETTINGS } from "../types";
import { parseMessages } from "../parser";

const host = window.QwenPaw?.host;
const LOG = "[dialog-index]";

function loadSettings(): PluginSettings {
  try {
    const raw = localStorage.getItem("dialog-index-settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

const EMPTY_INDEX: IndexData = {
  topic: [], tool: [], code: [], conclusion: [],
  stats: { totalMessages: 0, totalCards: 0, topicCount: 0, toolCount: 0, codeCount: 0, conclusionCount: 0 },
};

/**
 * Find the current chat UUID by matching getCurrentSessionId() against the chat list.
 * Does NOT fall back to "most recent chat" — that would load the wrong session.
 * If no match is found, returns null (empty index is correct for new/empty sessions).
 */
async function resolveCurrentChatId(retryDelayMs = 0): Promise<string | null> {
  if (!host?.fetch) return null;

  if (retryDelayMs > 0) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }

  const imperativeId = host.getCurrentSessionId?.();
  console.log(LOG, "resolveCurrentChatId, imperativeId:", imperativeId);

  // Fetch all chats for current agent
  let chats: any[] = [];
  try {
    const resp = await host.fetch("/chats");
    if (resp.ok) {
      const raw = await resp.json();
      chats = Array.isArray(raw) ? raw : (raw.chats || raw.data || []);
      console.log(LOG, "GET /chats returned", chats.length, "chats");
    } else {
      console.warn(LOG, "GET /chats returned status", resp.status);
    }
  } catch (e) {
    console.warn(LOG, "Failed to list chats:", e);
    return null;
  }

  if (chats.length === 0 || !imperativeId) {
    console.log(LOG, "No chats or no session ID");
    return null;
  }

  // Strategy 1: If imperativeId is a UUID, match against chat.id directly
  if (/^[0-9a-f]{8}-/.test(imperativeId)) {
    const match = chats.find((c: any) => c.id === imperativeId);
    if (match) {
      console.log(LOG, "Matched by UUID:", match.id);
      return match.id;
    }
  }

  // Strategy 2: Match against session_id field
  if (imperativeId.includes(":")) {
    // channel:user_id format — match all, pick most recent
    const matches = chats.filter((c: any) => c.session_id === imperativeId);
    if (matches.length > 0) {
      matches.sort((a: any, b: any) =>
        (b.updated_at || "").localeCompare(a.updated_at || "")
      );
      console.log(LOG, "Matched by session_id:", matches[0].id);
      return matches[0].id;
    }
  }

  // Strategy 3: Pure timestamp ID — match against session_id
  if (/^\d+$/.test(imperativeId)) {
    const byId = chats.find((c: any) => c.id === imperativeId);
    if (byId) {
      console.log(LOG, "Matched timestamp as chat ID:", byId.id);
      return byId.id;
    }
    const bySession = chats.find((c: any) => c.session_id === imperativeId);
    if (bySession) {
      console.log(LOG, "Matched timestamp as session_id:", bySession.id);
      return bySession.id;
    }
    console.log(LOG, "No chat matched timestamp:", imperativeId);
  }

  // Strategy 4: Timestamp with suffix (e.g. "1782489020710-5sm5zjn") — extract numeric prefix
  const tsPrefixMatch = imperativeId.match(/^(\d+)-/);
  if (tsPrefixMatch) {
    const tsPrefix = tsPrefixMatch[1];
    // Try exact session_id match with the full ID first
    const byFull = chats.find((c: any) => c.session_id === imperativeId);
    if (byFull) {
      console.log(LOG, "Matched full suffixed ID as session_id:", byFull.id);
      return byFull.id;
    }
    // Try matching session_id by timestamp prefix
    const byPrefix = chats.find((c: any) => c.session_id === tsPrefix);
    if (byPrefix) {
      console.log(LOG, "Matched timestamp prefix as session_id:", byPrefix.id);
      return byPrefix.id;
    }
    console.log(LOG, "No chat matched suffixed ID:", imperativeId);
  }

  // No match found — this session likely has no chat record yet.
  // Return null instead of falling back to most recent chat.
  console.log(LOG, "No matching chat found, returning null (new/empty session)");
  return null;
}

export function useDialogIndex(hookSessionId: string | null | undefined, agentId?: string | null) {
  const [indexData, setIndexData] = useState<IndexData>(EMPTY_INDEX);
  const [loading, setLoading] = useState(false);
  const settingsRef = useRef<PluginSettings>(loadSettings());
  const chatIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag: sidebar event already set chatId, polling should skip redundant reset
  const chatIdSetByEventRef = useRef(false);
  // Trigger counter: increment to force re-resolve
  const [resolveKey, setResolveKey] = useState(0);

  const forceResolve = useCallback(() => {
    // Cancel any pending retry
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    chatIdRef.current = null;
    setResolveKey((k) => k + 1);
  }, []);

  const fetchAndParse = useCallback(async () => {
    if (!host?.fetch) return;

    // Resolve chat UUID if we don't have one yet
    if (!chatIdRef.current) {
      chatIdRef.current = await resolveCurrentChatId();
      // If still null, schedule ONE retry after 2s (chat may not exist yet for new sessions)
      if (!chatIdRef.current) {
        console.log(LOG, "Chat not resolved yet, will retry in 2s");
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          chatIdRef.current = null;
          setResolveKey((k) => k + 1);
        }, 2000);
        return;
      }
    }

    // Guard: chatIdRef may have been reset by a concurrent session/agent change
    const chatId = chatIdRef.current;
    if (!chatId) return;

    setLoading(true);
    try {
      const resp = await host.fetch("/chats/" + chatId);
      if (!resp.ok) {
        console.warn(LOG, "GET /chats/" + chatId, "returned", resp.status);
        chatIdRef.current = null;
        return;
      }
      const data = await resp.json();
      const messages: QPMessage[] = data.messages || [];
      console.log(LOG, "Fetched", messages.length, "messages from chat", chatId);

      const parsed = parseMessages(messages);

      // Filter by enabled groups
      const settings = settingsRef.current;
      const groups: IndexGroup[] = ["topic", "tool", "code", "conclusion"];
      for (const g of groups) {
        if (!settings.enabledGroups[g]) {
          (parsed as any)[g] = [];
        }
      }

      console.log(LOG, "Index:", parsed.stats);
      setIndexData(parsed);
    } catch (e) {
      console.warn(LOG, "fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Detect session changes via getCurrentSessionId() lightweight polling
  useEffect(() => {
    const checkSession = () => {
      const currentId = host.getCurrentSessionId?.() ?? null;
      if (currentId && currentId !== sessionIdRef.current) {
        console.log(LOG, "Session changed:", sessionIdRef.current, "→", currentId);
        sessionIdRef.current = currentId;
        if (chatIdSetByEventRef.current) {
          // Sidebar event already set chatId and triggered fetch; just sync sessionIdRef
          console.log(LOG, "Session change already handled by sidebar event, skipping re-resolve");
          chatIdSetByEventRef.current = false;
        } else {
          chatIdRef.current = null;
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          setIndexData(EMPTY_INDEX);
          setResolveKey((k) => k + 1);
        }
      }
    };

    // Check immediately
    checkSession();

    // Lightweight polling of imperative session ID (no API calls, just JS value check)
    const timer = setInterval(checkSession, 500);
    return () => clearInterval(timer);
  }, []);

  // Listen for QwenPaw sidebar custom events (instant session change detection)
  useEffect(() => {
    const onSelectSession = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const chatId = detail?.sessionId;
      console.log(LOG, "sidebar-select-session event:", chatId);
      // Cancel any pending retry
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (chatId && /^[0-9a-f]{8}-/.test(chatId)) {
        // Event provides the chat UUID directly — skip resolve entirely
        chatIdRef.current = chatId;
        chatIdSetByEventRef.current = true; // tell polling handler this is already handled
        setIndexData(EMPTY_INDEX);
        setResolveKey((k) => k + 1);
      } else {
        // Fallback to full resolve if event doesn't carry a usable UUID
        chatIdRef.current = null;
        setResolveKey((k) => k + 1);
      }
    };
    const onNewChat = () => {
      console.log(LOG, "sidebar-new-chat event");
      chatIdRef.current = null;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setResolveKey((k) => k + 1);
    };
    window.addEventListener("qwenpaw:sidebar-select-session", onSelectSession);
    window.addEventListener("qwenpaw:sidebar-new-chat", onNewChat);
    return () => {
      window.removeEventListener("qwenpaw:sidebar-select-session", onSelectSession);
      window.removeEventListener("qwenpaw:sidebar-new-chat", onNewChat);
    };
  }, [forceResolve]);

  // Re-fetch when agent changes
  useEffect(() => {
    console.log(LOG, "Agent changed, re-resolving chat");
    chatIdRef.current = null;
    sessionIdRef.current = null;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setIndexData(EMPTY_INDEX);
    setResolveKey((k) => k + 1);
  }, [agentId]);

  // Fetch when resolveKey changes (triggered by session/agent change or events)
  useEffect(() => {
    fetchAndParse();
  }, [resolveKey, fetchAndParse]);

  return { indexData, loading, refresh: fetchAndParse };
}
