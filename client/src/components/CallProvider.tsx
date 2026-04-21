import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Presentation, ScreenShare, ScreenShareOff, UserPlus, Users } from "lucide-react";
import { api } from "@shared/routes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUsers } from "@/hooks/use-users";
import { withBasePath } from "@/lib/base-path";

const BROWSER_NOTIFICATIONS_PROMPT_KEY = "browser_notifications_prompted_v1";

type CallContextValue = {
  callUserId: number | null;
  isBusy: boolean;
  isCalling: boolean;
  isInCall: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  isStartingScreenShare: boolean;
  isRemoteScreenSharing: boolean;
  callDurationSec: number;
  startCall: (userId: number) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  declineIncomingCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleScreenShare: () => Promise<void>;
};

type IncomingCallState = {
  fromUserId: number;
  sdp: RTCSessionDescriptionInit;
  sessionId: string;
  participantIds: number[];
};

type PeerEntry = {
  pc: RTCPeerConnection;
  presentationSender: RTCRtpSender | null;
};

const CallContext = createContext<CallContextValue | null>(null);

function setElementStream(element: HTMLMediaElement | null, stream: MediaStream | null) {
  if (!element) return;
  element.srcObject = stream;
}

function playMediaElement(element: HTMLMediaElement | null) {
  if (!element) return;
  const result = element.play();
  if (result && typeof result.catch === "function") {
    void result.catch(() => {
      // Ignore autoplay restrictions until the next user gesture.
    });
  }
}

function getScreenShareLabel(label?: string | null) {
  const nextLabel = String(label || "").trim();
  return nextLabel || "Shared screen";
}

function formatCallDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function buildSessionId() {
  return globalThis.crypto?.randomUUID?.() || `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDeletedCallUser(userLike: { email?: string | null; name?: string | null; role?: string | null } | null | undefined) {
  if (!userLike) return false;
  const email = (userLike.email || "").toLowerCase();
  const name = (userLike.name || "").toLowerCase();
  const role = (userLike.role || "").toLowerCase();
  return role === "deleted" || email.endsWith("@deleted.local") || name.includes("deleted user");
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error("useCall must be used within CallProvider");
  }
  return context;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users } = useUsers();

  const wsRef = useRef<WebSocket | null>(null);
  const peerEntriesRef = useRef<Map<number, PeerEntry>>(new Map());
  const queuedCandidatesByUserIdRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioStreamsRef = useRef<Map<number, MediaStream>>(new Map());
  const remoteAudioElementsRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const remotePresentationStreamsRef = useRef<Map<number, MediaStream>>(new Map());
  const remotePresenterLabelsRef = useRef<Map<number, string>>(new Map());
  const sessionIdRef = useRef<string | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const pendingInviteTimeoutsRef = useRef<Map<number, number>>(new Map());
  const pendingInviteIdsRef = useRef<number[]>([]);
  const usersRef = useRef<Array<{ id: number; name: string }>>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const localPresentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const remotePresentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const presentationStageRef = useRef<HTMLDivElement | null>(null);
  const isCallingRef = useRef(false);
  const isInCallRef = useRef(false);
  const isScreenSharingRef = useRef(false);
  const isStoppingScreenShareRef = useRef(false);
  const remoteParticipantIdsRef = useRef<number[]>([]);
  const activeRemotePresenterUserIdRef = useRef<number | null>(null);
  const forcedLogoutHandledRef = useRef(false);
  const incomingCallRef = useRef<IncomingCallState | null>(null);
  const screenShareLabelRef = useRef("");
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [remoteParticipantIds, setRemoteParticipantIds] = useState<number[]>([]);
  const [pendingInviteIds, setPendingInviteIds] = useState<number[]>([]);
  const [remoteAudioUserIds, setRemoteAudioUserIds] = useState<number[]>([]);
  const [isCalling, setIsCalling] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isStartingScreenShare, setIsStartingScreenShare] = useState(false);
  const [activeRemotePresenterUserId, setActiveRemotePresenterUserId] = useState<number | null>(null);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [screenShareLabel, setScreenShareLabel] = useState("");
  const [remoteScreenShareLabel, setRemoteScreenShareLabel] = useState("");
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [isAddPeopleOpen, setIsAddPeopleOpen] = useState(false);
  const [isCallWindowMinimized, setIsCallWindowMinimized] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [isPresentationFullscreen, setIsPresentationFullscreen] = useState(false);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<number[]>([]);

  const setRemoteParticipants = useCallback((updater: number[] | ((prev: number[]) => number[])) => {
    setRemoteParticipantIds((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const unique = Array.from(new Set(next.filter((id) => Number.isFinite(id) && id !== user?.id)));
      remoteParticipantIdsRef.current = unique;
      return unique;
    });
  }, [user?.id]);

  const setPendingInvites = useCallback((updater: number[] | ((prev: number[]) => number[])) => {
    setPendingInviteIds((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const unique = Array.from(new Set(next.filter((id) => Number.isFinite(id) && id !== user?.id)));
      pendingInviteIdsRef.current = unique;
      return unique;
    });
  }, [user?.id]);

  const removePendingInvite = useCallback((userId: number) => {
    setPendingInvites((prev) => prev.filter((id) => id !== userId));
    const timeoutId = pendingInviteTimeoutsRef.current.get(userId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      pendingInviteTimeoutsRef.current.delete(userId);
    }
  }, [setPendingInvites]);

  useEffect(() => {
    usersRef.current = (users || []).map((entry) => ({ id: entry.id, name: entry.name }));
  }, [users]);

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    screenShareLabelRef.current = screenShareLabel;
  }, [screenShareLabel]);

  useEffect(() => {
    activeRemotePresenterUserIdRef.current = activeRemotePresenterUserId;
  }, [activeRemotePresenterUserId]);

  const getUserName = useCallback((userId: number | null) => {
    if (!userId) return "Unknown user";
    return usersRef.current.find((entry) => entry.id === userId)?.name || `User ${userId}`;
  }, []);

  const invalidateRealtimeQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.tasks.get.path] });
    queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
    queryClient.invalidateQueries({ queryKey: [api.chats.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
    queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
    queryClient.invalidateQueries({ queryKey: ["chat", "task-group"] });
    queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
    queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
  }, [queryClient]);

  const showBrowserNotification = useCallback((title: string, options?: { body?: string; tag?: string }) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;

    const notification = new Notification(title, {
      body: options?.body,
      tag: options?.tag,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, []);

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const playBeep = useCallback((frequency = 880, durationMs = 220) => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      // Ignore browser audio restrictions.
    }
  }, []);

  const startRinging = useCallback((mode: "incoming" | "outgoing") => {
    if (ringtoneIntervalRef.current) return;
    const frequency = mode === "incoming" ? 920 : 760;
    playBeep(frequency, 220);
    ringtoneIntervalRef.current = window.setInterval(() => {
      playBeep(frequency, 220);
    }, 1400);
  }, [playBeep]);

  const stopRinging = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
  }, []);

  const buildParticipantList = useCallback((extraIds: number[] = []) => {
    return Array.from(
      new Set<number>(
        [user?.id, ...remoteParticipantIdsRef.current, ...pendingInviteIdsRef.current, ...extraIds]
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
      )
    );
  }, [user?.id]);

  const sendSignal = useCallback((toUserId: number, signal: Record<string, unknown>) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "webrtc:signal",
        payload: { toUserId, signal },
      }),
    );
  }, []);

  const syncRemoteAudioUsers = useCallback(() => {
    setRemoteAudioUserIds(Array.from(remoteAudioStreamsRef.current.keys()).sort((leftId, rightId) => leftId - rightId));
  }, []);

  const bindRemoteAudioElement = useCallback((userId: number, element: HTMLAudioElement | null) => {
    if (!element) {
      remoteAudioElementsRef.current.delete(userId);
      return;
    }
    remoteAudioElementsRef.current.set(userId, element);
    setElementStream(element, remoteAudioStreamsRef.current.get(userId) || null);
    playMediaElement(element);
  }, []);

  const playRemoteAudioForUser = useCallback((userId: number) => {
    playMediaElement(remoteAudioElementsRef.current.get(userId) || null);
  }, []);

  const ensureRemoteAudioStream = useCallback((userId: number) => {
    const existingStream = remoteAudioStreamsRef.current.get(userId);
    if (existingStream) return existingStream;

    const nextStream = new MediaStream();
    remoteAudioStreamsRef.current.set(userId, nextStream);
    syncRemoteAudioUsers();
    const audioElement = remoteAudioElementsRef.current.get(userId) || null;
    setElementStream(audioElement, nextStream);
    playMediaElement(audioElement);
    return nextStream;
  }, [syncRemoteAudioUsers]);

  const removeRemotePresentationForUser = useCallback((userId: number) => {
    remotePresentationStreamsRef.current.delete(userId);
    remotePresenterLabelsRef.current.delete(userId);
    setActiveRemotePresenterUserId((current) => {
      if (current !== userId) return current;
      const [nextPresenterId, nextLabel] = Array.from(remotePresenterLabelsRef.current.entries())[0] || [];
      setIsRemoteScreenSharing(!!nextPresenterId);
      setRemoteScreenShareLabel(nextLabel || "");
      return nextPresenterId || null;
    });
  }, []);

  const maybeAttachRemotePresentation = useCallback(() => {
    if (!activeRemotePresenterUserId || !isRemoteScreenSharing) {
      setElementStream(remotePresentationVideoRef.current, null);
      return;
    }
    const stream = remotePresentationStreamsRef.current.get(activeRemotePresenterUserId) || null;
    setElementStream(remotePresentationVideoRef.current, stream);
    playMediaElement(remotePresentationVideoRef.current);
  }, [activeRemotePresenterUserId, isRemoteScreenSharing]);

  useEffect(() => {
    maybeAttachRemotePresentation();
  }, [maybeAttachRemotePresentation]);

  const cleanupPeerConnection = useCallback((peerUserId: number) => {
    const peerEntry = peerEntriesRef.current.get(peerUserId);
    if (peerEntry) {
      peerEntry.pc.close();
      peerEntriesRef.current.delete(peerUserId);
    }

    const remoteAudioStream = remoteAudioStreamsRef.current.get(peerUserId);
    if (remoteAudioStream) {
      remoteAudioStream.getTracks().forEach((track) => {
        remoteAudioStream.removeTrack(track);
      });
      remoteAudioStreamsRef.current.delete(peerUserId);
      setElementStream(remoteAudioElementsRef.current.get(peerUserId) || null, null);
      syncRemoteAudioUsers();
    }
    queuedCandidatesByUserIdRef.current.delete(peerUserId);
    removeRemotePresentationForUser(peerUserId);
    removePendingInvite(peerUserId);
    setRemoteParticipants((prev) => prev.filter((id) => id !== peerUserId));
  }, [removePendingInvite, removeRemotePresentationForUser, setRemoteParticipants, syncRemoteAudioUsers]);

  const resetFullSessionState = useCallback(() => {
    peerEntriesRef.current.forEach((entry) => entry.pc.close());
    peerEntriesRef.current.clear();
    queuedCandidatesByUserIdRef.current.clear();
    remotePresentationStreamsRef.current.clear();
    remotePresenterLabelsRef.current.clear();
    pendingInviteTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    pendingInviteTimeoutsRef.current.clear();

    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach((track) => track.stop());
      localAudioStreamRef.current = null;
    }

    remoteAudioStreamsRef.current.forEach((stream, userId) => {
      stream.getTracks().forEach((track) => {
        stream.removeTrack(track);
      });
      setElementStream(remoteAudioElementsRef.current.get(userId) || null, null);
    });
    remoteAudioStreamsRef.current.clear();
    setRemoteAudioUserIds([]);

    sessionIdRef.current = null;
    setElementStream(localPresentationVideoRef.current, null);
    setElementStream(remotePresentationVideoRef.current, null);
    setRemoteParticipants([]);
    pendingInviteIdsRef.current = [];
    setPendingInviteIds([]);
    setIncomingCall(null);
    incomingCallRef.current = null;
    setIsCalling(false);
    setIsInCall(false);
    setIsMuted(false);
    setActiveRemotePresenterUserId(null);
    setIsRemoteScreenSharing(false);
    setRemoteScreenShareLabel("");
    setCallStartedAt(null);
    setCallDurationSec(0);
    setIsAddPeopleOpen(false);
    setInviteSearch("");
    setSelectedInviteeIds([]);
    setIsCallWindowMinimized(false);
    setIsPresentationFullscreen(false);
    stopRinging();
    clearCallTimeout();
  }, [clearCallTimeout, setRemoteParticipants, stopRinging]);

  const applyScreenShareTrackToPeers = useCallback((track: MediaStreamTrack | null) => {
    peerEntriesRef.current.forEach((entry) => {
      if (entry.presentationSender) {
        void entry.presentationSender.replaceTrack(track).catch(() => {
          // Ignore per-peer screen share sender failures.
        });
      }
    });
  }, []);

  const stopScreenShare = useCallback((notifyRemote: boolean) => {
    if (isStoppingScreenShareRef.current) return;
    isStoppingScreenShareRef.current = true;

    const hadActiveShare = !!screenShareStreamRef.current;
    if (screenShareStreamRef.current) {
      screenShareStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        if (track.readyState !== "ended") {
          track.stop();
        }
      });
    }

    screenShareStreamRef.current = null;
    setElementStream(localPresentationVideoRef.current, null);
    setIsScreenSharing(false);
    isScreenSharingRef.current = false;
    setIsStartingScreenShare(false);
    setScreenShareLabel("");
    screenShareLabelRef.current = "";
    applyScreenShareTrackToPeers(null);

    if (notifyRemote && hadActiveShare) {
      peerEntriesRef.current.forEach((_, peerUserId) => {
        sendSignal(peerUserId, {
          type: "screen-share-status",
          sessionId: sessionIdRef.current,
          status: "stopped",
        });
      });
    }

    isStoppingScreenShareRef.current = false;
  }, [applyScreenShareTrackToPeers, sendSignal]);

  const stopCurrentSession = useCallback((notifyRemote: boolean) => {
    if (notifyRemote) {
      peerEntriesRef.current.forEach((_, peerUserId) => {
        sendSignal(peerUserId, {
          type: "hangup",
          sessionId: sessionIdRef.current,
        });
      });
    }

    stopScreenShare(false);
    resetFullSessionState();
  }, [resetFullSessionState, sendSignal, stopScreenShare]);

  const ensureLocalAudioStream = useCallback(async () => {
    if (!localAudioStreamRef.current) {
      localAudioStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    }
    localAudioStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
    return localAudioStreamRef.current;
  }, [isMuted]);

  const createPeerConnection = useCallback((targetUserId: number, includePresentationChannel = false) => {
    cleanupPeerConnection(targetUserId);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const peerEntry: PeerEntry = {
      pc,
      presentationSender: null,
    };

    if (includePresentationChannel) {
      const presentationTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      peerEntry.presentationSender = presentationTransceiver.sender;
      const activeTrack = screenShareStreamRef.current?.getVideoTracks()[0] || null;
      if (activeTrack) {
        void presentationTransceiver.sender.replaceTrack(activeTrack).catch(() => {
          // Ignore initial screen-share sender sync failures.
        });
      }
    }

    peerEntriesRef.current.set(targetUserId, peerEntry);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetUserId, {
          type: "ice-candidate",
          sessionId: sessionIdRef.current,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === "video") {
        const remotePresentationStream = event.streams[0] || new MediaStream([event.track]);
        remotePresentationStreamsRef.current.set(targetUserId, remotePresentationStream);

        const attachRemotePresentation = () => {
          if (activeRemotePresenterUserIdRef.current === targetUserId || remotePresenterLabelsRef.current.has(targetUserId)) {
            setActiveRemotePresenterUserId(targetUserId);
            setIsRemoteScreenSharing(true);
            setRemoteScreenShareLabel(remotePresenterLabelsRef.current.get(targetUserId) || "Shared screen");
            setElementStream(remotePresentationVideoRef.current, remotePresentationStream);
            playMediaElement(remotePresentationVideoRef.current);
          }
        };

        attachRemotePresentation();
        event.track.onunmute = () => {
          attachRemotePresentation();
        };
        event.track.onmute = () => {
          if (activeRemotePresenterUserIdRef.current === targetUserId) {
            setElementStream(remotePresentationVideoRef.current, null);
          }
        };
        event.track.onended = () => {
          removeRemotePresentationForUser(targetUserId);
        };
        return;
      }

      const remoteAudioStream = ensureRemoteAudioStream(targetUserId);
      if (!remoteAudioStream.getTracks().some((track) => track.id === event.track.id)) {
        remoteAudioStream.addTrack(event.track);
      }
      event.track.onunmute = () => {
        playRemoteAudioForUser(targetUserId);
      };
      playRemoteAudioForUser(targetUserId);
      setIsCalling(false);
      setIsInCall(true);
      setCallStartedAt((prev) => prev ?? Date.now());
      setRemoteParticipants((prev) => (prev.includes(targetUserId) ? prev : [...prev, targetUserId]));
    };

    pc.onconnectionstatechange = () => {
      const currentEntry = peerEntriesRef.current.get(targetUserId);
      if (!currentEntry || currentEntry.pc !== pc) return;

      if (pc.connectionState === "connected") {
        setIsCalling(false);
        setIsInCall(true);
        setCallStartedAt((prev) => prev ?? Date.now());
        setRemoteParticipants((prev) => (prev.includes(targetUserId) ? prev : [...prev, targetUserId]));
      }

      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        cleanupPeerConnection(targetUserId);
        if (peerEntriesRef.current.size === 0 && pendingInviteIdsRef.current.length === 0) {
          resetFullSessionState();
        } else if (peerEntriesRef.current.size === 0) {
          setIsInCall(false);
        }
      }
    };

    return pc;
  }, [cleanupPeerConnection, ensureRemoteAudioStream, playRemoteAudioForUser, removeRemotePresentationForUser, resetFullSessionState, sendSignal, setRemoteParticipants]);

  const syncPresentationSender = useCallback((targetUserId: number) => {
    const entry = peerEntriesRef.current.get(targetUserId);
    if (!entry) return;
    const presentationTransceiver = entry.pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === "video");
    if (!presentationTransceiver) return;
    presentationTransceiver.direction = "sendrecv";
    entry.presentationSender = presentationTransceiver.sender;
    const activeTrack = screenShareStreamRef.current?.getVideoTracks()[0] || null;
    if (activeTrack) {
      void presentationTransceiver.sender.replaceTrack(activeTrack).catch(() => {
        // Ignore screen-share sender sync failures.
      });
    }
  }, []);

  const applyQueuedCandidates = useCallback(async (targetUserId: number, pc: RTCPeerConnection) => {
    const queuedCandidates = queuedCandidatesByUserIdRef.current.get(targetUserId) || [];
    queuedCandidatesByUserIdRef.current.delete(targetUserId);
    for (const candidate of queuedCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const sendOfferToUser = useCallback(async (targetUserId: number, participantIds: number[]) => {
    const localAudioStream = await ensureLocalAudioStream();
    const pc = createPeerConnection(targetUserId, true);
    localAudioStream.getTracks().forEach((track) => pc.addTrack(track, localAudioStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetUserId, {
      type: "offer",
      sdp: offer,
      sessionId: sessionIdRef.current,
      participantIds,
    });
  }, [createPeerConnection, ensureLocalAudioStream, sendSignal]);

  const answerOffer = useCallback(async (offerState: IncomingCallState, autoJoin = false) => {
    sessionIdRef.current = offerState.sessionId;
    incomingCallRef.current = null;
    setIncomingCall(null);
    setRemoteParticipants(offerState.participantIds.filter((id) => id !== user?.id));
    stopRinging();

    const localAudioStream = await ensureLocalAudioStream();
    const pc = createPeerConnection(offerState.fromUserId);
    localAudioStream.getTracks().forEach((track) => pc.addTrack(track, localAudioStream));

    await pc.setRemoteDescription(new RTCSessionDescription(offerState.sdp));
    syncPresentationSender(offerState.fromUserId);
    await applyQueuedCandidates(offerState.fromUserId, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(offerState.fromUserId, {
      type: "answer",
      sdp: answer,
      sessionId: offerState.sessionId,
      participantIds: offerState.participantIds,
      autoJoin,
    });

    setIsCalling(false);
    setIsInCall(true);
    setCallStartedAt((prev) => prev ?? Date.now());
  }, [applyQueuedCandidates, createPeerConnection, ensureLocalAudioStream, sendSignal, setRemoteParticipants, stopRinging, syncPresentationSender, user?.id]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      await answerOffer(incomingCall);
    } catch {
      toast({
        title: "Unable to join call",
        description: "Microphone access failed or call setup error.",
        variant: "destructive",
      });
      stopCurrentSession(false);
    }
  }, [answerOffer, incomingCall, stopCurrentSession, toast]);

  const declineIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    sendSignal(incomingCall.fromUserId, {
      type: "decline",
      sessionId: incomingCall.sessionId,
    });
    incomingCallRef.current = null;
    setIncomingCall(null);
    stopRinging();
  }, [incomingCall, sendSignal, stopRinging]);

  const startCall = useCallback(async (userId: number) => {
    if (!userId) {
      toast({
        title: "Select user first",
        description: "Pick a chat user before calling.",
        variant: "destructive",
      });
      return;
    }

    if (incomingCall || isCallingRef.current || isInCallRef.current) {
      toast({
        title: "Call already active",
        description: "Finish the current call before starting a new one.",
      });
      return;
    }

    sessionIdRef.current = buildSessionId();
    setRemoteParticipants([]);
    setPendingInvites([userId]);
    setIsCalling(true);
    setIsInCall(false);
    setIsAddPeopleOpen(false);
    setSelectedInviteeIds([]);
    setIsCallWindowMinimized(false);

    try {
      await sendOfferToUser(userId, buildParticipantList([userId]));
      startRinging("outgoing");
      clearCallTimeout();
      callTimeoutRef.current = window.setTimeout(() => {
        if (isCallingRef.current && !isInCallRef.current && pendingInviteIdsRef.current.includes(userId)) {
          removePendingInvite(userId);
          stopCurrentSession(true);
          toast({
            title: "No answer",
            description: "User did not accept the call.",
            variant: "destructive",
          });
        }
      }, 30000);
    } catch {
      toast({
        title: "Call failed",
        description: "Could not access microphone.",
        variant: "destructive",
      });
      stopCurrentSession(false);
    }
  }, [buildParticipantList, clearCallTimeout, incomingCall, removePendingInvite, sendOfferToUser, setPendingInvites, setRemoteParticipants, startRinging, stopCurrentSession, toast]);

  const inviteParticipants = useCallback(async (userIds: number[]) => {
    if (!sessionIdRef.current) return;
    const nextInvitees = userIds.filter((candidateId) => {
      return candidateId !== user?.id
        && !remoteParticipantIdsRef.current.includes(candidateId)
        && !pendingInviteIdsRef.current.includes(candidateId);
    });
    if (nextInvitees.length === 0) return;

    const allParticipantIds = buildParticipantList(nextInvitees);
    setPendingInvites((prev) => [...prev, ...nextInvitees]);

    for (const inviteeId of nextInvitees) {
      try {
        await sendOfferToUser(inviteeId, allParticipantIds);
      } catch {
        removePendingInvite(inviteeId);
        toast({
          title: "Invite failed",
          description: `Could not add ${getUserName(inviteeId)} to the call.`,
          variant: "destructive",
        });
      }
    }
  }, [buildParticipantList, getUserName, removePendingInvite, sendOfferToUser, setPendingInvites, toast, user?.id]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
    }
  }, [isMuted]);

  const startScreenShare = useCallback(async () => {
    if (!isInCallRef.current || peerEntriesRef.current.size === 0) {
      toast({
        title: "Join call first",
        description: "Start or accept a call before sharing your screen.",
        variant: "destructive",
      });
      return;
    }

    if (isRemoteScreenSharing) {
      toast({
        title: "Presentation already live",
        description: `${getUserName(activeRemotePresenterUserId)} is already presenting.`,
      });
      return;
    }

    if (isStartingScreenShare) return;
    setIsStartingScreenShare(true);

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 24 },
        },
        audio: false,
      });

      const videoTrack = screenStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No screen track found");
      }

      videoTrack.contentHint = "detail";
      videoTrack.onended = () => {
        stopScreenShare(true);
      };

      screenShareStreamRef.current = screenStream;
      setScreenShareLabel(getScreenShareLabel(videoTrack.label));
      screenShareLabelRef.current = getScreenShareLabel(videoTrack.label);
      setIsScreenSharing(true);
      isScreenSharingRef.current = true;
      setElementStream(localPresentationVideoRef.current, screenStream);
      applyScreenShareTrackToPeers(videoTrack);

      peerEntriesRef.current.forEach((_, peerUserId) => {
        sendSignal(peerUserId, {
          type: "screen-share-status",
          sessionId: sessionIdRef.current,
          status: "started",
          label: getScreenShareLabel(videoTrack.label),
        });
      });
    } catch (error) {
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current.getTracks().forEach((track) => track.stop());
        screenShareStreamRef.current = null;
      }
      setIsScreenSharing(false);
      isScreenSharingRef.current = false;
      setScreenShareLabel("");
      screenShareLabelRef.current = "";
      const isPermissionDismissed = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
      toast({
        title: "Screen share cancelled",
        description: isPermissionDismissed
          ? "Presentation window was closed before sharing started."
          : "Unable to start screen sharing in this browser.",
        variant: "destructive",
      });
    } finally {
      setIsStartingScreenShare(false);
    }
  }, [activeRemotePresenterUserId, applyScreenShareTrackToPeers, getUserName, isRemoteScreenSharing, isStartingScreenShare, sendSignal, stopScreenShare, toast]);

  const togglePresentationFullscreen = useCallback(async () => {
    const stageElement = presentationStageRef.current;
    if (!stageElement || typeof document === "undefined") return;

    try {
      if (document.fullscreenElement === stageElement) {
        await document.exitFullscreen();
        return;
      }

      if (!document.fullscreenElement) {
        await stageElement.requestFullscreen();
      }
    } catch {
      toast({
        title: "Fullscreen unavailable",
        description: "This browser blocked fullscreen for the shared screen preview.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const runtimeRef = useRef({
    applyQueuedCandidates,
    answerOffer,
    buildParticipantList,
    clearCallTimeout,
    cleanupPeerConnection,
    getUserName,
    invalidateRealtimeQueries,
    removePendingInvite,
    resetFullSessionState,
    sendOfferToUser,
    sendSignal,
    setRemoteParticipants,
    showBrowserNotification,
    startRinging,
    stopCurrentSession,
    stopRinging,
    syncPresentationSender,
    toast,
  });

  useEffect(() => {
    runtimeRef.current = {
      applyQueuedCandidates,
      answerOffer,
      buildParticipantList,
      clearCallTimeout,
      cleanupPeerConnection,
      getUserName,
      invalidateRealtimeQueries,
      removePendingInvite,
      resetFullSessionState,
      sendOfferToUser,
      sendSignal,
      setRemoteParticipants,
      showBrowserNotification,
      startRinging,
      stopCurrentSession,
      stopRinging,
      syncPresentationSender,
      toast,
    };
  }, [
    applyQueuedCandidates,
    answerOffer,
    buildParticipantList,
    clearCallTimeout,
    cleanupPeerConnection,
    getUserName,
    invalidateRealtimeQueries,
    removePendingInvite,
    resetFullSessionState,
    sendOfferToUser,
    sendSignal,
    setRemoteParticipants,
    showBrowserNotification,
    startRinging,
    stopCurrentSession,
    stopRinging,
    syncPresentationSender,
    toast,
  ]);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare(true);
      return;
    }
    await startScreenShare();
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  useEffect(() => {
    const currentUserId = user?.id;
    if (!currentUserId) return;
    forcedLogoutHandledRef.current = false;

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      const alreadyPrompted = localStorage.getItem(BROWSER_NOTIFICATIONS_PROMPT_KEY) === "1";
      if (!alreadyPrompted) {
        localStorage.setItem(BROWSER_NOTIFICATIONS_PROMPT_KEY, "1");
        void Notification.requestPermission();
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?userId=${currentUserId}`);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const runtime = runtimeRef.current;
        const parsed = JSON.parse(String(event.data || "{}"));
        const type = parsed?.type;
        const payload = parsed?.payload || {};

        if (type === "task:changed") {
          queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
          queryClient.invalidateQueries({ queryKey: [api.tasks.get.path] });
        }

        if (type === "auth:session-revoked") {
          forcedLogoutHandledRef.current = true;
          stopCurrentSession(false);
          toast({
            title: "Session ended",
            description: "This account was signed in on another browser. Please log in again.",
            variant: "destructive",
          });
          window.location.href = withBasePath("login");
          return;
        }

        if (type === "notify" && payload?.title) {
          toast({
            title: String(payload.title),
            description: payload?.description ? String(payload.description) : undefined,
            variant: payload?.variant === "destructive" ? "destructive" : "default",
          });
        }

        if (type === "webrtc:signal") {
          const {
            applyQueuedCandidates,
            answerOffer,
            buildParticipantList,
            clearCallTimeout,
            cleanupPeerConnection,
            getUserName,
            invalidateRealtimeQueries,
            removePendingInvite,
            resetFullSessionState,
            sendOfferToUser,
            sendSignal,
            setRemoteParticipants,
            showBrowserNotification,
            startRinging,
            stopCurrentSession,
            stopRinging,
            syncPresentationSender,
            toast,
          } = runtime;
          const fromUserId = Number(payload?.fromUserId);
          const signal = payload?.signal || {};
          const signalType = signal?.type;
          const signalSessionId = typeof signal?.sessionId === "string" ? signal.sessionId : null;

          if (!Number.isFinite(fromUserId)) {
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "offer") {
            const incomingState: IncomingCallState = {
              fromUserId,
              sdp: signal?.sdp as RTCSessionDescriptionInit,
              sessionId: signalSessionId || buildSessionId(),
              participantIds: Array.isArray(signal?.participantIds)
                ? signal.participantIds.map((entry: unknown) => Number(entry)).filter((entry: number) => Number.isFinite(entry))
                : [fromUserId, currentUserId],
            };

            const isSameSessionExpansion = !!sessionIdRef.current && incomingState.sessionId === sessionIdRef.current && isInCallRef.current;
            if (isSameSessionExpansion) {
              await answerOffer(incomingState, true);
              invalidateRealtimeQueries();
              return;
            }

            if (incomingCallRef.current || isCallingRef.current || isInCallRef.current) {
              sendSignal(fromUserId, { type: "decline", sessionId: incomingState.sessionId });
              invalidateRealtimeQueries();
              return;
            }

            incomingCallRef.current = incomingState;
            setIncomingCall(incomingState);
            setIsCallWindowMinimized(false);
            startRinging("incoming");
            showBrowserNotification("Incoming Call", {
              body: `${getUserName(fromUserId)} is calling you`,
              tag: `incoming-call-${fromUserId}`,
            });
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "answer") {
            const peerEntry = peerEntriesRef.current.get(fromUserId);
            if (peerEntry && signal?.sdp) {
              await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              await applyQueuedCandidates(fromUserId, peerEntry.pc);
              syncPresentationSender(fromUserId);
            }
            removePendingInvite(fromUserId);
            setIsCalling(false);
            setIsInCall(true);
            setCallStartedAt((prev) => prev ?? Date.now());
            stopRinging();
            clearCallTimeout();
            setRemoteParticipants((prev) => (prev.includes(fromUserId) ? prev : [...prev, fromUserId]));

            const allParticipantIds = buildParticipantList([fromUserId]);
            const existingParticipants = allParticipantIds.filter((participantId) => participantId !== currentUserId && participantId !== fromUserId);
            existingParticipants.forEach((participantId) => {
              sendSignal(participantId, {
                type: "participant-joined",
                sessionId: signalSessionId || sessionIdRef.current,
                userId: fromUserId,
                participantIds: allParticipantIds,
              });
            });

            if (isScreenSharingRef.current && screenShareStreamRef.current) {
              sendSignal(fromUserId, {
                type: "screen-share-status",
                sessionId: signalSessionId || sessionIdRef.current,
                status: "started",
                label: screenShareLabelRef.current || "Shared screen",
              });
            }

            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "participant-joined" && signalSessionId && signalSessionId === sessionIdRef.current) {
            const joinedUserId = Number(signal?.userId);
            const participantIds = Array.isArray(signal?.participantIds)
              ? signal.participantIds.map((entry: unknown) => Number(entry)).filter((entry: number) => Number.isFinite(entry))
              : buildParticipantList([joinedUserId]);

            if (Number.isFinite(joinedUserId) && joinedUserId !== currentUserId && !peerEntriesRef.current.has(joinedUserId)) {
              setRemoteParticipants(participantIds.filter((participantId: number) => participantId !== currentUserId));
              await sendOfferToUser(joinedUserId, participantIds);
            }
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "ice-candidate" && signal?.candidate) {
            const peerEntry = peerEntriesRef.current.get(fromUserId);
            if (peerEntry && peerEntry.pc.remoteDescription) {
              await peerEntry.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
              const queued = queuedCandidatesByUserIdRef.current.get(fromUserId) || [];
              queued.push(signal.candidate);
              queuedCandidatesByUserIdRef.current.set(fromUserId, queued);
            }
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "screen-share-status") {
            const status = signal?.status === "started" ? "started" : signal?.status === "stopped" ? "stopped" : null;
            if (status && signalSessionId === sessionIdRef.current) {
              if (status === "started") {
                const label = getScreenShareLabel(typeof signal?.label === "string" ? signal.label : "");
                remotePresenterLabelsRef.current.set(fromUserId, label);
                setActiveRemotePresenterUserId(fromUserId);
                setIsRemoteScreenSharing(true);
                setRemoteScreenShareLabel(label);
              } else {
                removeRemotePresentationForUser(fromUserId);
              }
            }
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "hangup") {
            cleanupPeerConnection(fromUserId);
            toast({
              title: "Participant left",
              description: `${getUserName(fromUserId)} left the call.`,
            });
            if (peerEntriesRef.current.size === 0 && pendingInviteIdsRef.current.length === 0) {
              resetFullSessionState();
            }
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "decline") {
            removePendingInvite(fromUserId);
            toast({
              title: "Call declined",
              description: `${getUserName(fromUserId)} declined the call.`,
            });
            if (peerEntriesRef.current.size === 0 && pendingInviteIdsRef.current.length === 0) {
              stopCurrentSession(false);
            }
          }
        }
      } catch {
        // Ignore malformed realtime packets.
      } finally {
        invalidateRealtimeQueries();
      }
    };

    ws.onclose = (event) => {
      if (event.code === 4001 && !forcedLogoutHandledRef.current) {
        forcedLogoutHandledRef.current = true;
        stopCurrentSession(false);
        toast({
          title: "Session ended",
          description: "This account is no longer active in this browser. Please log in again.",
          variant: "destructive",
        });
        window.location.href = withBasePath("login");
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [queryClient, user?.id]);

  useEffect(() => {
    if (!incomingCall || isInCall) return;
    const ensureRing = () => startRinging("incoming");
    window.addEventListener("pointerdown", ensureRing, { once: true });
    window.addEventListener("keydown", ensureRing, { once: true });
    return () => {
      window.removeEventListener("pointerdown", ensureRing);
      window.removeEventListener("keydown", ensureRing);
    };
  }, [incomingCall, isInCall, startRinging]);

  useEffect(() => {
    if (!isScreenSharing || !screenShareStreamRef.current) {
      setElementStream(localPresentationVideoRef.current, null);
      return;
    }
    setElementStream(localPresentationVideoRef.current, screenShareStreamRef.current);
  }, [isScreenSharing]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsPresentationFullscreen(document.fullscreenElement === presentationStageRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!isInCall || !callStartedAt) {
      setCallDurationSec(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setCallDurationSec(Math.floor((Date.now() - callStartedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isInCall, callStartedAt]);

  useEffect(() => {
    return () => {
      stopCurrentSession(false);
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stopCurrentSession]);

  const primaryRemoteUserId = incomingCall?.fromUserId ?? remoteParticipantIds[0] ?? pendingInviteIds[0] ?? null;
  const isBusy = !!incomingCall || isCalling || isInCall;
  const sessionParticipantIds = Array.from(new Set(
    [user?.id, ...remoteParticipantIds, ...pendingInviteIds].filter((id): id is number => typeof id === "number" && Number.isFinite(id))
  ));
  const primaryRemoteName = getUserName(primaryRemoteUserId);
  const primaryRemoteInitials = primaryRemoteName
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const shouldShowPresentationStage = isScreenSharing || isRemoteScreenSharing || isStartingScreenShare;
  const activeRemotePresentationStream = activeRemotePresenterUserId
    ? remotePresentationStreamsRef.current.get(activeRemotePresenterUserId) || null
    : null;
  const availableInvitees = (users || [])
    .filter((entry) => entry.id !== user?.id)
    .filter((entry) => !isDeletedCallUser(entry))
    .filter((entry) => !remoteParticipantIds.includes(entry.id))
    .filter((entry) => !pendingInviteIds.includes(entry.id));
  const filteredInvitees = availableInvitees.filter((entry) => {
    const query = inviteSearch.trim().toLowerCase();
    if (!query) return true;
    const haystack = `${entry.name || ""} ${entry.email || ""} ${entry.role || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  const contextValue = useMemo<CallContextValue>(() => ({
    callUserId: primaryRemoteUserId,
    isBusy,
    isCalling,
    isInCall,
    isMuted,
    isScreenSharing,
    isStartingScreenShare,
    isRemoteScreenSharing,
    callDurationSec,
    startCall,
    acceptIncomingCall,
    declineIncomingCall,
    endCall: () => stopCurrentSession(true),
    toggleMute,
    toggleScreenShare,
  }), [
    acceptIncomingCall,
    callDurationSec,
    declineIncomingCall,
    isBusy,
    isCalling,
    isInCall,
    isMuted,
    isRemoteScreenSharing,
    isScreenSharing,
    isStartingScreenShare,
    primaryRemoteUserId,
    startCall,
    stopCurrentSession,
    toggleMute,
    toggleScreenShare,
  ]);

  return (
    <CallContext.Provider value={contextValue}>
      {children}
      {remoteAudioUserIds.map((remoteAudioUserId) => (
        <audio
          key={`remote-audio-${remoteAudioUserId}`}
          ref={(element) => bindRemoteAudioElement(remoteAudioUserId, element)}
          autoPlay
          playsInline
        />
      ))}

      {isBusy && !isCallWindowMinimized && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/12 p-4 backdrop-blur-[1px]"
          onClick={() => {
            if (!incomingCall) {
              setIsCallWindowMinimized(true);
            }
          }}
        >
          <div
            className="max-h-[calc(100vh-2rem)] w-[min(92vw,880px)] overflow-hidden rounded-3xl border border-border/70 bg-background shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border/70 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-5 text-slate-50">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14 border border-white/15 bg-white/10">
                    <AvatarFallback className="bg-white/10 text-sm font-semibold text-slate-100">
                      {primaryRemoteInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-lg font-semibold">
                      {incomingCall ? "Incoming call" : isInCall ? "Call in progress" : "Calling..."}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      {incomingCall
                        ? `${primaryRemoteName} wants to connect with you.`
                        : isInCall
                          ? `You can keep using chat and the rest of the app while the call stays here.`
                          : `Trying to connect with ${primaryRemoteName}...`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-100">
                    {isInCall ? formatCallDuration(callDurationSec) : "Connecting"}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                    {sessionParticipantIds.length} participant{sessionParticipantIds.length === 1 ? "" : "s"}
                  </div>
                  {!incomingCall && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="border border-white/10 bg-white/10 text-slate-50 hover:bg-white/15 hover:text-slate-50"
                      onClick={() => setIsCallWindowMinimized(true)}
                    >
                      <Minimize2 className="mr-2 h-4 w-4" />
                      Minimize
                    </Button>
                  )}
                </div>
              </div>

              {sessionParticipantIds.length > 1 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {sessionParticipantIds.map((participantId) => {
                    const participantName = participantId === user?.id ? "You" : getUserName(participantId);
                    const isPending = pendingInviteIds.includes(participantId);
                    return (
                      <div
                        key={`participant-${participantId}`}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs text-slate-100"
                      >
                        <Users className="h-3.5 w-3.5 text-slate-300" />
                        <span>{participantName}</span>
                        {isPending && <span className="text-slate-400">Inviting</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-5">
              {shouldShowPresentationStage ? (
                <div
                  ref={presentationStageRef}
                  className="overflow-hidden rounded-3xl border border-border/70 bg-slate-950"
                >
                  <div className="flex flex-col gap-3 border-b border-white/10 bg-white/5 px-4 py-3 text-slate-50 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-100">
                        <Presentation className="h-3.5 w-3.5" />
                        <span>
                          {isStartingScreenShare
                            ? "Preparing share"
                            : isScreenSharing
                              ? "You're presenting"
                              : `${getUserName(activeRemotePresenterUserId)} is presenting`}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm font-medium text-slate-100">
                        {isScreenSharing ? screenShareLabel : remoteScreenShareLabel || "Choose a screen, tab, or window to present."}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        {isScreenSharing
                          ? "Screen share is live and the call controls stay available below."
                          : "Remote presentation stays pinned here while you keep using the app."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="border border-white/10 bg-white/10 text-slate-50 hover:bg-white/15 hover:text-slate-50"
                        onClick={() => void togglePresentationFullscreen()}
                      >
                        {isPresentationFullscreen ? (
                          <Minimize2 className="mr-2 h-4 w-4" />
                        ) : (
                          <Maximize2 className="mr-2 h-4 w-4" />
                        )}
                        {isPresentationFullscreen ? "Exit full screen" : "Full screen"}
                      </Button>
                    </div>
                  </div>

                  <div className="aspect-video w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_rgba(15,23,42,0.92)_60%)]">
                    {isScreenSharing ? (
                      <video
                        ref={localPresentationVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full bg-black object-contain"
                      />
                    ) : activeRemotePresentationStream ? (
                      <video
                        ref={remotePresentationVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full bg-black object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center text-slate-100">
                        {isStartingScreenShare ? (
                          <Loader2 className="h-8 w-8 animate-spin text-slate-200" />
                        ) : (
                          <ScreenShare className="h-8 w-8 text-slate-200" />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {isStartingScreenShare ? "Opening your browser share picker..." : "Waiting for the shared screen feed"}
                          </p>
                          <p className="mt-1 text-xs text-slate-300">
                            We will only show the presentation here after screen sharing actually starts.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-border/70 bg-muted/20 px-6 py-10">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="relative">
                      <div className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
                      <Avatar className="relative h-24 w-24 border border-border/60 bg-primary/5">
                        <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">
                          {primaryRemoteInitials}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <p className="mt-5 text-lg font-semibold text-foreground">{primaryRemoteName}</p>
                    <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                      {incomingCall
                        ? "Accept or decline from here. Once connected, mute, screen share, add people, and end call all stay in this same call window."
                        : isInCall
                          ? "Use Minimize to check chat or any other flow while the call keeps running."
                          : "We're trying to connect the call. You can minimize this window if you want to keep browsing the app."}
                    </p>
                  </div>
                </div>
              )}

              {incomingCall ? (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-32"
                    onClick={declineIncomingCall}
                  >
                    <PhoneOff className="mr-2 h-4 w-4" />
                    Decline
                  </Button>
                  <Button
                    type="button"
                    className="min-w-32 bg-emerald-600 text-white hover:bg-emerald-500"
                    onClick={() => void acceptIncomingCall()}
                  >
                    <Phone className="mr-2 h-4 w-4" />
                    Accept
                  </Button>
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant={isMuted ? "default" : "outline"}
                    className="min-w-32"
                    disabled={!isInCall}
                    onClick={toggleMute}
                  >
                    {isMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                    {isMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button
                    type="button"
                    variant={isScreenSharing ? "default" : "outline"}
                    className="min-w-40"
                    disabled={!isInCall || isStartingScreenShare || (!isScreenSharing && isRemoteScreenSharing)}
                    onClick={() => void toggleScreenShare()}
                  >
                    {isStartingScreenShare ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : isScreenSharing ? (
                      <ScreenShareOff className="mr-2 h-4 w-4" />
                    ) : (
                      <ScreenShare className="mr-2 h-4 w-4" />
                    )}
                    {isScreenSharing ? "Stop sharing" : "Share screen"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-w-36"
                    disabled={!sessionIdRef.current}
                    onClick={() => setIsAddPeopleOpen(true)}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add people
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-w-32"
                    onClick={() => stopCurrentSession(true)}
                  >
                    <PhoneOff className="mr-2 h-4 w-4" />
                    {isInCall ? "End call" : "Cancel"}
                  </Button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {isBusy && isAddPeopleOpen && !incomingCall && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/25 p-4"
          onClick={() => {
            setIsAddPeopleOpen(false);
            setInviteSearch("");
            setSelectedInviteeIds([]);
          }}
        >
          <div
            className="w-[min(92vw,34rem)] rounded-3xl border border-border/70 bg-background shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border/70 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-foreground">Add more people</p>
                  <p className="mt-1 text-sm text-muted-foreground">Search teammates and invite them into the current call.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddPeopleOpen(false);
                    setInviteSearch("");
                    setSelectedInviteeIds([]);
                  }}
                >
                  Close
                </Button>
              </div>
              <Input
                value={inviteSearch}
                onChange={(event) => setInviteSearch(event.target.value)}
                placeholder="Search by name or email..."
                className="mt-4"
              />
            </div>

            <div className="max-h-[22rem] space-y-2 overflow-y-auto px-5 py-4">
              {filteredInvitees.map((member) => {
                const isSelected = selectedInviteeIds.includes(member.id);
                return (
                  <button
                    key={`invitee-${member.id}`}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                    }`}
                    onClick={() => {
                      setSelectedInviteeIds((prev) => {
                        if (prev.includes(member.id)) {
                          return prev.filter((id) => id !== member.id);
                        }
                        return [...prev, member.id];
                      });
                    }}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.email || member.role || "Team member"}</p>
                    </div>
                    <div className={`rounded-full px-2 py-1 text-[11px] font-medium ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {isSelected ? "Selected" : "Tap to add"}
                    </div>
                  </button>
                );
              })}

              {filteredInvitees.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {availableInvitees.length === 0
                    ? "No more teammates are available to add right now."
                    : "No teammate matched your search."}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddPeopleOpen(false);
                  setInviteSearch("");
                  setSelectedInviteeIds([]);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={selectedInviteeIds.length === 0}
                onClick={() => {
                  void inviteParticipants(selectedInviteeIds);
                  setIsAddPeopleOpen(false);
                  setInviteSearch("");
                  setSelectedInviteeIds([]);
                }}
              >
                Add to call
              </Button>
            </div>
          </div>
        </div>
      )}

      {isBusy && isCallWindowMinimized && !incomingCall && (
        <div className="fixed bottom-4 right-4 z-[120] flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-2 shadow-[0_20px_50px_rgba(15,23,42,0.25)]">
          <div className="px-1">
            <p className="text-sm font-medium text-foreground">{isInCall ? primaryRemoteName : "Call in progress"}</p>
            <p className="text-xs text-muted-foreground">{isInCall ? formatCallDuration(callDurationSec) : "Connecting"}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setIsCallWindowMinimized(false)}>
            <Maximize2 className="mr-2 h-4 w-4" />
            Open
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => stopCurrentSession(true)}>
            <PhoneOff className="h-4 w-4" />
          </Button>
        </div>
      )}
    </CallContext.Provider>
  );
}
