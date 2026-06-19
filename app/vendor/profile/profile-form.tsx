'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, User, MapPin, CreditCard, Save, Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { updateVendorProfile, type VendorProfile } from '@/lib/actions/vendor-profile'
import { BankingChangeDialog } from './banking-change-dialog'
import {
  getContractorCategories,
  getContractorSubcategories,
  type ContractorCategory,
  type ContractorSubcategory,
} from '@/app/admin/settings/contractors/actions'

const PROVINCES = [
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'ON', label: 'Ontario' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
]

const PAYMENT_METHODS = [
  { value: 'eft', label: 'EFT / Direct Deposit' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'wire', label: 'Wire Transfer' },
]

export function ProfileForm({ profile }: { profile: VendorProfile }) {
  const router = useRouter()
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<ContractorCategory[]>([])
  const [subcategories, setSubcategories] = useState<ContractorSubcategory[]>([])
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false)

  useEffect(() => {
    getContractorCategories().then((result) => {
      if (result.success) setCategories(result.categories)
    })
  }, [])

  const [form, setForm] = useState({
    contactName: profile.contactName ?? '',
    phone: profile.phone ?? '',
    addressLine1: profile.addressLine1 ?? '',
    addressLine2: profile.addressLine2 ?? '',
    city: profile.city ?? '',
    province: profile.province ?? '',
    postalCode: profile.postalCode ?? '',
    tradeCategory: profile.tradeCategory ?? '',
    tradeSubcategory: profile.tradeSubcategory ?? '',
    businessNumber: profile.businessNumber ?? '',
    preferredPaymentMethod: profile.preferredPaymentMethod ?? '',
  })

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }))

  // Load subcategories whenever the selected category changes
  useEffect(() => {
    if (!form.tradeCategory) {
      setSubcategories([])
      return
    }
    const cat = categories.find((c) => c.name === form.tradeCategory)
    if (!cat) return
    setSubcategoriesLoading(true)
    getContractorSubcategories(cat.id).then((result) => {
      if (result.success) setSubcategories(result.subcategories)
      setSubcategoriesLoading(false)
    })
  }, [form.tradeCategory, categories])

  function handleTradeChange(value: string) {
    setForm((p) => ({ ...p, tradeCategory: value, tradeSubcategory: '' }))
  }

  const handleSave = async () => {
    setSaving(true)
    const res = await updateVendorProfile({
      ...form,
      tradeSubcategory: form.tradeSubcategory ?? '',
    })
    if (res.success) {
      toast({ title: 'Profile updated', description: 'Your company details have been saved.' })
      router.refresh()
    } else {
      toast({
        title: 'Update failed',
        description: res.error || 'Please try again.',
        variant: 'destructive',
      })
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      {/* Company (read-only identity) */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Company Information</h2>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Company Name</Label>
            <Input value={profile.companyName ?? ''} disabled />
            <p className="text-xs text-muted-foreground">
              Contact support to change your legal company name.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={profile.email ?? ''} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tradeCategory">Trade Category</Label>
            <Select value={form.tradeCategory} onValueChange={handleTradeChange}>
              <SelectTrigger id="tradeCategory">
                <SelectValue placeholder="Select trade" />
              </SelectTrigger>
              <SelectContent>
                {/* Show current value even if it was deactivated (historical display) */}
                {form.tradeCategory && !categories.some((c) => c.name === form.tradeCategory) && (
                  <SelectItem value={form.tradeCategory}>{form.tradeCategory}</SelectItem>
                )}
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tradeSubcategory">Subcategory</Label>
            <Select
              value={form.tradeSubcategory}
              onValueChange={(v) => set('tradeSubcategory', v)}
              disabled={!form.tradeCategory || subcategoriesLoading}
            >
              <SelectTrigger id="tradeSubcategory">
                <SelectValue
                  placeholder={
                    !form.tradeCategory
                      ? 'Select a trade first'
                      : subcategoriesLoading
                      ? 'Loading...'
                      : 'Select subcategory (optional)'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {/* Show current historical subcategory if deactivated */}
                {form.tradeSubcategory && !subcategories.some((s) => s.name === form.tradeSubcategory) && (
                  <SelectItem value={form.tradeSubcategory}>{form.tradeSubcategory}</SelectItem>
                )}
                {subcategories.length === 0 && !subcategoriesLoading ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                    No subcategories available for this category.
                  </div>
                ) : (
                  subcategories.map((sub) => (
                    <SelectItem key={sub.id} value={sub.name}>{sub.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="businessNumber">Business / GST Number</Label>
            <Input
              id="businessNumber"
              value={form.businessNumber}
              onChange={(e) => set('businessNumber', e.target.value)}
              placeholder="123456789 RT0001"
            />
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <User className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Contact</h2>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="contactName">Contact Name</Label>
            <Input
              id="contactName"
              value={form.contactName}
              onChange={(e) => set('contactName', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Address */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Address</h2>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="addressLine1">Address Line 1</Label>
            <Input
              id="addressLine1"
              value={form.addressLine1}
              onChange={(e) => set('addressLine1', e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="addressLine2">Address Line 2</Label>
            <Input
              id="addressLine2"
              value={form.addressLine2}
              onChange={(e) => set('addressLine2', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="province">Province</Label>
            <Select value={form.province} onValueChange={(v) => set('province', v)}>
              <SelectTrigger id="province">
                <SelectValue placeholder="Select province" />
              </SelectTrigger>
              <SelectContent>
                {PROVINCES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="postalCode">Postal Code</Label>
            <Input
              id="postalCode"
              value={form.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Payment preferences + banking (read-only) */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Payment</h2>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Preferred Payment Method</Label>
            <Select
              value={form.preferredPaymentMethod}
              onValueChange={(v) => set('preferredPaymentMethod', v)}
            >
              <SelectTrigger id="paymentMethod">
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Lock className="w-3 h-3" /> Bank Account
            </Label>
            <Input
              value={
                profile.bankAccountLast4
                  ? `${profile.bankName ? profile.bankName + ' ' : ''}••••${profile.bankAccountLast4}`
                  : 'Not on file'
              }
              disabled
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Banking changes require approval and are managed separately.
              </p>
              <BankingChangeDialog />
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
