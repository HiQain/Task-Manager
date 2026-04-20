import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, Presentation, ScreenShare, ScreenShareOff } from "lucide-react";
import { api } from "@shared/routes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useUsers } from "@/hooks/use-users";

const PENDING_CALL_STORAGE_KEY = "pending_incoming_call_v1";
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

const CallContext = createContext<CallContextValue | null>(null);

function setElementStream(element: HTMLMediaElement | null, stream: MediaStream | null) {
  if (!element) return;
  element.srcObject = stream;
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
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const remotePresentationStreamRef = useRef<MediaStream | null>(null);
  const remotePresentationTrackRef = useRef<MediaStreamTrack | null>(null);
  const presentationSenderRef = useRef<RTCRtpSender | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingOfferFromRef = useRef<number | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const connectedPeerUserIdRef = useRef<number | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localPresentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const remotePresentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const presentationStageRef = useRef<HTMLDivElement | null>(null);
  const usersRef = useRef<Array<{ id: number; name: string }>>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const disconnectTimeoutRef = useRef<number | null>(null);
  const isCallingRef = useRef(false);
  const isInCallRef = useRef(false);
  const isAcceptingIncomingCallRef = useRef(false);
  const isStoppingScreenShareRef = useRef(false);
  const [incomingCallFromUserId, setIncomingCallFromUserId] = useState<number | null>(null);
  const [connectedPeerUserId, setConnectedPeerUserId] = useState<number | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isStartingScreenShare, setIsStartingScreenShare] = useState(false);
  const [isAcceptingIncomingCall, setIsAcceptingIncomingCall] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [hasRemotePresentationVideo, setHasRemotePresentationVideo] = useState(false);
  const [screenShareLabel, setScreenShareLabel] = useState("");
  const [remoteScreenShareLabel, setRemoteScreenShareLabel] = useState("");
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [isPresentationFullscreen, setIsPresentationFullscreen] = useState(false);

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
    isAcceptingIncomingCallRef.current = isAcceptingIncomingCall;
  }, [isAcceptingIncomingCall]);

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

  const clearDisconnectTimeout = useCallback(() => {
    if (disconnectTimeoutRef.current) {
      window.clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
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

  const sendWebrtcSignal = useCallback((toUserId: number, signal: Record<string, unknown>) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "webrtc:signal",
        payload: { toUserId, signal },
      }),
    );
  }, []);

  const syncPresentationSender = useCallback((pc: RTCPeerConnection) => {
    const presentationTransceiver = pc.getTransceivers().find((entry) => entry.receiver.track.kind === "video");
    if (presentationTransceiver) {
      presentationTransceiver.direction = "sendrecv";
      presentationSenderRef.current = presentationTransceiver.sender;
      return;
    }
    presentationSenderRef.current = null;
  }, []);

  const hideRemoteScreenShare = useCallback((preserveReceiverTrack = true) => {
    if (!preserveReceiverTrack && remotePresentationTrackRef.current) {
      remotePresentationTrackRef.current.onended = null;
      remotePresentationTrackRef.current.onmute = null;
      remotePresentationTrackRef.current.onunmute = null;
      remotePresentationTrackRef.current = null;
      remotePresentationStreamRef.current = null;
    }
    setElementStream(remotePresentationVideoRef.current, null);
    setHasRemotePresentationVideo(false);
    setIsRemoteScreenSharing(false);
    setRemoteScreenShareLabel("");
  }, []);

  const activateRemoteScreenShare = useCallback((stream: MediaStream, fallbackLabel?: string | null) => {
    remotePresentationStreamRef.current = stream;
    setElementStream(remotePresentationVideoRef.current, stream);
    setHasRemotePresentationVideo(true);
    setIsRemoteScreenSharing(true);
    setRemoteScreenShareLabel((prev) => prev || getScreenShareLabel(fallbackLabel));
  }, []);

  const stopScreenShare = useCallback((notifyRemote: boolean) => {
    if (isStoppingScreenShareRef.current) return;
    isStoppingScreenShareRef.current = true;

    const activePeerUserId = connectedPeerUserIdRef.current;
    const currentStream = screenShareStreamRef.current;
    const hadActiveShare = !!currentStream;

    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        track.onended = null;
        if (track.readyState !== "ended") {
          track.stop();
        }
      });
    }

    screenShareStreamRef.current = null;
    setElementStream(localPresentationVideoRef.current, null);
    setIsScreenSharing(false);
    setIsStartingScreenShare(false);
    setScreenShareLabel("");

    if (presentationSenderRef.current) {
      void presentationSenderRef.current.replaceTrack(null).catch(() => {
        // Ignore presentation sender cleanup failures.
      });
    }

    if (notifyRemote && hadActiveShare && activePeerUserId) {
      sendWebrtcSignal(activePeerUserId, { type: "screen-share-status", status: "stopped" });
    }

    isStoppingScreenShareRef.current = false;
  }, [sendWebrtcSignal]);

  const stopCurrentSession = useCallback((notifyRemote: boolean, clearPendingOfferStorage = true) => {
    const peerUserId = connectedPeerUserIdRef.current;

    if (notifyRemote && peerUserId) {
      sendWebrtcSignal(peerUserId, { type: "hangup" });
    }

    stopScreenShare(false);
    hideRemoteScreenShare(false);
    clearDisconnectTimeout();

    const currentPeer = peerRef.current;
    peerRef.current = null;
    if (currentPeer) {
      currentPeer.close();
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    presentationSenderRef.current = null;
    setElementStream(remoteAudioRef.current, null);

    queuedCandidatesRef.current = [];
    pendingOfferRef.current = null;
    pendingOfferFromRef.current = null;
    connectedPeerUserIdRef.current = null;
    setIncomingCallFromUserId(null);
    setConnectedPeerUserId(null);
    setIsCalling(false);
    setIsInCall(false);
    setIsMuted(false);
    setIsScreenSharing(false);
    setIsStartingScreenShare(false);
    setIsAcceptingIncomingCall(false);
    setScreenShareLabel("");
    setCallStartedAt(null);
    setCallDurationSec(0);
    stopRinging();
    clearCallTimeout();

    if (clearPendingOfferStorage) {
      try {
        sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
      } catch {
        // Ignore storage cleanup issues.
      }
    }
  }, [clearCallTimeout, clearDisconnectTimeout, hideRemoteScreenShare, sendWebrtcSignal, stopRinging, stopScreenShare]);

  const createPeerConnection = useCallback((targetUserId: number, includePresentationChannel = false) => {
    const existingPeer = peerRef.current;
    peerRef.current = null;
    if (existingPeer) {
      existingPeer.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (includePresentationChannel) {
      const presentationTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      presentationSenderRef.current = presentationTransceiver.sender;
    } else {
      presentationSenderRef.current = null;
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWebrtcSignal(targetUserId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === "video") {
        const nextPresentationStream = new MediaStream([event.track]);
        remotePresentationStreamRef.current = nextPresentationStream;
        remotePresentationTrackRef.current = event.track;
        setHasRemotePresentationVideo(false);

        const handlePresentationReady = () => {
          if (remotePresentationTrackRef.current !== event.track) return;
          activateRemoteScreenShare(nextPresentationStream, event.track.label || "Live screen share");
        };

        if (!event.track.muted && event.track.readyState === "live") {
          handlePresentationReady();
        }

        event.track.onunmute = () => {
          handlePresentationReady();
        };
        event.track.onmute = () => {
          if (remotePresentationTrackRef.current !== event.track) return;
          setElementStream(remotePresentationVideoRef.current, null);
          setHasRemotePresentationVideo(false);
        };
        event.track.onended = () => {
          if (remotePresentationTrackRef.current !== event.track) return;
          hideRemoteScreenShare(false);
        };
        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      remoteStreamRef.current.addTrack(event.track);
      setElementStream(remoteAudioRef.current, remoteStreamRef.current);
      setIsInCall(true);
      setCallStartedAt((prev) => prev ?? Date.now());
    };

    pc.onconnectionstatechange = () => {
      if (peerRef.current !== pc) return;
      if (pc.connectionState === "connected") {
        clearDisconnectTimeout();
        return;
      }

      if (pc.connectionState === "disconnected") {
        clearDisconnectTimeout();
        disconnectTimeoutRef.current = window.setTimeout(() => {
          if (peerRef.current !== pc || pc.connectionState !== "disconnected") return;
          stopCurrentSession(false);
          toast({
            title: "Call lost",
            description: "The connection dropped before the call could recover.",
            variant: "destructive",
          });
        }, 12_000);
        return;
      }

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        clearDisconnectTimeout();
        stopCurrentSession(false);
      }
    };

    peerRef.current = pc;
    connectedPeerUserIdRef.current = targetUserId;
    setConnectedPeerUserId(targetUserId);
    return pc;
  }, [activateRemoteScreenShare, clearDisconnectTimeout, hideRemoteScreenShare, sendWebrtcSignal, stopCurrentSession, toast]);

  const startCall = useCallback(async (userId: number) => {
    if (!userId) {
      toast({
        title: "Select user first",
        description: "Pick a chat user before calling.",
        variant: "destructive",
      });
      return;
    }

    if (incomingCallFromUserId || isCallingRef.current || isInCallRef.current || isAcceptingIncomingCallRef.current) {
      toast({
        title: "Call already active",
        description: "Finish the current call before starting a new one.",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      setIsCalling(true);
      setConnectedPeerUserId(userId);
      connectedPeerUserIdRef.current = userId;

      const pc = createPeerConnection(userId, true);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWebrtcSignal(userId, { type: "offer", sdp: offer });
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
      toast({
        title: "Call failed",
        description: "Could not access microphone.",
        variant: "destructive",
      });
      stopCurrentSession(false);
    }
  }, [clearCallTimeout, createPeerConnection, incomingCallFromUserId, sendWebrtcSignal, startRinging, stopCurrentSession, toast]);

  const acceptIncomingCall = useCallback(async () => {
    const fromUserId = pendingOfferFromRef.current;
    const offer = pendingOfferRef.current;
    if (!fromUserId || !offer || isAcceptingIncomingCallRef.current) return;

    setIsAcceptingIncomingCall(true);
    stopRinging();
    pendingOfferFromRef.current = null;
    pendingOfferRef.current = null;
    try {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup issues.
    }

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
      syncPresentationSender(pc);

      for (const candidate of queuedCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      queuedCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebrtcSignal(fromUserId, { type: "answer", sdp: answer });
      setIncomingCallFromUserId(null);
      setIsCalling(false);
      setIsInCall(true);
      setCallStartedAt(Date.now());
    } catch {
      toast({
        title: "Unable to join call",
        description: "Microphone access failed or call setup error.",
        variant: "destructive",
      });
      stopCurrentSession(false);
    } finally {
      setIsAcceptingIncomingCall(false);
    }
  }, [createPeerConnection, isMuted, sendWebrtcSignal, stopCurrentSession, stopRinging, syncPresentationSender, toast]);

  const declineIncomingCall = useCallback(() => {
    const fromUserId = pendingOfferFromRef.current;
    if (fromUserId) {
      sendWebrtcSignal(fromUserId, { type: "decline" });
    }
    pendingOfferFromRef.current = null;
    pendingOfferRef.current = null;
    setIsAcceptingIncomingCall(false);
    setIncomingCallFromUserId(null);
    stopRinging();
    try {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup issues.
    }
  }, [sendWebrtcSignal, stopRinging]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
    }
  }, [isMuted]);

  const startScreenShare = useCallback(async () => {
    if (!isInCall || !peerRef.current || !connectedPeerUserIdRef.current) {
      toast({
        title: "Join call first",
        description: "Start or accept a call before sharing your screen.",
        variant: "destructive",
      });
      return;
    }

    if (isRemoteScreenSharing) {
      const remoteName = usersRef.current.find((member) => member.id === connectedPeerUserIdRef.current)?.name || "The other user";
      toast({
        title: "Presentation already live",
        description: `${remoteName} is already presenting.`,
      });
      return;
    }

    if (isStartingScreenShare) return;

    const sender = presentationSenderRef.current;
    if (!sender) {
      toast({
        title: "Screen share unavailable",
        description: "Presentation channel is not ready yet. Please retry in a moment.",
        variant: "destructive",
      });
      return;
    }

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
      setIsScreenSharing(true);
      setElementStream(localPresentationVideoRef.current, screenStream);
      await sender.replaceTrack(videoTrack);
      sendWebrtcSignal(connectedPeerUserIdRef.current, {
        type: "screen-share-status",
        status: "started",
        label: getScreenShareLabel(videoTrack.label),
      });
      toast({
        title: "Screen sharing started",
        description: "Your screen is now visible to the other participant.",
      });
    } catch (error) {
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current.getTracks().forEach((track) => track.stop());
        screenShareStreamRef.current = null;
      }
      setIsScreenSharing(false);
      setScreenShareLabel("");
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
  }, [isInCall, isRemoteScreenSharing, isStartingScreenShare, sendWebrtcSignal, stopScreenShare, toast]);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare(true);
      return;
    }
    await startScreenShare();
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  useEffect(() => {
    if (!user?.id) return;

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      const alreadyPrompted = localStorage.getItem(BROWSER_NOTIFICATIONS_PROMPT_KEY) === "1";
      if (!alreadyPrompted) {
        localStorage.setItem(BROWSER_NOTIFICATIONS_PROMPT_KEY, "1");
        void Notification.requestPermission();
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?userId=${user.id}`);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const parsed = JSON.parse(String(event.data || "{}"));
        const type = parsed?.type;
        const payload = parsed?.payload || {};

        if (type === "task:changed") {
          queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
          queryClient.invalidateQueries({ queryKey: [api.tasks.get.path] });
        }

        if (type === "notify" && payload?.title) {
          toast({
            title: String(payload.title),
            description: payload?.description ? String(payload.description) : undefined,
            variant: payload?.variant === "destructive" ? "destructive" : "default",
          });
        }

        if (type === "webrtc:signal") {
          const fromUserId = Number(payload?.fromUserId);
          const signal = payload?.signal || {};
          const signalType = signal?.type;

          if (!Number.isFinite(fromUserId)) {
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "offer") {
            if (isAcceptingIncomingCallRef.current) {
              invalidateRealtimeQueries();
              return;
            }

            if (isCallingRef.current || isInCallRef.current) {
              sendWebrtcSignal(fromUserId, { type: "decline" });
              invalidateRealtimeQueries();
              return;
            }

            try {
              sessionStorage.setItem(
                PENDING_CALL_STORAGE_KEY,
                JSON.stringify({
                  fromUserId,
                  sdp: signal?.sdp,
                  createdAt: Date.now(),
                }),
              );
            } catch {
              // Ignore storage sync issues.
            }

            pendingOfferFromRef.current = fromUserId;
            pendingOfferRef.current = signal?.sdp;
            setIncomingCallFromUserId(fromUserId);
            startRinging("incoming");

            const callerName = usersRef.current.find((member) => member.id === fromUserId)?.name || `User ${fromUserId}`;
            showBrowserNotification("Incoming Call", {
              body: `${callerName} is calling you`,
              tag: `incoming-call-${fromUserId}`,
            });

            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "answer") {
            if (peerRef.current && signal?.sdp) {
              await peerRef.current.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              syncPresentationSender(peerRef.current);
            }
            setIsCalling(false);
            setIsInCall(true);
            setCallStartedAt(Date.now());
            stopRinging();
            clearCallTimeout();
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "ice-candidate" && signal?.candidate) {
            if (peerRef.current && peerRef.current.remoteDescription) {
              await peerRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
              queuedCandidatesRef.current.push(signal.candidate);
            }
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "screen-share-status") {
            const status = signal?.status === "started" ? "started" : signal?.status === "stopped" ? "stopped" : null;
            if (status) {
              const presenterName = usersRef.current.find((member) => member.id === fromUserId)?.name || "User";
              if (status === "started") {
                const incomingLabel = getScreenShareLabel(typeof signal?.label === "string" ? signal.label : "");
                setIsRemoteScreenSharing(true);
                setRemoteScreenShareLabel(incomingLabel);
                if (
                  remotePresentationTrackRef.current &&
                  remotePresentationStreamRef.current &&
                  !remotePresentationTrackRef.current.muted &&
                  remotePresentationTrackRef.current.readyState === "live"
                ) {
                  activateRemoteScreenShare(remotePresentationStreamRef.current, incomingLabel);
                }
                toast({
                  title: "Screen sharing started",
                  description: `${presenterName} is presenting now.`,
                });
              } else {
                hideRemoteScreenShare();
                toast({
                  title: "Screen sharing stopped",
                  description: `${presenterName} stopped presenting.`,
                });
              }
            }
            invalidateRealtimeQueries();
            return;
          }

          if (signalType === "hangup" || signalType === "decline") {
            const endedByName = usersRef.current.find((member) => member.id === fromUserId)?.name || "User";
            try {
              sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
            } catch {
              // Ignore storage cleanup issues.
            }
            stopCurrentSession(false);
            toast({
              title: "Call ended",
              description: signalType === "decline"
                ? `${endedByName} declined the call.`
                : `${endedByName} ended the call.`,
            });
          }
        }
      } catch {
        // Ignore malformed realtime packets.
      } finally {
        invalidateRealtimeQueries();
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [activateRemoteScreenShare, clearCallTimeout, hideRemoteScreenShare, invalidateRealtimeQueries, queryClient, sendWebrtcSignal, showBrowserNotification, startRinging, stopCurrentSession, stopRinging, syncPresentationSender, toast, user?.id]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_CALL_STORAGE_KEY);
      if (!raw || incomingCallFromUserId || isCalling || isInCall || isAcceptingIncomingCall) return;
      const parsed = JSON.parse(raw) as { fromUserId?: unknown; sdp?: unknown; createdAt?: unknown };
      const fromUserId = Number(parsed?.fromUserId);
      const createdAt = Number(parsed?.createdAt);
      const sdp = parsed?.sdp;
      const isFresh = Number.isFinite(createdAt) ? Date.now() - createdAt < 45_000 : true;
      const isValidSdp = !!sdp && typeof sdp === "object";
      if (!Number.isFinite(fromUserId) || !isValidSdp || !isFresh) {
        sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
        return;
      }
      pendingOfferFromRef.current = fromUserId;
      pendingOfferRef.current = sdp as RTCSessionDescriptionInit;
      setIncomingCallFromUserId(fromUserId);
      startRinging("incoming");
    } catch {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    }
  }, [incomingCallFromUserId, isAcceptingIncomingCall, isCalling, isInCall, startRinging]);

  useEffect(() => {
    if (!incomingCallFromUserId || isInCall) return;
    const ensureRing = () => startRinging("incoming");
    window.addEventListener("pointerdown", ensureRing, { once: true });
    window.addEventListener("keydown", ensureRing, { once: true });
    return () => {
      window.removeEventListener("pointerdown", ensureRing);
      window.removeEventListener("keydown", ensureRing);
    };
  }, [incomingCallFromUserId, isInCall, startRinging]);

  useEffect(() => {
    if (!isScreenSharing || !screenShareStreamRef.current) {
      setElementStream(localPresentationVideoRef.current, null);
      return;
    }
    setElementStream(localPresentationVideoRef.current, screenShareStreamRef.current);
  }, [isScreenSharing]);

  useEffect(() => {
    if (!hasRemotePresentationVideo || !remotePresentationStreamRef.current) {
      setElementStream(remotePresentationVideoRef.current, null);
      return;
    }
    setElementStream(remotePresentationVideoRef.current, remotePresentationStreamRef.current);
  }, [hasRemotePresentationVideo]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (typeof document === "undefined") return;
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
      const hasPendingIncomingOffer = !!pendingOfferRef.current && !!pendingOfferFromRef.current;
      stopCurrentSession(false, !hasPendingIncomingOffer);
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stopCurrentSession]);

  const callUserId = incomingCallFromUserId ?? connectedPeerUserId;
  const isBusy = !!incomingCallFromUserId || isCalling || isInCall || isAcceptingIncomingCall;
  const isDialogVisible = isBusy;
  const callUser = callUserId ? (users || []).find((entry) => entry.id === callUserId) : null;
  const callUserName = callUser?.name || (callUserId ? `User ${callUserId}` : "Unknown user");
  const callUserInitials = callUserName
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const callStatusTitle = incomingCallFromUserId
    ? (isAcceptingIncomingCall ? "Joining call..." : "Incoming call")
    : isInCall
      ? "Call in progress"
      : isAcceptingIncomingCall
        ? "Joining call..."
        : "Calling...";
  const callStatusDescription = incomingCallFromUserId
    ? (isAcceptingIncomingCall
      ? `Connecting you with ${callUserName}...`
      : `${callUserName} wants to connect with you.`)
    : isInCall
      ? `You're connected with ${callUserName}.`
      : isAcceptingIncomingCall
        ? `Connecting you with ${callUserName}...`
        : `Trying to connect with ${callUserName}...`;
  const presentationOwnerLabel = isScreenSharing ? "You're presenting" : `${callUserName} is presenting`;
  const presentationHint = isScreenSharing
    ? "Your screen is being shared and stays pinned inside this call dialog."
    : isRemoteScreenSharing
      ? "The shared screen stays in focus here, no matter which page you open."
      : "Start screen sharing from below when the call connects.";
  const presentationSourceLabel = isScreenSharing ? screenShareLabel : remoteScreenShareLabel;
  const shouldShowPresentationStage = isScreenSharing || hasRemotePresentationVideo;
  const canTogglePresentationFullscreen = typeof document !== "undefined" && document.fullscreenEnabled !== false;

  useEffect(() => {
    if (isBusy) return;
    if (typeof document === "undefined") return;
    if (document.fullscreenElement !== presentationStageRef.current) return;
    void document.exitFullscreen().catch(() => {
      // Ignore fullscreen cleanup issues when the dialog closes.
    });
  }, [isBusy]);

  const togglePresentationFullscreen = useCallback(async () => {
    const stageElement = presentationStageRef.current;
    if (!stageElement || typeof document === "undefined") return;

    try {
      if (document.fullscreenElement === stageElement) {
        await document.exitFullscreen();
      } else {
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

  const contextValue = useMemo<CallContextValue>(() => ({
    callUserId,
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
    callUserId,
    declineIncomingCall,
    isBusy,
    isCalling,
    isInCall,
    isMuted,
    isRemoteScreenSharing,
    isScreenSharing,
    isStartingScreenShare,
    startCall,
    stopCurrentSession,
    toggleMute,
    toggleScreenShare,
  ]);

  return (
    <CallContext.Provider value={contextValue}>
      {children}
      <audio ref={remoteAudioRef} autoPlay />

      <Dialog open={isDialogVisible} onOpenChange={() => {}}>
        <DialogContent
          className="!fixed !left-1/2 !top-1/2 !z-[200] !m-0 !max-h-[92vh] !w-[calc(100vw-1.5rem)] sm:!w-[44rem] xl:!w-[64rem] !max-w-[64rem] !translate-x-[-50%] !translate-y-[-50%] overflow-hidden border-border/70 p-0 shadow-2xl sm:rounded-3xl [&>button.absolute]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
            <div className="border-b border-white/10 px-6 py-5">
              <DialogHeader className="space-y-0 text-left">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 border border-white/15 bg-white/10">
                      <AvatarFallback className="bg-white/10 text-sm font-semibold text-slate-100">
                        {callUserInitials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <DialogTitle className="text-xl text-slate-50">
                        {callStatusTitle}
                      </DialogTitle>
                      <DialogDescription className="mt-1 text-slate-300">
                        {callStatusDescription}
                      </DialogDescription>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-100">
                      {isInCall ? formatCallDuration(callDurationSec) : isAcceptingIncomingCall ? "Joining" : "Connecting"}
                    </div>
                    {isInCall && (
                      <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
                        {isScreenSharing
                          ? "You are presenting"
                          : isRemoteScreenSharing
                            ? `${callUserName} is presenting`
                            : (isMuted ? "Mic muted" : "Mic active")}
                      </div>
                    )}
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="space-y-5 px-6 py-6">
              {shouldShowPresentationStage ? (
                <div
                  ref={presentationStageRef}
                  className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.45)]"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-100">
                        <Presentation className="h-3.5 w-3.5" />
                        <span>{presentationOwnerLabel}</span>
                      </div>
                      <p className="mt-2 truncate text-sm font-medium text-slate-100">
                        {presentationSourceLabel || "Choose a screen, tab, or window to present."}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        {presentationHint}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {canTogglePresentationFullscreen && (
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
                      )}
                      {isScreenSharing && (
                        <Button
                          type="button"
                          variant="secondary"
                          className="border border-white/10 bg-white/10 text-slate-50 hover:bg-white/15 hover:text-slate-50"
                          onClick={() => void toggleScreenShare()}
                        >
                          <ScreenShareOff className="mr-2 h-4 w-4" />
                          Stop sharing
                        </Button>
                      )}
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
                    ) : hasRemotePresentationVideo ? (
                      <video
                        ref={remotePresentationVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full bg-black object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
                        {isStartingScreenShare ? (
                          <Loader2 className="h-9 w-9 animate-spin text-slate-200" />
                        ) : (
                          <ScreenShare className="h-9 w-9 text-slate-200" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-100">
                            {isStartingScreenShare ? "Opening your browser share picker..." : "Waiting for the shared screen feed"}
                          </p>
                          <p className="mt-1 text-xs text-slate-300">
                            The screen stream will appear here as soon as it becomes available.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-10">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="relative">
                      <div className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
                      <Avatar className="relative h-24 w-24 border border-white/10 bg-white/10">
                        <AvatarFallback className="bg-white/10 text-2xl font-semibold text-slate-100">
                          {callUserInitials}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <p className="mt-5 text-lg font-semibold text-slate-50">{callUserName}</p>
                    <p className="mt-2 max-w-md text-sm text-slate-300">
                      {incomingCallFromUserId
                        ? "Accept the call to join instantly, or decline if you're not ready."
                        : isStartingScreenShare
                          ? "Choose a screen, tab, or window from the browser picker. The presentation panel will appear right after sharing starts."
                        : isInCall
                          ? "Call controls stay here, so you can keep working anywhere else in the app."
                          : "We're trying to connect the call. Once connected, mute, timer, and screen share will stay in this same dialog."}
                    </p>
                  </div>
                </div>
              )}

              {incomingCallFromUserId ? (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-32 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-slate-50"
                    disabled={isAcceptingIncomingCall}
                    onClick={declineIncomingCall}
                  >
                    <PhoneOff className="mr-2 h-4 w-4" />
                    Decline
                  </Button>
                  <Button
                    type="button"
                    className="min-w-32 bg-emerald-500 text-white hover:bg-emerald-400"
                    disabled={isAcceptingIncomingCall}
                    onClick={() => void acceptIncomingCall()}
                  >
                    {isAcceptingIncomingCall ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Phone className="mr-2 h-4 w-4" />
                    )}
                    {isAcceptingIncomingCall ? "Joining..." : "Accept"}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant={isMuted ? "default" : "outline"}
                    className={isMuted ? "min-w-32 bg-amber-500 text-white hover:bg-amber-400" : "min-w-32 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-slate-50"}
                    disabled={!isInCall}
                    onClick={toggleMute}
                  >
                    {isMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                    {isMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button
                    type="button"
                    variant={isScreenSharing ? "default" : "outline"}
                    className={isScreenSharing ? "min-w-40 bg-blue-600 text-white hover:bg-blue-500" : "min-w-40 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-slate-50"}
                    disabled={!isInCall || isCalling || isStartingScreenShare || (!isScreenSharing && isRemoteScreenSharing)}
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
        </DialogContent>
      </Dialog>
    </CallContext.Provider>
  );
}
