import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, MicOff, Phone, PhoneOff, Search, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMarkChatRead, useMessages, useSendMessage, useUnreadCounts } from "@/hooks/use-chat";
import { useUsers } from "@/hooks/use-users";
import { useToast } from "@/hooks/use-toast";

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: users, isLoading: isUsersLoading } = useUsers();
  const { data: unreadCounts } = useUnreadCounts();
  const markChatRead = useMarkChatRead();
  const [activeUserId, setActiveUserId] = useState<number | undefined>(undefined);
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
  const isCallingRef = useRef(false);
  const isInCallRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const callTimeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (filteredUsers.length === 0) {
      setActiveUserId(undefined);
      return;
    }
    if (activeUserId && !filteredUsers.some((u) => u.id === activeUserId)) {
      setActiveUserId(undefined);
    }
  }, [filteredUsers, activeUserId]);

  const activeUser = useMemo(
    () => filteredUsers.find((u) => u.id === activeUserId),
    [filteredUsers, activeUserId]
  );
  const incomingCallFromUser = useMemo(
    () => teamMembers.find((u) => u.id === incomingCallFromUserId),
    [teamMembers, incomingCallFromUserId]
  );

  const { data: messages, isLoading: isMessagesLoading } = useMessages(activeUserId);
  const sendMessage = useSendMessage(activeUserId);

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

  const messageCount = Array.isArray(messages) ? messages.length : 0;

  useEffect(() => {
    setAutoScrollEnabled(true);
  }, [activeUserId]);

  useEffect(() => {
    if (!user?.id) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?userId=${user.id}`);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const parsed = JSON.parse(String(event.data || "{}"));
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

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user?.id, toast]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount, activeUserId, autoScrollEnabled]);

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

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !activeUserId) return;
    try {
      await sendMessage.mutateAsync({ toUserId: activeUserId, content });
      setDraft("");
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
    try {
      await markChatRead.mutateAsync(userId);
    } catch {
      // non-blocking
    }
  };

  if (isUsersLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-10rem)] border border-border rounded-xl overflow-hidden bg-card grid grid-cols-[280px_1fr]">
      <aside className="border-r border-border/60 bg-muted/20 flex flex-col min-h-0">
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
          {filteredUsers.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              {searchingSelf
                ? "You cannot chat with your own account. Search another team user."
                : "No user found."}
            </p>
          )}
        </div>
      </aside>

      <section className="flex flex-col min-h-0">
        <div className="px-5 py-4 border-b border-border/60 bg-background">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">{activeUser?.name || "Select user"}</h3>
              <p className="text-xs text-muted-foreground">Logged in as {user?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={!activeUserId || isCalling || isInCall}
                onClick={() => void startCall()}
              >
                <Phone className="w-4 h-4 mr-2" />
                Call
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={!isCalling && !isInCall}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                {isMuted ? "Unmute" : "Mute"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9"
                disabled={!isCalling && !isInCall}
                onClick={() => stopCurrentSession(true)}
              >
                <PhoneOff className="w-4 h-4 mr-2" />
                End
              </Button>
            </div>
          </div>
        </div>

        {(incomingCallFromUserId || isCalling || isInCall) && (
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
          {isMessagesLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : !activeUserId ? (
            <p className="text-sm text-muted-foreground">Select a user to start chat.</p>
          ) : messages && messages.length > 0 ? (
            messages.map((msg) => {
              const mine = msg.fromUserId === user?.id;
              return (
                <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[70%] rounded-2xl px-3 py-2 border ${mine
                      ? "bg-primary text-primary-foreground border-primary/30"
                      : "bg-muted/40 text-foreground border-border"
                      }`}
                  >
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
          {!!(messages as any)?.message && (
            <p className="text-xs text-destructive">{String((messages as any).message)}</p>
          )}
          {sendMessage.isError && (
            <p className="text-xs text-destructive">
              {sendMessage.error instanceof Error ? sendMessage.error.message : "Failed to send message"}
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
              onChange={(e) => setDraft(e.target.value)}
              placeholder={activeUserId ? "Type a message..." : "Select user first"}
              disabled={!activeUserId || sendMessage.isPending}
              className="h-11"
            />
            <Button
              type="submit"
              disabled={!activeUserId || !draft.trim() || sendMessage.isPending}
              className="h-11 px-4"
            >
              {sendMessage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
