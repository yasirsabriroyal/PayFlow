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
  GripVertical,
  Info,
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
  createContractorCategory,
  updateContractorCategory,
  toggleContractorCategoryActive,
  reorderContractorCategories,
  type ContractorCategory,
} from '../actions'

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
    <form
      onSubmit={handleSubmit}
      className="bg-card border border-primary/30 rounded-xl p-4 space-y-3"
    >
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { setOpen(false); setName(''); setDescription('') }}
        >
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

// ─── Inline Edit Row ──────────────────────────────────────────────────────────

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

  function handleSave() {
    if (!editName.trim()) return
    startTransition(async () => {
      const result = await updateContractorCategory(category.id, {
        name: editName,
        description: editDesc,
      })
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

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border transition-colors ${
        category.is_active
          ? 'bg-card border-border'
          : 'bg-muted/40 border-border/50 opacity-70'
      }`}
    >
      {/* Drag handle — visual only */}
      <div className="pt-0.5 text-muted-foreground/40 cursor-grab">
        <GripVertical className="w-4 h-4" />
      </div>

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
            </div>
            {category.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{category.description}</p>
            )}
            <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">/{category.slug}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {editing ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7"
              onClick={handleSave}
              disabled={isPending || !editName.trim()}
              title="Save"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5 text-success" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7"
              onClick={handleCancel}
              disabled={isPending}
              title="Cancel"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </>
        ) : (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7"
              onClick={() => setEditing(true)}
              title="Edit category"
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7"
              onClick={handleToggle}
              disabled={isToggling}
              title={category.is_active ? 'Deactivate' : 'Activate'}
            >
              {isToggling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : category.is_active ? (
                <ToggleRight className="w-4 h-4 text-success" />
              ) : (
                <ToggleLeft className="w-4 h-4 text-muted-foreground" />
              )}
            </Button>
          </>
        )}
      </div>
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
    setCategories((prev) => {
      // Insert in display_order position, default to end
      const next = [...prev, cat]
      return next.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
    })
  }

  function handleUpdated(cat: ContractorCategory) {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)))
  }

  function handleToggled(cat: ContractorCategory) {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)))
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
          <Link
            href="/admin/settings"
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Tag className="w-6 h-6 text-primary" />
              Contractor Categories
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage the trade categories available when adding or editing contractors.
            </p>
          </div>
        </div>

        {/* Info banner */}
        <div className="flex gap-3 items-start p-4 bg-primary/5 border border-primary/20 rounded-xl mb-6 text-sm text-foreground">
          <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p>
              <span className="font-medium">Active</span> categories appear in the Trade dropdown when adding or editing contractors.
            </p>
            <p className="text-muted-foreground">
              Deactivating a category hides it from new selections — existing contractors already assigned to that category are not affected.
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
