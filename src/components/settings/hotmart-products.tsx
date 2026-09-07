'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Tag as TagIcon, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { HotmartProduct, HotmartProductGroup, Tag } from '@/types';

const UNGROUPED = '__none__';

/**
 * "Produtos e correlação" — the piece that turns a raw Hotmart
 * catalog into the segmentation Larissa asked for (05-07/09/2026):
 * pull the account's real products, fold whichever ones are "the
 * same offer" into one group ("produto correlacionado"), and pick
 * the tag that group auto-applies on purchase (submit_hotmart_lead,
 * 042). The combination logic on top of those tags (e.g. "comprou
 * Desafio E Análise") is still built in Automations — this screen
 * only owns the product → tag mapping.
 *
 * All reads/writes here go through the RLS-scoped browser client
 * (same pattern as tag-manager.tsx) — the only piece that needs a
 * server route is the sync itself, since that one has to decrypt the
 * Client Secret and call Hotmart's API.
 */
export function HotmartProducts() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [products, setProducts] = useState<HotmartProduct[]>([]);
  const [groups, setGroups] = useState<HotmartProductGroup[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [groupToDelete, setGroupToDelete] = useState<HotmartProductGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [productsRes, groupsRes, tagsRes] = await Promise.all([
        supabase
          .from('hotmart_products')
          .select('*')
          .eq('account_id', accountId)
          .order('name', { ascending: true }),
        supabase
          .from('hotmart_product_groups')
          .select('*')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true }),
        supabase
          .from('tags')
          .select('*')
          .eq('account_id', accountId)
          .order('name', { ascending: true }),
      ]);
      if (productsRes.error) throw productsRes.error;
      if (groupsRes.error) throw groupsRes.error;
      if (tagsRes.error) throw tagsRes.error;
      setProducts(productsRes.data ?? []);
      setGroups(groupsRes.data ?? []);
      setTags(tagsRes.data ?? []);
    } catch (err) {
      console.error('[HotmartProducts] load error:', err);
      toast.error('Failed to load Hotmart products');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  async function syncProducts() {
    setSyncing(true);
    try {
      const response = await fetch('/api/account/hotmart-products/sync', {
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) {
        toast.error(payload.error || 'Failed to sync Hotmart products');
        return;
      }
      toast.success(
        payload.synced === 0
          ? 'Sincronizado — nenhum produto encontrado na Hotmart'
          : `${payload.synced} produto(s) sincronizado(s)`,
      );
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function createGroup() {
    if (!newGroupName.trim() || !accountId) {
      toast.error('Dê um nome pro produto correlacionado');
      return;
    }
    setCreatingGroup(true);
    try {
      const { error } = await supabase.from('hotmart_product_groups').insert({
        account_id: accountId,
        name: newGroupName.trim(),
      });
      if (error) throw error;
      toast.success('Produto correlacionado criado');
      setGroupDialogOpen(false);
      setNewGroupName('');
      await load();
    } catch (err) {
      console.error('[HotmartProducts] createGroup error:', err);
      toast.error('Failed to create product group');
    } finally {
      setCreatingGroup(false);
    }
  }

  async function setGroupTag(groupId: string, tagId: string | null) {
    try {
      const { error } = await supabase
        .from('hotmart_product_groups')
        .update({ tag_id: tagId })
        .eq('id', groupId);
      if (error) throw error;
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, tag_id: tagId } : g)),
      );
    } catch (err) {
      console.error('[HotmartProducts] setGroupTag error:', err);
      toast.error('Failed to update the group’s tag');
    }
  }

  async function setProductGroup(productId: string, groupId: string | null) {
    try {
      const { error } = await supabase
        .from('hotmart_products')
        .update({ group_id: groupId })
        .eq('id', productId);
      if (error) throw error;
      setProducts((prev) =>
        prev.map((p) => (p.id === productId ? { ...p, group_id: groupId } : p)),
      );
    } catch (err) {
      console.error('[HotmartProducts] setProductGroup error:', err);
      toast.error('Failed to move the product');
    }
  }

  async function deleteGroup() {
    if (!groupToDelete) return;
    setDeletingGroup(true);
    try {
      const { error } = await supabase
        .from('hotmart_product_groups')
        .delete()
        .eq('id', groupToDelete.id);
      if (error) throw error;
      toast.success('Produto correlacionado removido');
      setGroupToDelete(null);
      // Members fall back to group_id = NULL via ON DELETE SET NULL —
      // refetch instead of patching state by hand so that shows up.
      await load();
    } catch (err) {
      console.error('[HotmartProducts] deleteGroup error:', err);
      toast.error('Failed to delete product group');
    } finally {
      setDeletingGroup(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-slate-700 bg-slate-900 ring-0">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-white">Produtos e correlação</CardTitle>
          <Button
            onClick={syncProducts}
            disabled={syncing}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sincronizar produtos
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {products.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhum produto ainda. Clique em &quot;Sincronizar produtos&quot;
              pra trazer o catálogo real da sua conta Hotmart (precisa das
              credenciais de API salvas acima) — ou espere a primeira venda
              cair, que o produto aparece sozinho aqui.
            </p>
          ) : (
            <div className="space-y-4">
              {/* ---- Grupos ("produtos correlacionados") ---- */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-slate-300">
                    Produtos correlacionados
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setGroupDialogOpen(true)}
                    className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <Plus className="size-3.5" />
                    Novo grupo
                  </Button>
                </div>
                {groups.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Crie um grupo pra cada produto lógico (ex: &quot;Desafio&quot;)
                    e depois arraste os produtos reais da Hotmart pra dentro
                    dele mais abaixo.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {groups.map((group) => (
                      <div
                        key={group.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <TagIcon className="size-4 text-slate-500" />
                          <span className="text-sm font-medium text-white">
                            {group.name}
                          </span>
                          <span className="text-xs text-slate-500">
                            (
                            {
                              products.filter((p) => p.group_id === group.id)
                                .length
                            }{' '}
                            produto(s))
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={group.tag_id ?? UNGROUPED}
                            onValueChange={(v) =>
                              setGroupTag(group.id, v === UNGROUPED ? null : v)
                            }
                          >
                            <SelectTrigger className="h-8 w-44 border-slate-700 bg-slate-800 text-xs text-white">
                              <SelectValue placeholder="Sem tag" />
                            </SelectTrigger>
                            <SelectContent className="border-slate-700 bg-slate-900 text-white">
                              <SelectItem value={UNGROUPED}>Sem tag</SelectItem>
                              {tags.map((tag) => (
                                <SelectItem key={tag.id} value={tag.id}>
                                  {tag.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setGroupToDelete(group)}
                            className="size-8 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {tags.length === 0 && (
                      <p className="text-xs text-amber-400">
                        Você ainda não tem nenhuma tag criada — crie uma na
                        aba Tags antes de linkar um grupo a ela.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ---- Catálogo real ---- */}
              <div className="space-y-2">
                <Label className="text-slate-300">
                  Catálogo Hotmart ({products.length})
                </Label>
                <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                  {products.map((product) => (
                    <div
                      key={product.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">
                          {product.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          Hotmart #{product.hotmart_product_id}
                          {!product.synced_at &&
                            ' — visto numa venda, ainda não confirmado pela sincronização'}
                        </p>
                      </div>
                      <Select
                        value={product.group_id ?? UNGROUPED}
                        onValueChange={(v) =>
                          setProductGroup(
                            product.id,
                            v === UNGROUPED ? null : v,
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-48 shrink-0 border-slate-700 bg-slate-800 text-xs text-white">
                          <SelectValue placeholder="Sem grupo" />
                        </SelectTrigger>
                        <SelectContent className="border-slate-700 bg-slate-900 text-white">
                          <SelectItem value={UNGROUPED}>Sem grupo</SelectItem>
                          {groups.map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New group dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">
              Novo produto correlacionado
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Um nome pra agrupar produtos da Hotmart que são, na prática, a
              mesma coisa (ex: variações de preço da mesma oferta).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-slate-300">Nome</Label>
            <Input
              placeholder="ex: Desafio"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') createGroup();
              }}
            />
          </div>
          <DialogFooter className="border-slate-700 bg-slate-900">
            <Button
              variant="outline"
              onClick={() => setGroupDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              onClick={createGroup}
              disabled={creatingGroup}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creatingGroup && <Loader2 className="size-4 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete group confirmation */}
      <Dialog
        open={!!groupToDelete}
        onOpenChange={(open) => !open && setGroupToDelete(null)}
      >
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">
              Remover &quot;{groupToDelete?.name}&quot;?
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Os produtos Hotmart ligados a esse grupo voltam pra &quot;Sem
              grupo&quot; — nenhum produto é apagado do catálogo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-slate-700 bg-slate-900">
            <Button
              variant="outline"
              onClick={() => setGroupToDelete(null)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              onClick={deleteGroup}
              disabled={deletingGroup}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletingGroup && <Loader2 className="size-4 animate-spin" />}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
