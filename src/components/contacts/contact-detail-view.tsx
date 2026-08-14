'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatCurrency } from '@/lib/currency';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, ContactNote, CustomField, ContactCustomValue, Deal } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  DollarSign,
  UserPlus,
} from 'lucide-react';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency, canManageMembers } = useAuth();
  // Viewers can open this sheet read-only. Gating the Save button
  // (rather than relying on the update's error result) avoids the
  // misleading "Contact updated" toast: an UPDATE a viewer isn't
  // allowed to make matches zero rows under RLS and Postgrest
  // returns 204 with no error, not a failure, so the old code path
  // reported success on a write that never actually happened.
  const canEdit = useCan('send-messages');

  // 034/035: only admin+ reassigns leads between vendors — same tier
  // as the lead-visibility-grants panel. Not an RLS boundary by
  // itself (an owner could still edit their own row's owner_id if
  // the field were exposed to them), just where this UI draws the
  // line per the product decision that reassignment is admin-only.
  const [members, setMembers] = useState<{ id: string; full_name: string | null }[]>([]);
  const [editOwnerId, setEditOwnerId] = useState('');

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [claiming, setClaiming] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
      setEditOwnerId(data.owner_id ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  // 034: roster for the Owner reassignment select. Any account
  // member can read other profiles in the same account (RLS,
  // 023_platform_layer.sql), so this is a plain client-side query —
  // only fetched for admins since only they see the field.
  const fetchMembers = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('account_id', accountId)
      .order('full_name');
    if (data) setMembers(data);
  }, [accountId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      if (canManageMembers) fetchMembers();
    }
  }, [open, contactId, canManageMembers, fetchContact, fetchTags, fetchNotes, fetchCustomFields, fetchDeals, fetchMembers]);

  async function copyPhone() {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error('Phone number is required');
      return;
    }

    setSavingDetails(true);
    const ownerChanged = canManageMembers && (contact?.owner_id ?? '') !== editOwnerId;
    const { data: updated, error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        // 034: only admins see/edit this field (see the Owner select
        // below) — for everyone else editOwnerId just mirrors the
        // loaded value, so this is a no-op write.
        ...(canManageMembers ? { owner_id: editOwnerId || null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .select('id');

    // A blocked-by-RLS write returns `error: null` with zero rows
    // affected — check for that explicitly so a viewer/agent editing
    // a contact they can't actually write to doesn't get a false
    // "Contact updated" success toast.
    if (error || !updated || updated.length === 0) {
      toast.error(
        error ? 'Failed to update contact' : "You don't have permission to edit this contact",
      );
      setSavingDetails(false);
      return;
    }

    // The owner changed: move the deal(s)/conversation along with it
    // so the lead doesn't end up split across two vendors (one owning
    // the contact/deal, another the conversation).
    if (ownerChanged) {
      const res = await fetch(`/api/contacts/${contactId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: editOwnerId || null }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || "Contact updated, but couldn't move its deal/conversation");
      }
    }

    toast.success('Contact updated');
    fetchContact();
    onUpdated();
    setSavingDetails(false);
  }

  async function claimLead() {
    if (!contactId) return;
    setClaiming(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/claim`, { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to claim lead');
        if (res.status === 409) {
          fetchContact();
          onUpdated();
        }
        return;
      }
      toast.success('Lead claimed');
      fetchContact();
      onUpdated();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setClaiming(false);
    }
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    if (isSelected) {
      const { error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId);
      if (!error) {
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        onUpdated();
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (!error) {
        setContactTagIds((prev) => [...prev, tagId]);
        onUpdated();
      }
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error('Not authenticated');
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error('Failed to add note');
    } else {
      setNewNote('');
      fetchNotes();
      toast.success('Note added');
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error('Failed to delete note');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success('Note deleted');
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success('Custom fields saved');
    } catch {
      toast.error('Failed to save custom fields');
    }
    setSavingCustom(false);
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-slate-800 border border-slate-700">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-white truncate">
                    {contact.name || 'Unknown'}
                  </SheetTitle>
                  <SheetDescription className="text-slate-400 text-xs mt-0.5">
                    Contact details
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-400">
                    <button
                      onClick={copyPhone}
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                    >
                      <Phone className="size-3" />
                      {contact.phone}
                      {copiedPhone ? (
                        <Check className="size-3 text-primary" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            {/* Caça-leads: this lead has no owner yet — any agent+
                can claim it. Contacts land here unowned when they
                come from CSV import, Instagram, a manually-added
                contact left unassigned, or an automation's "send to
                lead pool" step. */}
            {!contact.owner_id && (
              <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-xs text-amber-300">
                  This lead hasn&apos;t been claimed yet.
                </p>
                <GatedButton
                  canAct={canEdit}
                  gateReason="claim leads"
                  onClick={claimLead}
                  disabled={claiming}
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-500/90 text-slate-900 shrink-0"
                >
                  {claiming ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="size-3.5" />
                  )}
                  Claim lead
                </GatedButton>
              </div>
            )}

            {/* Tabs */}
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-slate-800/50 border-b border-slate-700 mx-4 mt-3">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Details
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Tags
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Notes
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Custom Fields
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:bg-slate-800 data-active:text-primary text-slate-400"
                >
                  Deals
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Name</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">
                      Phone <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Email</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-xs">Company</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white h-8 text-sm"
                    />
                  </div>
                  {canManageMembers && (
                    <div className="space-y-1.5">
                      <Label className="text-slate-400 text-xs">Owner</Label>
                      <select
                        value={editOwnerId}
                        onChange={(e) => setEditOwnerId(e.target.value)}
                        className="h-8 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary"
                      >
                        <option value="">Unassigned (visible to everyone)</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name || 'Unnamed'}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500">
                        Which vendor this lead belongs to. Only admins can change this.
                      </p>
                    </div>
                  )}
                  <GatedButton
                    canAct={canEdit}
                    gateReason="edit contacts"
                    onClick={saveDetails}
                    disabled={savingDetails}
                    wrapperClassName="w-full"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save Changes
                  </GatedButton>
                </div>
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Click a tag to add or remove it from this contact.
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No tags available. Create tags in Settings.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                              selected
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-900'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="size-3 mr-1" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Write a note..."
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Add Note
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-slate-500" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">
                      No notes yet.
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-slate-300 whitespace-pre-wrap flex-1">
                            {note.note_text}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5">
                          {new Date(note.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-slate-500" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No custom fields defined. Create them in Settings.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id} className="space-y-1.5">
                        <Label className="text-slate-400 text-xs capitalize">
                          {field.field_name}
                        </Label>
                        <Input
                          value={customValues[field.id] ?? ''}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={`Enter ${field.field_name}...`}
                          className="bg-slate-800 border-slate-700 text-white h-8 text-sm placeholder:text-slate-500"
                        />
                      </div>
                    ))}
                    <Button
                      onClick={saveCustomFields}
                      disabled={savingCustom}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingCustom ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Save Custom Fields
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent value="deals" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-slate-500">No deals yet</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-white">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <DollarSign className="size-3" />
                            {formatCurrency(
                              deal.value ?? 0,
                              deal.currency || defaultCurrency,
                            )}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
