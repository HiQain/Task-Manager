import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, Loader2, Mic, MicOff, Phone, PhoneOff, Search, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMarkChatRead, useMarkTaskGroupRead, useMessages, useSendMessage, useSendTaskGroupMessage, useTaskGroupMessages, useTaskGroupUnreadCounts, useTaskGroups, useUnreadCounts } from "@/hooks/use-chat";
import { useUsers } from "@/hooks/use-users";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useTasks } from "@/hooks/use-tasks";

function getTaskMemberIds(task: any): number[] {
  const rawAssignedToIds = task?.assignedToIds;
  let assignedToIds: number[] = [];

  if (Array.isArray(rawAssignedToIds)) {
    assignedToIds = rawAssignedToIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
  } else if (typeof rawAssignedToIds === "string") {
    try {
      const parsed = JSON.parse(rawAssignedToIds);
      if (Array.isArray(parsed)) {
        assignedToIds = parsed.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id));
      }
    } catch {
      assignedToIds = [];
    }
  }

  if (assignedToIds.length === 0 && task?.assignedToId) {
    assignedToIds = [task.assignedToId];
  }

  return Array.from(
    new Set<number>(
      [task?.createdById, ...assignedToIds].filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id)
      )
    )
  );
}

export default function Chat() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: users, isLoading: isUsersLoading } = useUsers();
  const { data: tasks } = useTasks();
  const { data: unreadCounts } = useUnreadCounts();
  const { data: taskGroupUnreadCounts } = useTaskGroupUnreadCounts();
  const markChatRead = useMarkChatRead();
  const markTaskGroupRead = useMarkTaskGroupRead();
  const [activeUserId, setActiveUserId] = useState<number | undefined>(undefined);
  const [activeTaskGroupId, setActiveTaskGroupId] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingOfferFromRef = useRef<number | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const connectedPeerUserIdRef = useRef<number | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [incomingCallFromUserId, setIncomingCallFromUserId] = useState<number | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [presenceByUserId, setPresenceByUserId] = useState<Record<number, { isOnline: boolean; lastSeenAt: string | null }>>({});
  const [typingByUserId, setTypingByUserId] = useState<Record<number, boolean>>({});
  const isCallingRef = useRef(false);
  const isInCallRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const activeUserIdRef = useRef<number | undefined>(undefined);
  const typingClearTimeoutsRef = useRef<Map<number, number>>(new Map());
  const typingStopTimeoutRef = useRef<number | null>(null);
  const typingTargetUserIdRef = useRef<number | undefined>(undefined);
  const sentTypingRef = useRef(false);

  const teamMembers = useMemo(
    () => (users || []).filter((u) => u.id !== user?.id),
    [users, user?.id]
  );

  const filteredUsers = useMemo(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const q = normalize(search);
    if (!q) return teamMembers;
    const compactQuery = q.replace(/\s+/g, "");

    return teamMembers.filter((u) => {
      const haystack = normalize(`${u.name} ${u.email} ${u.role}`);
      const compactHaystack = haystack.replace(/\s+/g, "");
      return haystack.includes(q) || compactHaystack.includes(compactQuery);
    });
  }, [teamMembers, search]);

  const searchingSelf = useMemo(() => {
    if (!search.trim() || !user) return false;
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const q = normalize(search);
    const selfHaystack = normalize(`${user.name} ${user.email} ${user.role}`);
    return selfHaystack.includes(q) || selfHaystack.replace(/\s+/g, "").includes(q.replace(/\s+/g, ""));
  }, [search, user]);

  const { data: taskGroupsData } = useTaskGroups();
  const taskGroups = useMemo(() => taskGroupsData || [], [taskGroupsData]);

  const filteredTaskGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return taskGroups;
    return taskGroups.filter((entry) => {
      const title = (entry.task?.title || "").toLowerCase();
      const description = (entry.task?.description || "").toLowerCase();
      return title.includes(q) || description.includes(q);
    });
  }, [search, taskGroups]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const userIdParam = Number(query.get("userId"));
    const taskIdParam = Number(query.get("taskId"));

    if (Number.isFinite(taskIdParam) && taskIdParam > 0) {
      setActiveTaskGroupId(taskIdParam);
      setActiveUserId(undefined);
      return;
    }

    if (Number.isFinite(userIdParam) && userIdParam > 0) {
      setActiveUserId(userIdParam);
      setActiveTaskGroupId(undefined);
      return;
    }

    setActiveTaskGroupId(undefined);
    setActiveUserId(undefined);
  }, [location]);

  useEffect(() => {
    if (activeTaskGroupId) return;
    if (filteredUsers.length === 0) {
      setActiveUserId(undefined);
      return;
    }
    if (activeUserId && !filteredUsers.some((u) => u.id === activeUserId)) {
      setActiveUserId(undefined);
    }
  }, [filteredUsers, activeUserId, activeTaskGroupId]);

  const activeUser = useMemo(
    () => filteredUsers.find((u) => u.id === activeUserId),
    [filteredUsers, activeUserId]
  );
  const activeTask = useMemo(
    () => (tasks || []).find((t) => t.id === activeTaskGroupId) || taskGroups.find((entry) => entry.task.id === activeTaskGroupId)?.task,
    [tasks, taskGroups, activeTaskGroupId]
  );
  const activeTaskParticipantIds = useMemo(() => {
    if (!activeTask) return [];
    return getTaskMemberIds(activeTask);
  }, [activeTask]);
  const activeTaskParticipants = useMemo(
    () => (users || []).filter((u) => activeTaskParticipantIds.includes(u.id)),
    [users, activeTaskParticipantIds]
  );
  const incomingCallFromUser = useMemo(
    () => teamMembers.find((u) => u.id === incomingCallFromUserId),
    [teamMembers, incomingCallFromUserId]
  );

  const { data: messages, isLoading: isMessagesLoading } = useMessages(activeUserId);
  const sendMessage = useSendMessage(activeUserId);
  const { data: taskGroupMessages, isLoading: isTaskGroupMessagesLoading } = useTaskGroupMessages(activeTaskGroupId);
  const sendTaskGroupMessage = useSendTaskGroupMessage(activeTaskGroupId);

  const handleSelectTaskGroup = (taskId: number) => {
    setActiveTaskGroupId(taskId);
    setActiveUserId(undefined);
    setLocation(`/chat?taskId=${taskId}`);
    void markTaskGroupRead.mutateAsync(taskId).catch(() => {});
  };

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  const clearCallTimeout = () => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  };

  const playBeep = (frequency = 880, durationMs = 220) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.03;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      window.setTimeout(() => {
        oscillator.stop();
        oscillator.disconnect();
        gain.disconnect();
      }, durationMs);
    } catch {
      // Ignore browser audio restrictions
    }
  };

  const startRinging = (mode: "incoming" | "outgoing") => {
    if (ringtoneIntervalRef.current) return;
    const freq = mode === "incoming" ? 920 : 760;
    playBeep(freq, 220);
    ringtoneIntervalRef.current = window.setInterval(() => {
      playBeep(freq, 220);
    }, 1400);
  };

  const stopRinging = () => {
    if (ringtoneIntervalRef.current) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
  };

  const sendActiveRoom = useCallback((targetUserId?: number) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "chat:active-room",
        payload: { activeUserId: targetUserId ?? null },
      }),
    );
  }, []);

  const sendActiveTaskGroup = useCallback((targetTaskId?: number) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "chat:active-task-group",
        payload: { activeTaskId: targetTaskId ?? null },
      }),
    );
  }, []);

  const sendTypingState = useCallback((targetUserId: number, isTyping: boolean) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "chat:typing",
        payload: { toUserId: targetUserId, isTyping },
      }),
    );
  }, []);

  const stopTyping = useCallback((targetUserId?: number) => {
    const toUserId = targetUserId ?? typingTargetUserIdRef.current;
    if (toUserId && sentTypingRef.current) {
      sendTypingState(toUserId, false);
    }
    sentTypingRef.current = false;
    typingTargetUserIdRef.current = undefined;
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
  }, [sendTypingState]);

  const formatLastSeen = useCallback((lastSeenAt: string | null | undefined) => {
    if (!lastSeenAt) return "Select User";
    const date = new Date(lastSeenAt);
    if (Number.isNaN(date.getTime())) return "Select User";
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.max(1, Math.floor(diffMs / 1000));
    if (diffSec < 60) return "Last seen just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `Last seen ${diffHr}h ago`;
    return `Last seen ${date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  }, []);

  const messageCount = activeTaskGroupId
    ? (Array.isArray(taskGroupMessages) ? taskGroupMessages.length : 0)
    : (Array.isArray(messages) ? messages.length : 0);

  useEffect(() => {
    if (!activeTaskGroupId) return;
    void markTaskGroupRead.mutateAsync(activeTaskGroupId).catch(() => {});
  }, [activeTaskGroupId]);

  useEffect(() => {
    if (!activeTaskGroupId) return;
    if (!Array.isArray(taskGroupMessages)) return;
    if (taskGroupMessages.length === 0) return;
    void markTaskGroupRead.mutateAsync(activeTaskGroupId).catch(() => {});
  }, [activeTaskGroupId, taskGroupMessages?.length]);

  useEffect(() => {
    setAutoScrollEnabled(true);
  }, [activeUserId]);

  useEffect(() => {
    activeUserIdRef.current = activeUserId;
  }, [activeUserId]);

  useEffect(() => {
    if (!user?.id) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?userId=${user.id}`);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const parsed = JSON.parse(String(event.data || "{}"));
        if (parsed?.type === "chat:presence-snapshot" && Array.isArray(parsed?.payload)) {
          const next: Record<number, { isOnline: boolean; lastSeenAt: string | null }> = {};
          parsed.payload.forEach((entry: any) => {
            const presenceUserId = Number(entry?.userId);
            if (!Number.isFinite(presenceUserId)) return;
            next[presenceUserId] = {
              isOnline: !!entry?.isOnline,
              lastSeenAt: entry?.lastSeenAt ? String(entry.lastSeenAt) : null,
            };
          });
          setPresenceByUserId(next);
          return;
        }

        if (parsed?.type === "chat:presence") {
          const presenceUserId = Number(parsed?.payload?.userId);
          if (!Number.isFinite(presenceUserId)) return;
          setPresenceByUserId((prev) => ({
            ...prev,
            [presenceUserId]: {
              isOnline: !!parsed?.payload?.isOnline,
              lastSeenAt: parsed?.payload?.lastSeenAt ? String(parsed.payload.lastSeenAt) : null,
            },
          }));
          return;
        }

        if (parsed?.type === "chat:typing") {
          const fromUserId = Number(parsed?.payload?.fromUserId);
          if (!Number.isFinite(fromUserId)) return;
          const isTyping = !!parsed?.payload?.isTyping;
          setTypingByUserId((prev) => ({ ...prev, [fromUserId]: isTyping }));
          const existing = typingClearTimeoutsRef.current.get(fromUserId);
          if (existing) {
            window.clearTimeout(existing);
            typingClearTimeoutsRef.current.delete(fromUserId);
          }
          if (isTyping) {
            const timeoutId = window.setTimeout(() => {
              setTypingByUserId((prev) => ({ ...prev, [fromUserId]: false }));
              typingClearTimeoutsRef.current.delete(fromUserId);
            }, 3500);
            typingClearTimeoutsRef.current.set(fromUserId, timeoutId);
          }
          return;
        }

        if (parsed?.type !== "webrtc:signal") return;
        const fromUserId = Number(parsed?.payload?.fromUserId);
        const signal = parsed?.payload?.signal || {};
        const signalType = signal?.type;

        if (!Number.isFinite(fromUserId)) return;

        if (signalType === "offer") {
          if (isCallingRef.current || isInCallRef.current) {
            sendWebrtcSignal(fromUserId, { type: "decline" });
            return;
          }
          pendingOfferFromRef.current = fromUserId;
          pendingOfferRef.current = signal?.sdp;
          setIncomingCallFromUserId(fromUserId);
          startRinging("incoming");
          return;
        }

        if (signalType === "answer") {
          if (peerRef.current && signal?.sdp) {
            await peerRef.current.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          }
          setIsCalling(false);
          setIsInCall(true);
          stopRinging();
          clearCallTimeout();
          return;
        }

        if (signalType === "ice-candidate" && signal?.candidate) {
          if (peerRef.current && peerRef.current.remoteDescription) {
            await peerRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            queuedCandidatesRef.current.push(signal.candidate);
          }
          return;
        }

        if (signalType === "hangup" || signalType === "decline") {
          stopCurrentSession(false);
          toast({
            title: "Call ended",
            description: signalType === "decline" ? "Call request was declined." : "Remote user ended the call.",
          });
        }
      } catch {
        // ignore malformed signal packets
      }
    };

    ws.onopen = () => {
      sendActiveRoom(activeUserIdRef.current);
      sendActiveTaskGroup(activeTaskGroupId);
    };

    return () => {
      stopTyping();
      typingClearTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      typingClearTimeoutsRef.current.clear();
      ws.close();
      wsRef.current = null;
    };
  }, [user?.id, toast, sendActiveRoom, sendActiveTaskGroup, activeTaskGroupId, stopTyping]);

  useEffect(() => {
    sendActiveRoom(activeUserId);
  }, [activeUserId, sendActiveRoom]);

  useEffect(() => {
    sendActiveTaskGroup(activeTaskGroupId);
  }, [activeTaskGroupId, sendActiveTaskGroup]);

  useEffect(() => {
    if (!activeUserId || activeTaskGroupId) {
      stopTyping();
      return;
    }
    typingTargetUserIdRef.current = activeUserId;
    return () => {
      stopTyping(activeUserId);
    };
  }, [activeUserId, activeTaskGroupId, stopTyping]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount, activeUserId, activeTaskGroupId, autoScrollEnabled]);

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScrollEnabled(distanceFromBottom < 80);
  };

  const sendWebrtcSignal = (toUserId: number, signal: Record<string, unknown>) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "webrtc:signal",
        payload: { toUserId, signal },
      }),
    );
  };

  const stopCurrentSession = (notifyRemote: boolean) => {
    const peerUserId = connectedPeerUserIdRef.current;

    if (notifyRemote && peerUserId) {
      sendWebrtcSignal(peerUserId, { type: "hangup" });
    }

    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    queuedCandidatesRef.current = [];
    pendingOfferRef.current = null;
    pendingOfferFromRef.current = null;
    setIncomingCallFromUserId(null);
    setIsCalling(false);
    setIsInCall(false);
    setIsMuted(false);
    connectedPeerUserIdRef.current = null;
    stopRinging();
    clearCallTimeout();
  };

  const createPeerConnection = (targetUserId: number) => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWebrtcSignal(targetUserId, { type: "ice-candidate", candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      remoteStreamRef.current.addTrack(event.track);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
      }
      setIsInCall(true);
    };

    peerRef.current = pc;
    connectedPeerUserIdRef.current = targetUserId;
    return pc;
  };

  const startCall = async () => {
    if (!activeUserId) {
      toast({ title: "Select user first", description: "Pick a chat user before calling.", variant: "destructive" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      setIsCalling(true);

      const pc = createPeerConnection(activeUserId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWebrtcSignal(activeUserId, { type: "offer", sdp: offer });
      startRinging("outgoing");
      clearCallTimeout();
      callTimeoutRef.current = window.setTimeout(() => {
        if (isCallingRef.current && !isInCallRef.current) {
          stopCurrentSession(true);
          toast({
            title: "No answer",
            description: "User did not accept the call.",
            variant: "destructive",
          });
        }
      }, 30000);
    } catch {
      toast({ title: "Call failed", description: "Could not access microphone.", variant: "destructive" });
      stopCurrentSession(false);
    }
  };

  const acceptIncomingCall = async () => {
    const fromUserId = pendingOfferFromRef.current;
    const offer = pendingOfferRef.current;
    if (!fromUserId || !offer) return;

    setActiveUserId(fromUserId);
    setIncomingCallFromUserId(null);
    stopRinging();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      const pc = createPeerConnection(fromUserId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      for (const candidate of queuedCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      queuedCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebrtcSignal(fromUserId, { type: "answer", sdp: answer });
      setIsCalling(false);
      setIsInCall(true);
    } catch {
      toast({ title: "Unable to join call", description: "Failed to accept call.", variant: "destructive" });
      stopCurrentSession(false);
    }
  };

  const declineIncomingCall = () => {
    const fromUserId = pendingOfferFromRef.current;
    if (fromUserId) {
      sendWebrtcSignal(fromUserId, { type: "decline" });
    }
    pendingOfferFromRef.current = null;
    pendingOfferRef.current = null;
    setIncomingCallFromUserId(null);
    stopRinging();
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
    }
  };

  useEffect(() => {
    return () => {
      stopCurrentSession(false);
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  const isGroupMode = !!activeTaskGroupId;
  const showConversationPanel = !!activeUserId || !!activeTaskGroupId;
  const displayedMessages = isGroupMode ? (taskGroupMessages || []) : (messages || []);
  const isDisplayedMessagesLoading = isGroupMode ? isTaskGroupMessagesLoading : isMessagesLoading;
  const sendPending = isGroupMode ? sendTaskGroupMessage.isPending : sendMessage.isPending;

  const handleSend = async () => {
    const content = draft.trim();
    if (!content) return;
    try {
      if (isGroupMode && activeTaskGroupId) {
        await sendTaskGroupMessage.mutateAsync({ content });
      } else if (activeUserId) {
        await sendMessage.mutateAsync({ toUserId: activeUserId, content });
      } else {
        return;
      }
      setDraft("");
      stopTyping(activeUserId);
    } catch (error) {
      toast({
        title: "Message send failed",
        description: error instanceof Error ? error.message : "Unable to send message",
        variant: "destructive",
      });
    }
  };

  const handleSelectUser = async (userId: number) => {
    setActiveUserId(userId);
    setActiveTaskGroupId(undefined);
    setLocation(`/chat?userId=${userId}`);
    try {
      await markChatRead.mutateAsync(userId);
    } catch {
      // non-blocking
    }
  };

  const clearActiveConversation = () => {
    stopTyping(activeUserId);
    setActiveUserId(undefined);
    setActiveTaskGroupId(undefined);
    setLocation("/chat");
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!activeUserId || isGroupMode) return;
    const trimmed = value.trim();
    const previousTargetUserId = typingTargetUserIdRef.current;

    if (!trimmed) {
      stopTyping(activeUserId);
      return;
    }

    typingTargetUserIdRef.current = activeUserId;
    if (!sentTypingRef.current || previousTargetUserId !== activeUserId) {
      sendTypingState(activeUserId, true);
      sentTypingRef.current = true;
    }

    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStopTimeoutRef.current = window.setTimeout(() => {
      stopTyping(activeUserId);
    }, 1500);
  };

  const activePresence = activeUserId ? presenceByUserId[activeUserId] : undefined;
  const isActiveUserTyping = activeUserId ? !!typingByUserId[activeUserId] : false;
  const activeUserSubtitle = isActiveUserTyping
    ? "typing..."
    : (activePresence?.isOnline ? "Online" : formatLastSeen(activePresence?.lastSeenAt));

  if (isUsersLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7.5rem)] md:h-[calc(100vh-10rem)] border border-border rounded-xl overflow-hidden bg-card grid grid-cols-1 md:grid-cols-[280px_1fr]">
      <aside className={`border-r border-border/60 bg-muted/20 flex-col min-h-0 ${showConversationPanel ? "hidden md:flex" : "flex"}`}>
        <div className="p-4 border-b border-border/60 shrink-0">
          <h3 className="font-semibold text-sm text-foreground">Team Chat</h3>
          <p className="text-xs text-muted-foreground mt-1">Search and select a team user</p>
          <div className="mt-3 relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type name or email..."
              className="h-9 pl-9 bg-background"
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Search is automatic while typing.
          </p>
        </div>
        <div className="p-2 space-y-1 overflow-y-auto flex-1 min-h-0">
          {filteredTaskGroups.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Task Groups
              </p>
              {filteredTaskGroups.map((entry) => {
                const task = entry.task;
                const isActive = task.id === activeTaskGroupId;
                const membersCount = entry.participantIds.length;
                const unread = taskGroupUnreadCounts?.byTask?.[String(task.id)] || 0;
                return (
                  <button
                    key={`group-${task.id}`}
                    onClick={() => handleSelectTaskGroup(task.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-2 ${
                      isActive ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="h-7 w-7 rounded-md border border-primary/15 bg-primary/5 flex items-center justify-center text-[11px] font-semibold text-primary">
                      #
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-[11px] text-muted-foreground">{membersCount} members</p>
                    </div>
                    {unread > 0 && (
                      <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="my-2 h-px bg-border/60" />
            </>
          )}

          <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Direct Messages
          </p>
          {filteredUsers.map((u) => {
            const isActive = u.id === activeUserId;
            const unread = unreadCounts?.byUser?.[String(u.id)] || 0;
            return (
              <button
                key={u.id}
                onClick={() => void handleSelectUser(u.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-2 ${isActive ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"
                  }`}
              >
                <Avatar className="h-7 w-7 border border-primary/10">
                  <AvatarFallback className="text-[11px] bg-primary/5 text-primary">
                    {u.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-[11px] text-muted-foreground capitalize">{u.role}</p>
                </div>
                {unread > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
          {filteredUsers.length === 0 && filteredTaskGroups.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              {searchingSelf
                ? "You cannot chat with your own account. Search another team user or group."
                : "No user or group found."}
            </p>
          )}
        </div>
      </aside>

      <section className={`flex-col min-h-0 ${!showConversationPanel ? "hidden md:flex" : "flex"}`}>
        <div className="px-5 py-4 border-b border-border/60 bg-background">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={clearActiveConversation}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div>
              <h3 className="font-semibold">
                {isGroupMode ? (activeTask?.title ? `Task Group: ${activeTask.title}` : "Task Group") : (activeUser?.name || "Select user")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {isGroupMode
                  ? `Participants: ${activeTaskParticipants.map((p) => p.name).join(", ")}`
                  : activeUserSubtitle}
              </p>
              </div>
            </div>
            {!isGroupMode && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={!activeUserId || isCalling || isInCall}
                onClick={() => void startCall()}
              >
                <Phone className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Call</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={!isCalling && !isInCall}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="w-4 h-4 sm:mr-2" /> : <Mic className="w-4 h-4 sm:mr-2" />}
                <span className="hidden sm:inline">{isMuted ? "Unmute" : "Mute"}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9"
                disabled={!isCalling && !isInCall}
                onClick={() => stopCurrentSession(true)}
              >
                <PhoneOff className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">End</span>
              </Button>
            </div>
            )}
          </div>
        </div>

        {!isGroupMode && (incomingCallFromUserId || isCalling || isInCall) && (
          <div className="p-3 border-b border-border/60 bg-muted/20 space-y-3">
            {incomingCallFromUserId && (
              <div className="rounded-md border bg-background p-3 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <p className="font-medium">{incomingCallFromUser?.name || "User"} is calling you</p>
                  <p className="text-xs text-muted-foreground">Accept to join voice call.</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={declineIncomingCall}>
                    Decline
                  </Button>
                  <Button type="button" size="sm" onClick={() => void acceptIncomingCall()}>
                    Accept
                  </Button>
                </div>
              </div>
            )}

            {(isCalling || isInCall) && (
              <div className="rounded-md border bg-background p-3 text-sm flex items-center justify-between">
                <span>{isInCall ? "In call" : "Calling..."}</span>
                <span className="text-xs text-muted-foreground">{isMuted ? "Mic muted" : "Mic on"}</span>
              </div>
            )}
          </div>
        )}

        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3 bg-background"
        >
          {isDisplayedMessagesLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : !showConversationPanel ? (
            <p className="text-sm text-muted-foreground">Select a user or task group to start chat.</p>
          ) : displayedMessages.length > 0 ? (
            displayedMessages.map((msg) => {
              const mine = msg.fromUserId === user?.id;
              const sender = (users || []).find((u) => u.id === msg.fromUserId);
              return (
                <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 border ${mine
                      ? "bg-primary text-primary-foreground border-primary/30"
                      : "bg-muted/40 text-foreground border-border"
                      }`}
                  >
                    {isGroupMode && !mine && (
                      <p className="text-[10px] font-semibold mb-1 text-muted-foreground">
                        {sender?.name || "Unknown"}
                      </p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>
          )}
          {!!(displayedMessages as any)?.message && (
            <p className="text-xs text-destructive">{String((displayedMessages as any).message)}</p>
          )}
          {sendMessage.isError && (
            <p className="text-xs text-destructive">
              {sendMessage.error instanceof Error ? sendMessage.error.message : "Failed to send message"}
            </p>
          )}
          {sendTaskGroupMessage.isError && (
            <p className="text-xs text-destructive">
              {sendTaskGroupMessage.error instanceof Error ? sendTaskGroupMessage.error.message : "Failed to send group message"}
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-border/60 bg-muted/10">
          <audio ref={remoteAudioRef} autoPlay />
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await handleSend();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder={showConversationPanel ? "Type a message..." : "Select user or task group first"}
              disabled={!showConversationPanel || sendPending}
              className="h-11"
            />
            <Button
              type="submit"
              disabled={!showConversationPanel || !draft.trim() || sendPending}
              className="h-11 px-4"
            >
              {sendPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
