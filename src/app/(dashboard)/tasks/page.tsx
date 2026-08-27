"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import type { Contact, Profile, Task } from "@/types";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckSquare, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type TaskWithRelations = Task;

type Scope = "mine" | "all";

export default function TasksPage() {
  useDocumentTitle("Tasks");
  const supabase = createClient();
  const { accountId, profile } = useAuth();
  const canCreate = useCan("send-messages");

  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("mine");
  const [showCompleted, setShowCompleted] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // New-task dialog
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("tasks")
      .select("*, contact:contacts(*), assignee:profiles!tasks_assigned_to_fkey(*)")
      .order("due_at", { ascending: true, nullsFirst: false });

    if (scope === "mine" && profile?.id) {
      query = query.eq("assigned_to", profile.id);
    }
    if (!showCompleted) {
      query = query.is("completed_at", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Failed to load tasks:", error.message);
      setTasks([]);
    } else {
      setTasks((data ?? []) as TaskWithRelations[]);
    }
    setLoading(false);
  }, [supabase, scope, showCompleted, profile?.id]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  function openNewTask() {
    setTitle("");
    setContactId("");
    setDueAt("");
    setAssignedTo(profile?.id ?? "");
    setOpen(true);
  }

  async function handleCreate() {
    if (!title.trim() || !contactId) {
      toast.error("Title and contact are required");
      return;
    }
    if (!accountId) {
      toast.error("Your profile is not linked to an account.");
      return;
    }
    setSaving(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error("Not signed in");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("tasks").insert({
      account_id: accountId,
      contact_id: contactId,
      title: title.trim(),
      due_at: dueAt || null,
      assigned_to: assignedTo || null,
      created_by: profile?.id ?? null,
    });

    setSaving(false);
    if (error) {
      toast.error("Failed to create task");
      return;
    }
    toast.success("Task created");
    setOpen(false);
    fetchTasks();
  }

  async function toggleComplete(task: TaskWithRelations) {
    setTogglingId(task.id);
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq("id", task.id);
    setTogglingId(null);
    if (error) {
      toast.error("Failed to update task");
      return;
    }
    fetchTasks();
  }

  async function handleDelete(taskId: string) {
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) {
      toast.error("Failed to delete task");
      return;
    }
    toast.success("Task deleted");
    fetchTasks();
  }

  const now = Date.now();

  function dueBucket(task: TaskWithRelations): "overdue" | "today" | "upcoming" | "none" {
    if (!task.due_at) return "none";
    const due = new Date(task.due_at).getTime();
    const todayEnd = new Date().setHours(23, 59, 59, 999);
    if (due < now && !task.completed_at) return "overdue";
    if (due <= todayEnd) return "today";
    return "upcoming";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-1">
          <button
            onClick={() => setScope("mine")}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              scope === "mine" ? "bg-primary text-primary-foreground" : "text-slate-400 hover:text-white"
            }`}
          >
            My tasks
          </button>
          <button
            onClick={() => setScope("all")}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              scope === "all" ? "bg-primary text-primary-foreground" : "text-slate-400 hover:text-white"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              showCompleted ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {showCompleted ? "Hide completed" : "Show completed"}
          </button>
        </div>

        <GatedButton canAct={canCreate} gateReason="create tasks" onClick={openNewTask}>
          <Plus className="mr-1 h-4 w-4" />
          New Task
        </GatedButton>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-700 py-16 text-slate-500">
          <CheckSquare className="h-8 w-8" />
          <p className="text-sm">No tasks here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const bucket = dueBucket(task);
            return (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3"
              >
                <button
                  onClick={() => toggleComplete(task)}
                  disabled={togglingId === task.id}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    task.completed_at
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-slate-600"
                  }`}
                >
                  {task.completed_at && <CheckSquare className="h-3.5 w-3.5" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm ${
                      task.completed_at ? "text-slate-500 line-through" : "text-white"
                    }`}
                  >
                    {task.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {task.contact && (
                      <Link href="/contacts" className="hover:text-primary">
                        {task.contact.name || task.contact.phone}
                      </Link>
                    )}
                    {task.assignee?.full_name && <span>· {task.assignee.full_name}</span>}
                  </div>
                </div>

                {task.due_at && !task.completed_at && (
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                      bucket === "overdue"
                        ? "bg-red-500/10 text-red-400"
                        : bucket === "today"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {bucket === "overdue" && <AlertCircle className="h-3 w-3" />}
                    {new Date(task.due_at).toLocaleDateString()}
                  </span>
                )}

                <button
                  onClick={() => handleDelete(task.id)}
                  className="shrink-0 text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 text-white">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-slate-300">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Follow up about pricing"
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-slate-300">Contact</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-slate-300">Due date</Label>
                <Input
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-300">Assigned to</Label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter className="bg-slate-900">
            <Button variant="outline" onClick={() => setOpen(false)} className="border-slate-700">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
