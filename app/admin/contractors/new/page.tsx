'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Building2,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  FileText,
  Loader2,
  CheckCircle,
  Wrench,
  ExternalLink,
} from 'lucide-react'
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
import { createVendor } from '../actions'
import {
  getContractorCategories,
  getContractorSubcategories,
  type ContractorCategory,
  type ContractorSubcategory,
} from '@/app/admin/settings/contractors/actions'

const provinces = [
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

export default function AddContractorPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [categories, setCategories] = useState<ContractorCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [subcategories, setSubcategories] = useState<ContractorSubcategory[]>([])
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false)

  useEffect(() => {
    getContractorCategories().then((result) => {
      if (result.success) setCategories(result.categories)
      setCategoriesLoading(false)
    })
  }, [])

  const [formData, setFormData] = useState({
    company_name: '',
    contact_first_name: '',
    contact_last_name: '',
    email: '',
    phone: '',
    trade: '',
    trade_subcategory: '',
    address_line1: '',
    city: '',
    province: 'ON',
    postal_code: '',
    gst_hst_number: '',
    wcb_number: '',
    wcb_expiry: '',
    bank_institution: '',
    bank_transit: '',
    bank_account: '',
  })

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleTradeChange = (value: string) => {
    setFormData(prev => ({ ...prev, trade: value, trade_subcategory: '' }))
    const cat = categories.find((c) => c.name === value)
    if (cat) {
      setSubcategoriesLoading(true)
      setSubcategories([])
      getContractorSubcategories(cat.id).then((result) => {
        if (result.success) setSubcategories(result.subcategories)
        setSubcategoriesLoading(false)
      })
    } else {
      setSubcategories([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.company_name || !formData.email || !formData.trade) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields.',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Use server action with permission enforcement
      const result = await createVendor({
        company_name: formData.company_name,
        contact_name: `${formData.contact_first_name} ${formData.contact_last_name}`.trim(),
        email: formData.email,
        phone: formData.phone || undefined,
        address_line1: formData.address_line1 || undefined,
        city: formData.city || undefined,
        province: formData.province,
        postal_code: formData.postal_code || undefined,
        gst_number: formData.gst_hst_number || undefined,
        trade_category: formData.trade || undefined,
        trade_subcategory: formData.trade_subcategory || undefined,
      })

      if (!result.success) {
        toast({
          title: 'Error',
          description: result.error || 'Failed to add contractor.',
          variant: 'destructive',
        })
        return
      }

      setIsSuccess(true)
      toast({
        title: 'Contractor Added',
        description: `${formData.company_name} has been added to the directory.`,
      })

      // Redirect after short delay
      setTimeout(() => {
        router.push('/admin/contractors')
      }, 1500)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add contractor. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Contractor Added</h2>
          <p className="text-muted-foreground">Redirecting to directory...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 h-16">
            <Link
              href="/admin/contractors"
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-semibold">Add Contractor</h1>
              <p className="text-xs text-muted-foreground">Add a new vendor to the directory</p>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Company Information */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold">Company Information</h2>
                <p className="text-sm text-muted-foreground">Basic business details</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="company_name">Company Name *</Label>
                <Input
                  id="company_name"
                  value={formData.company_name}
                  onChange={(e) => handleChange('company_name', e.target.value)}
                  placeholder="ABC Construction Ltd."
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_first_name">Contact First Name</Label>
                <Input
                  id="contact_first_name"
                  value={formData.contact_first_name}
                  onChange={(e) => handleChange('contact_first_name', e.target.value)}
                  placeholder="John"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_last_name">Contact Last Name</Label>
                <Input
                  id="contact_last_name"
                  value={formData.contact_last_name}
                  onChange={(e) => handleChange('contact_last_name', e.target.value)}
                  placeholder="Smith"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="contact@company.com"
                    className="h-11 pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="h-11 pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="trade">Trade / Specialty *</Label>
                  <Link
                    href="/admin/settings/contractors/categories"
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                    tabIndex={-1}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Manage Categories
                  </Link>
                </div>
                <Select value={formData.trade} onValueChange={handleTradeChange}>
                  <SelectTrigger className="h-11">
                    <Wrench className="w-4 h-4 text-muted-foreground mr-2" />
                    <SelectValue placeholder={categoriesLoading ? 'Loading...' : 'Select trade'} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.length === 0 && !categoriesLoading ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                        No categories found.{' '}
                        <Link href="/admin/settings/contractors/categories" className="text-primary underline underline-offset-2">
                          Add categories in Contractor Settings.
                        </Link>
                      </div>
                    ) : (
                      categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trade_subcategory">Subcategory</Label>
                <Select
                  value={formData.trade_subcategory}
                  onValueChange={(v) => handleChange('trade_subcategory', v)}
                  disabled={!formData.trade || subcategoriesLoading}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue
                      placeholder={
                        !formData.trade
                          ? 'Select a trade first'
                          : subcategoriesLoading
                          ? 'Loading...'
                          : 'Select subcategory (optional)'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {subcategories.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                        No subcategories available for this category.
                      </div>
                    ) : (
                      subcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.name}>
                          {sub.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="font-semibold">Business Address</h2>
                <p className="text-sm text-muted-foreground">Physical location</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="address_line1">Street Address</Label>
                <Input
                  id="address_line1"
                  value={formData.address_line1}
                  onChange={(e) => handleChange('address_line1', e.target.value)}
                  placeholder="123 Main Street"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="Toronto"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="province">Province</Label>
                <Select value={formData.province} onValueChange={(v) => handleChange('province', v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {provinces.map((prov) => (
                      <SelectItem key={prov.value} value={prov.value}>
                        {prov.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="postal_code">Postal Code</Label>
                <Input
                  id="postal_code"
                  value={formData.postal_code}
                  onChange={(e) => handleChange('postal_code', e.target.value.toUpperCase())}
                  placeholder="M5V 1A1"
                  className="h-11"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Compliance */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h2 className="font-semibold">Compliance Documents</h2>
                <p className="text-sm text-muted-foreground">Tax and insurance information</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gst_hst_number">GST/HST Number</Label>
                <Input
                  id="gst_hst_number"
                  value={formData.gst_hst_number}
                  onChange={(e) => handleChange('gst_hst_number', e.target.value)}
                  placeholder="123456789RT0001"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="wcb_number">WCB/WSIB Number</Label>
                <Input
                  id="wcb_number"
                  value={formData.wcb_number}
                  onChange={(e) => handleChange('wcb_number', e.target.value)}
                  placeholder="1234567"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="wcb_expiry">WCB Expiry Date</Label>
                <Input
                  id="wcb_expiry"
                  type="date"
                  value={formData.wcb_expiry}
                  onChange={(e) => handleChange('wcb_expiry', e.target.value)}
                  className="h-11"
                />
              </div>
            </div>
          </div>

          {/* Banking */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-success" />
              </div>
              <div>
                <h2 className="font-semibold">Banking Information</h2>
                <p className="text-sm text-muted-foreground">For EFT payments (encrypted)</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bank_institution">Institution #</Label>
                <Input
                  id="bank_institution"
                  value={formData.bank_institution}
                  onChange={(e) => handleChange('bank_institution', e.target.value)}
                  placeholder="001"
                  className="h-11 font-mono"
                  maxLength={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bank_transit">Transit #</Label>
                <Input
                  id="bank_transit"
                  value={formData.bank_transit}
                  onChange={(e) => handleChange('bank_transit', e.target.value)}
                  placeholder="12345"
                  className="h-11 font-mono"
                  maxLength={5}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bank_account">Account #</Label>
                <Input
                  id="bank_account"
                  value={formData.bank_account}
                  onChange={(e) => handleChange('bank_account', e.target.value)}
                  placeholder="1234567"
                  className="h-11 font-mono"
                  maxLength={12}
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-4 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/admin/contractors')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Contractor'
              )}
            </Button>
          </div>
        </form>
      </main>

      {/* Mobile Bottom Spacer */}
      <div className="h-16 md:hidden" />
    </div>
  )
}
