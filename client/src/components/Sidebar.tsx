import { Link, useLocation } from "wouter";
import { Bell, LayoutDashboard, Kanban, ListTodo, Plus, Users, Shield, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadCounts } from "@/hooks/use-chat";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useNotificationUnreadCount } from "@/hooks/use-notifications";
import { useUsers } from "@/hooks/use-users";

const PENDING_CALL_STORAGE_KEY = "pending_incoming_call_v1";
type IncomingCallState = {
  fromUserId: number;
  sdp: RTCSessionDescriptionInit;
};

export function Sidebar({
  onNewTask,
  mobileOpen,
  onMobileOpenChange,
}: {
  onNewTask: () => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: unreadCounts } = useUnreadCounts();
  const { data: users } = useUsers();
  const { data: notificationsUnread } = useNotificationUnreadCount();
  const totalUnread = unreadCounts?.total || 0;
  const notificationUnreadCount = notificationsUnread?.count || 0;
  const wsRef = useRef<WebSocket | null>(null);
  const locationRef = useRef(location);
  const isInCallRef = useRef(false);
  const isCallConnectingRef = useRef(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [isCallConnecting, setIsCallConnecting] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [connectedPeerUserId, setConnectedPeerUserId] = useState<number | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

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
    if (notifyRemote && connectedPeerUserId) {
      sendWebrtcSignal(connectedPeerUserId, { type: "hangup" });
    }

    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    queuedCandidatesRef.current = [];

    setIncomingCall(null);
    setIsCallConnecting(false);
    setIsInCall(false);
    setConnectedPeerUserId(null);
    setCallStartedAt(null);
    setCallDurationSec(0);
    try {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    } catch {
      // ignore session storage errors
    }
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
        sendWebrtcSignal(targetUserId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        });
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
      if (!isInCall) {
        setIsInCall(true);
        setCallStartedAt(Date.now());
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        stopCurrentSession(false);
      }
    };

    peerRef.current = pc;
    setConnectedPeerUserId(targetUserId);
    return pc;
  };

  const handleAcceptIncomingCall = async () => {
    if (!incomingCall || isCallConnecting || isInCall) return;
    const fromUserId = incomingCall.fromUserId;
    const offer = incomingCall.sdp;
    setIsCallConnecting(true);
    setIncomingCall(null);
    try {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    } catch {
      // ignore session storage errors
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;

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

      setIsCallConnecting(false);
      setIsInCall(true);
      setCallStartedAt(Date.now());
    } catch {
      sendWebrtcSignal(fromUserId, { type: "decline" });
      toast({
        title: "Unable to join call",
        description: "Microphone access failed or call setup error.",
        variant: "destructive",
      });
      stopCurrentSession(false);
    }
  };

  const handleDeclineIncomingCall = () => {
    if (!incomingCall) return;
    sendWebrtcSignal(incomingCall.fromUserId, { type: "decline" });
    setIncomingCall(null);
    try {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    } catch {
      // ignore session storage errors
    }
  };

  const handleEndCall = () => {
    stopCurrentSession(true);
  };

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  useEffect(() => {
    isCallConnectingRef.current = isCallConnecting;
  }, [isCallConnecting]);

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
    if (!user?.id) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?userId=${user.id}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(String(event.data || "{}"));
      } catch {
        parsed = null;
      }

      const type = parsed?.type;
      const payload = parsed?.payload;

      if (type === "task:changed") {
        queryClient.invalidateQueries({ queryKey: [api.tasks.list.path] });
        queryClient.invalidateQueries({ queryKey: [api.tasks.get.path] });
      }

      if (type === "webrtc:signal") {
        const fromUserId = Number(payload?.fromUserId);
        const signalType = payload?.signal?.type;
        const signalSdp = payload?.signal?.sdp;
        const signalCandidate = payload?.signal?.candidate;

        if (!locationRef.current.startsWith("/chat") && Number.isFinite(fromUserId) && signalType === "offer" && signalSdp && typeof signalSdp === "object") {
          if (isInCallRef.current || isCallConnectingRef.current) {
            sendWebrtcSignal(fromUserId, { type: "decline" });
            return;
          }
          try {
            sessionStorage.setItem(
              PENDING_CALL_STORAGE_KEY,
              JSON.stringify({
                fromUserId,
                sdp: signalSdp,
                createdAt: Date.now(),
              }),
            );
          } catch {
            // ignore session storage errors
          }
          setIncomingCall({ fromUserId, sdp: signalSdp as RTCSessionDescriptionInit });
          return;
        }

        if (locationRef.current.startsWith("/chat") && Number.isFinite(fromUserId) && signalType === "offer" && signalSdp && typeof signalSdp === "object") {
          try {
            sessionStorage.setItem(
              PENDING_CALL_STORAGE_KEY,
              JSON.stringify({
                fromUserId,
                sdp: signalSdp,
                createdAt: Date.now(),
              }),
            );
          } catch {
            // ignore session storage errors
          }
          return;
        }

        if (!locationRef.current.startsWith("/chat") && Number.isFinite(fromUserId) && signalType === "ice-candidate" && signalCandidate) {
          if (peerRef.current && peerRef.current.remoteDescription) {
            void peerRef.current.addIceCandidate(new RTCIceCandidate(signalCandidate));
          } else {
            queuedCandidatesRef.current.push(signalCandidate);
          }
          return;
        }

        if (!locationRef.current.startsWith("/chat") && Number.isFinite(fromUserId) && (signalType === "hangup" || signalType === "decline")) {
          try {
            sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
          } catch {
            // ignore session storage errors
          }
          stopCurrentSession(false);
          return;
        }
      }

      if (type === "notify" && payload?.title) {
        toast({
          title: String(payload.title),
          description: payload?.description ? String(payload.description) : undefined,
          variant: payload?.variant === "destructive" ? "destructive" : "default",
        });
      }

      queryClient.invalidateQueries({ queryKey: [api.chats.unread.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groups.path] });
      queryClient.invalidateQueries({ queryKey: [api.chats.groupsUnread.path] });
      queryClient.invalidateQueries({ queryKey: ["chat", "task-group"] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.notifications.unread.path] });
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.id, queryClient, toast]);

  useEffect(() => {
    if (location.startsWith("/chat")) return;
    if (incomingCall || isInCall || isCallConnecting) return;
    try {
      const raw = sessionStorage.getItem(PENDING_CALL_STORAGE_KEY);
      if (!raw) return;
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
      setIncomingCall({ fromUserId, sdp: sdp as RTCSessionDescriptionInit });
    } catch {
      sessionStorage.removeItem(PENDING_CALL_STORAGE_KEY);
    }
  }, [location, incomingCall, isInCall, isCallConnecting]);

  useEffect(() => {
    return () => {
      stopCurrentSession(false);
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const callUserId = incomingCall?.fromUserId ?? connectedPeerUserId;
  const callUserName = users?.find((u) => u.id === callUserId)?.name || "Unknown user";

  // All admin items
  const adminNavItems = [
    { label: "Overview", icon: LayoutDashboard, href: "/" },
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "List View", icon: ListTodo, href: "/list" },
    { label: "Team", icon: Users, href: "/users" },
    { label: "Chat", icon: MessageSquare, href: "/chat" },
    { label: "Notifications", icon: Bell, href: "/notifications" },
  ];

  // User only sees tasks for drag & drop
  const userNavItems = [
    { label: "Hiqain Board", icon: Kanban, href: "/board" },
    { label: "Chat", icon: MessageSquare, href: "/chat" },
    { label: "Notifications", icon: Bell, href: "/notifications" },
  ];

  const navItems = user?.role === "admin" ? adminNavItems : userNavItems;

  const adminItems = user?.role === "admin" ? [
    { label: "Admin Console", icon: Shield, href: "/admin" },
  ] : [];

  const closeMobileSidebar = () => onMobileOpenChange(false);

  const renderNavSection = () => (
    <>
      <div className="space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={closeMobileSidebar}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200
                  ${isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                `}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.href === "/chat" && totalUnread > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
                {item.href === "/notifications" && notificationUnreadCount > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
                    {notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {user?.role === "admin" && (
        <div className="mt-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 pl-1">
            Admin
          </p>
          <div className="space-y-1">
            {adminItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    onClick={closeMobileSidebar}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200
                      ${isActive
                        ? "bg-amber-500/10 text-amber-600"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    `}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 px-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 pl-1">
          Actions
        </p>
        <Button
          onClick={() => {
            closeMobileSidebar();
            onNewTask();
          }}
          className="w-full justify-start gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>
    </>
  );

  return (
    <>
      {((incomingCall && !location.startsWith("/chat")) || isCallConnecting || isInCall) && (
        <div className="fixed top-4 right-4 z-[110] w-[calc(100vw-2rem)] max-w-sm rounded-lg border bg-background p-4 shadow-xl">
          <p className="text-sm font-semibold">
            {incomingCall ? "Incoming Call" : isInCall ? "In Call" : "Connecting Call"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {incomingCall ? `${callUserName} is calling...` : `${callUserName}`}
          </p>
          {isInCall && (
            <p className="mt-1 text-xs text-muted-foreground">
              Duration: {formatDuration(callDurationSec)}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {incomingCall && !isCallConnecting && !isInCall && (
              <>
                <Button size="sm" variant="outline" onClick={handleDeclineIncomingCall}>
                  Decline
                </Button>
                <Button size="sm" onClick={() => void handleAcceptIncomingCall()}>
                  Accept
                </Button>
              </>
            )}
            {(isCallConnecting || isInCall) && (
              <Button size="sm" variant="destructive" onClick={handleEndCall}>
                End Call
              </Button>
            )}
          </div>
        </div>
      )}
      <audio ref={remoteAudioRef} autoPlay />

      <div className="hidden md:flex w-64 border-r border-border/40 bg-card/50 backdrop-blur-sm h-screen flex-col fixed left-0 top-0 pt-6 px-4">
        <div className="px-2 mb-8 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Kanban className="w-5 h-5 text-primary" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-foreground">
            TaskFlow
          </span>
        </div>
        {renderNavSection()}
      </div>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-[88vw] max-w-[320px] p-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="px-2 mb-6 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Kanban className="w-5 h-5 text-primary" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-foreground">
              TaskFlow
            </span>
          </div>
          {renderNavSection()}
        </SheetContent>
      </Sheet>
    </>
  );
}
