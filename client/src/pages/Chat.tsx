import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Send } from "lucide-react";
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

  const { data: messages, isLoading: isMessagesLoading } = useMessages(activeUserId);
  const sendMessage = useSendMessage(activeUserId);

  const messageCount = Array.isArray(messages) ? messages.length : 0;

  useEffect(() => {
    setAutoScrollEnabled(true);
  }, [activeUserId]);

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
          <h3 className="font-semibold">{activeUser?.name || "Select user"}</h3>
          <p className="text-xs text-muted-foreground">Logged in as {user?.name}</p>
        </div>

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
