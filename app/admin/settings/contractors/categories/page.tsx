'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Pencil,
  Check,
  X,
  ToggleLeft,
  ToggleRight,
  Tag,
  Loader2,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  getAllContractorCategories,
  getAllContractorSubcategories,
  createContractorCategory,
  updateContractorCategory,
  toggleContractorCategoryActive,
  createContractorSubcategory,
  updateContractorSubcategory,
  toggleContractorSubcategoryActive,
  type ContractorCategory,
  type ContractorSubcategory,
} from '../actions'

// ─── Add Subcategory Form ─────────────────────────────────────────────────────

function AddSubcategoryForm({
  categoryId,
  onAdded,
}: {
  categoryId: string
  onAdded: (sub: ContractorSubcategory) => void
}) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      const result = await createContractorSubcategory({ category_id: categoryId, name, description })
      if (result.success && result.subcategory) {
        toast({ title: 'Subcategory added', description: `"${result.subcategory.name}" is now active.` })
        onAdded(result.subcategory)
        setName('')
        setDescription('')
        setOpen(false)
      } else {
        toast({ title: 'Failed to add', description: result.error, variant: 'destructive' })
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors py-1 px-2 rounded-md hover:bg-primary/5"
      >
        <Plus className="w-3.5 h-3.5" />
        Add subcategory
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-muted/30 border border-border/60 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Residential Electrical"
            autoFocus
            maxLength={80}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Description (optional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            maxLength={200}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => { setOpen(false); setName(''); setDescription('') }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-7 text-xs gap-1" disabled={isPending || !name.trim()}>
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {isPending ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </form>
  )
}

// ─── Subcategory Row ──────────────────────────────────────────────────────────

function SubcategoryRow({
  sub,
  onUpdated,
  onToggled,
}: {
  sub: ContractorSubcategory
  onUpdated: (s: ContractorSubcategory) => void
  onToggled: (s: ContractorSubcategory) => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(sub.name)
  const [editDesc, setEditDesc] = useState(sub.description ?? '')
  const [isPending, startTransition] = useTransition()
  const [isToggling, startToggleTransition] = useTransition()

  function handleSave() {
    if (!editName.trim()) return
    startTransition(async () => {
      const result = await updateContractorSubcategory(sub.id, { name: editName, description: editDesc })
      if (result.success && result.subcategory) {
        toast({ title: 'Subcategory updated', description: `"${result.subcategory.name}" saved.` })
        onUpdated(result.subcategory)
        setEditing(false)
      } else {
        toast({ title: 'Update failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleToggle() {
    startToggleTransition(async () => {
      const result = await toggleContractorSubcategoryActive(sub.id, !sub.is_active)
      if (result.success && result.subcategory) {
        const action = result.subcategory.is_active ? 'activated' : 'deactivated'
        toast({ title: `Subcategory ${action}`, description: `"${result.subcategory.name}" has been ${action}.` })
        onToggled(result.subcategory)
      } else {
        toast({ title: 'Action failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border transition-colors ${
        sub.is_active
          ? 'bg-background border-border/60'
          : 'bg-muted/20 border-border/30 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              maxLength={80}
              className="h-7 text-xs flex-1"
            />
            <Input
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              maxLength={200}
              className="h-7 text-xs flex-1"
              placeholder="Description (optional)"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium ${!sub.is_active ? 'text-muted-foreground' : ''}`}>
              {sub.name}
            </span>
            {!sub.is_active && (
              <Badge variant="outline" className="text-[10px] py-0 px-1 border-border/50 text-muted-foreground">
                Inactive
              </Badge>
            )}
            {sub.description && (
              <span className="text-[11px] text-muted-foreground/70 truncate">{sub.description}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {editing ? (
          <>
            <Button size="icon" variant="ghost" className="w-6 h-6" onClick={handleSave} disabled={isPending || !editName.trim()} title="Save">
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-success" />}
            </Button>
            <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => { setEditName(sub.name); setEditDesc(sub.description ?? ''); setEditing(false) }} disabled={isPending} title="Cancel">
              <X className="w-3 h-3 text-muted-foreground" />
            </Button>
          </>
        ) : (
          <>
            <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => setEditing(true)} title="Edit subcategory">
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </Button>
            <Button size="icon" variant="ghost" className="w-6 h-6" onClick={handleToggle} disabled={isToggling} title={sub.is_active ? 'Deactivate' : 'Activate'}>
              {isToggling ? <Loader2 className="w-3 h-3 animate-spin" /> : sub.is_active ? <ToggleRight className="w-3.5 h-3.5 text-success" /> : <ToggleLeft className="w-3.5 h-3.5 text-muted-foreground" />}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Add Category Form ────────────────────────────────────────────────────────

function AddCategoryForm({ onAdded }: { onAdded: (cat: ContractorCategory) => void }) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [open, setOpen] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      const result = await createContractorCategory({ name, description })
      if (result.success && result.category) {
        toast({ title: 'Category added', description: `"${result.category.name}" is now active.` })
        onAdded(result.category)
        setName('')
        setDescription('')
        setOpen(false)
      } else {
        toast({ title: 'Failed to add', description: result.error, variant: 'destructive' })
      }
    })
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        Add Category
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Plus className="w-4 h-4 text-primary" />
        <span className="font-medium text-sm">New Category</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-cat-name">Name *</Label>
          <Input
            id="new-cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Steel Erection"
            autoFocus
            maxLength={80}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-cat-desc">Description (optional)</Label>
          <Input
            id="new-cat-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            maxLength={200}
            className="h-9"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setName(''); setDescription('') }}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !name.trim()} className="gap-1.5">
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {isPending ? 'Adding...' : 'Add Category'}
        </Button>
      </div>
    </form>
  )
}

// ─── Category Row (with expandable subcategory panel) ────────────────────────

function CategoryRow({
  category,
  onUpdated,
  onToggled,
}: {
  category: ContractorCategory
  onUpdated: (cat: ContractorCategory) => void
  onToggled: (cat: ContractorCategory) => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(category.name)
  const [editDesc, setEditDesc] = useState(category.description ?? '')
  const [isPending, startTransition] = useTransition()
  const [isToggling, startToggleTransition] = useTransition()

  // Subcategory expansion state
  const [expanded, setExpanded] = useState(false)
  const [subcategories, setSubcategories] = useState<ContractorSubcategory[]>([])
  const [subLoading, setSubLoading] = useState(false)
  const [subLoaded, setSubLoaded] = useState(false)

  function handleExpand() {
    if (!expanded && !subLoaded) {
      setSubLoading(true)
      getAllContractorSubcategories(category.id).then((result) => {
        if (result.success) setSubcategories(result.subcategories)
        setSubLoading(false)
        setSubLoaded(true)
      })
    }
    setExpanded((v) => !v)
  }

  function handleSave() {
    if (!editName.trim()) return
    startTransition(async () => {
      const result = await updateContractorCategory(category.id, { name: editName, description: editDesc })
      if (result.success && result.category) {
        toast({ title: 'Category updated', description: `"${result.category.name}" saved.` })
        onUpdated(result.category)
        setEditing(false)
      } else {
        toast({ title: 'Update failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleCancel() {
    setEditName(category.name)
    setEditDesc(category.description ?? '')
    setEditing(false)
  }

  function handleToggle() {
    startToggleTransition(async () => {
      const result = await toggleContractorCategoryActive(category.id, !category.is_active)
      if (result.success && result.category) {
        const action = result.category.is_active ? 'activated' : 'deactivated'
        toast({ title: `Category ${action}`, description: `"${result.category.name}" has been ${action}.` })
        onToggled(result.category)
      } else {
        toast({ title: 'Action failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  const activeSubs = subcategories.filter((s) => s.is_active)
  const inactiveSubs = subcategories.filter((s) => !s.is_active)

  return (
    <div
      className={`rounded-xl border transition-colors ${
        category.is_active ? 'bg-card border-border' : 'bg-muted/40 border-border/50 opacity-70'
      }`}
    >
      {/* Category header row */}
      <div className="flex items-start gap-3 p-4">
        {/* Expand toggle */}
        <button
          onClick={handleExpand}
          className="pt-0.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors flex-shrink-0"
          aria-label={expanded ? 'Collapse subcategories' : 'Expand subcategories'}
        >
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                maxLength={80}
                className="h-8 text-sm"
                placeholder="Category name"
              />
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={200}
                className="h-8 text-sm"
                placeholder="Description (optional)"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-medium text-sm ${!category.is_active ? 'text-muted-foreground' : ''}`}>
                  {category.name}
                </span>
                {!category.is_active && (
                  <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border/60 py-0 px-1.5">
                    Inactive
                  </Badge>
                )}
                {subLoaded && (
                  <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {activeSubs.length} {activeSubs.length === 1 ? 'subcategory' : 'subcategories'}
                  </span>
                )}
              </div>
              {category.description && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{category.description}</p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <>
              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={handleSave} disabled={isPending || !editName.trim()} title="Save">
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-success" />}
              </Button>
              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={handleCancel} disabled={isPending} title="Cancel">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <>
              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditing(true)} title="Edit category">
                <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={handleToggle} disabled={isToggling} title={category.is_active ? 'Deactivate' : 'Activate'}>
                {isToggling
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : category.is_active
                    ? <ToggleRight className="w-4 h-4 text-success" />
                    : <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                }
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Subcategory panel */}
      {expanded && (
        <div className="border-t border-border/60 px-4 pb-4 pt-3 ml-7 space-y-3">
          {subLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading subcategories...
            </div>
          ) : (
            <>
              {/* Active subcategories */}
              {activeSubs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Active ({activeSubs.length})
                  </p>
                  {activeSubs.map((sub) => (
                    <SubcategoryRow
                      key={sub.id}
                      sub={sub}
                      onUpdated={(updated) => setSubcategories((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
                      onToggled={(toggled) => setSubcategories((prev) => prev.map((s) => s.id === toggled.id ? toggled : s))}
                    />
                  ))}
                </div>
              )}

              {/* Inactive subcategories */}
              {inactiveSubs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Inactive ({inactiveSubs.length})
                  </p>
                  {inactiveSubs.map((sub) => (
                    <SubcategoryRow
                      key={sub.id}
                      sub={sub}
                      onUpdated={(updated) => setSubcategories((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
                      onToggled={(toggled) => setSubcategories((prev) => prev.map((s) => s.id === toggled.id ? toggled : s))}
                    />
                  ))}
                </div>
              )}

              {activeSubs.length === 0 && inactiveSubs.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">No subcategories yet.</p>
              )}

              {/* Add subcategory form */}
              <AddSubcategoryForm
                categoryId={category.id}
                onAdded={(sub) => {
                  setSubcategories((prev) =>
                    [...prev, sub].sort((a, b) =>
                      Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)
                    )
                  )
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContractorCategoriesPage() {
  const { toast } = useToast()
  const [categories, setCategories] = useState<ContractorCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAllContractorCategories().then((result) => {
      if (result.success) {
        setCategories(result.categories)
      } else {
        setError(result.error ?? 'Failed to load categories.')
        toast({ title: 'Error', description: result.error, variant: 'destructive' })
      }
      setLoading(false)
    })
  }, [toast])

  function handleAdded(cat: ContractorCategory) {
    setCategories((prev) =>
      [...prev, cat].sort((a, b) =>
        Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)
      )
    )
  }

  function handleUpdated(cat: ContractorCategory) {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)))
  }

  function handleToggled(cat: ContractorCategory) {
    setCategories((prev) =>
      prev
        .map((c) => (c.id === cat.id ? cat : c))
        .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name))
    )
  }

  const activeCategories = categories.filter((c) => c.is_active)
  const inactiveCategories = categories.filter((c) => !c.is_active)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader pageTitle="Contractor Categories" />
      <RoleTabBar role="admin" />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/settings" className="p-2 hover:bg-muted rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Tag className="w-6 h-6 text-primary" />
              Contractor Categories
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage trade categories and subcategories for contractors.
            </p>
          </div>
        </div>

        {/* Info banner */}
        <div className="flex gap-3 items-start p-4 bg-primary/5 border border-primary/20 rounded-xl mb-6 text-sm text-foreground">
          <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p>
              <span className="font-medium">Active</span> categories and subcategories appear in contractor forms.
              Click the arrow on any category to expand and manage its subcategories.
            </p>
            <p className="text-muted-foreground">
              Deactivating a category or subcategory hides it from new selections — existing contractors are not affected.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        ) : (
          <div className="space-y-8">
            {/* Add form */}
            <AddCategoryForm onAdded={handleAdded} />

            {/* Active categories */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Active <span className="text-foreground font-bold">{activeCategories.length}</span>
                </h2>
              </div>

              {activeCategories.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-border rounded-xl">
                  <Tag className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No active categories.</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Add a category above to get started.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeCategories.map((cat) => (
                    <CategoryRow
                      key={cat.id}
                      category={cat}
                      onUpdated={handleUpdated}
                      onToggled={handleToggled}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Inactive categories */}
            {inactiveCategories.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Inactive <span className="font-bold">{inactiveCategories.length}</span>
                  </h2>
                </div>
                <div className="space-y-2">
                  {inactiveCategories.map((cat) => (
                    <CategoryRow
                      key={cat.id}
                      category={cat}
                      onUpdated={handleUpdated}
                      onToggled={handleToggled}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
