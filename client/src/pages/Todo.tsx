import { useMemo, useState } from "react";
import {
  useCreateTodoItem,
  useCreateTodoList,
  useDeleteTodoItem,
  useTodoLists,
  useUpdateTodoItem,
} from "@/hooks/use-todos";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

export default function Todo() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data, isLoading } = useTodoLists();
  const createList = useCreateTodoList();
  const createItem = useCreateTodoItem();
  const updateItem = useUpdateTodoItem();
  const deleteItem = useDeleteTodoItem();

  const [newItemContent, setNewItemContent] = useState("");
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemContent, setEditingItemContent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

  const myLists = useMemo(() => {
    const lists = data?.lists || [];
    if (!user?.id) return [];
    return lists.filter((entry) => entry.list.createdById === user.id);
  }, [data?.lists, user?.id]);

  const primaryList = myLists[0] || null;
  const completedCount = primaryList?.items.filter((item) => item.completed).length || 0;
  const totalCount = primaryList?.items.length || 0;

  const ensureMyTodoList = async () => {
    if (primaryList) return primaryList.list.id;
    const created = await createList.mutateAsync({ title: "My Todo" });
    return created.id;
  };

  const handleAddItem = async () => {
    const content = newItemContent.trim();
    if (!content) return;

    try {
      const listId = await ensureMyTodoList();
      await createItem.mutateAsync({ listId, data: { content } });
      setNewItemContent("");
    } catch (error) {
      toast({
        title: "Could not add item",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleItem = async (itemId: number, completed: boolean) => {
    try {
      await updateItem.mutateAsync({ id: itemId, data: { completed } });
    } catch (error) {
      toast({
        title: "Could not update item",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSaveItem = async (itemId: number) => {
    const content = editingItemContent.trim();
    if (!content) return;

    try {
      await updateItem.mutateAsync({ id: itemId, data: { content } });
      setEditingItemId(null);
      setEditingItemContent("");
      toast({ title: "Item updated" });
    } catch (error) {
      toast({
        title: "Could not update item",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      await deleteItem.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast({ title: "Item deleted" });
    } catch (error) {
      toast({
        title: "Could not delete item",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <Card className="rounded-[28px] border-slate-300 shadow-sm">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Badge variant="secondary" className="rounded-xl px-3 py-1 text-sm font-semibold">
                  {completedCount}/{totalCount} done
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              {!primaryList || primaryList.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Add your first todo item below.
                </div>
              ) : (
                primaryList.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <button
                      type="button"
                      onClick={() => void handleToggleItem(item.id, !item.completed)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                        item.completed
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-slate-300 bg-white text-slate-500"
                      }`}
                      aria-label={item.completed ? "Mark as pending" : "Mark as done"}
                    >
                      {item.completed ? <Check className="h-4 w-4" /> : null}
                    </button>

                    <div className="min-w-0 flex-1">
                      {editingItemId === item.id ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={editingItemContent}
                            onChange={(event) => setEditingItemContent(event.target.value)}
                            placeholder="Edit item"
                            className="h-11 rounded-xl"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleSaveItem(item.id);
                              }
                            }}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void handleSaveItem(item.id)}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingItemId(null);
                                setEditingItemContent("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className={item.completed ? "text-lg text-muted-foreground line-through" : "text-lg font-medium text-slate-700"}>
                          {item.content}
                        </p>
                      )}
                    </div>

                    {editingItemId !== item.id && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingItemId(item.id);
                            setEditingItemContent(item.content);
                          }}
                          aria-label="Edit item"
                        >
                          <Pencil className="h-4 w-4 text-slate-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget({ id: item.id, label: item.content })}
                          aria-label="Delete item"
                        >
                          <Trash2 className="h-4 w-4 text-slate-500" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newItemContent}
                onChange={(event) => setNewItemContent(event.target.value)}
                placeholder='Add an item, for example "Login API"'
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleAddItem();
                  }
                }}
                className="h-14 rounded-2xl text-base"
              />
              <Button
                onClick={() => void handleAddItem()}
                className="h-14 rounded-2xl px-6 text-lg sm:min-w-32"
                disabled={createItem.isPending || createList.isPending}
              >
                {createItem.isPending || createList.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-2 h-5 w-5" />
                    Add
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-[420px] fixed !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2">
          <DialogHeader>
            <DialogTitle>Delete Item</DialogTitle>
            <DialogDescription>
              {`Are you sure you want to delete ${deleteTarget?.label ? `"${deleteTarget.label}"` : "this item"}?`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" type="button" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
