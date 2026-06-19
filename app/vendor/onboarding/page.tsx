"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import {
  Building2,
  Check,
  ChevronRight,
  ChevronLeft,
  Upload,
  CreditCard,
  FileText,
  User,
  MapPin,
  Phone,
  Mail,
  Building,
  Shield,
  Briefcase,
  Calendar,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { getContractorCategories, type ContractorCategory } from "@/app/admin/settings/contractors/actions"

const provinces = [
  { value: "AB", label: "Alberta" },
  { value: "BC", label: "British Columbia" },
  { value: "MB", label: "Manitoba" },
  { value: "NB", label: "New Brunswick" },
  { value: "NL", label: "Newfoundland and Labrador" },
  { value: "NS", label: "Nova Scotia" },
  { value: "NT", label: "Northwest Territories" },
  { value: "NU", label: "Nunavut" },
  { value: "ON", label: "Ontario" },
  { value: "PE", label: "Prince Edward Island" },
  { value: "QC", label: "Quebec" },
  { value: "SK", label: "Saskatchewan" },
  { value: "YT", label: "Yukon" },
]

interface FormData {
  // Step 1: Company Profile
  companyName: string
  contactName: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  tradeCategory: string
  wcbAccountNumber: string
  wcbExpiryDate: string
  isCorporation: boolean
  businessNumber: string

  // Step 2: Banking & Tax
  paymentMethod: string
  bankName: string
  bankTransitNumber: string
  bankInstitutionNumber: string
  bankAccountNumber: string
  voidChequeFile: File | null
  t5018Consent: boolean

  wcbClearanceFile: File | null
}

const steps = [
  { id: 1, title: "Company Profile", icon: Building, description: "Business information" },
  { id: 2, title: "Banking & Tax", icon: CreditCard, description: "Payment details" },
  { id: 3, title: "Documents", icon: FileText, description: "Upload verification" },
]

export default function VendorOnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [categories, setCategories] = useState<ContractorCategory[]>([])
  const router = useRouter()

  useEffect(() => {
    getContractorCategories().then((result) => {
      if (result.success) setCategories(result.categories)
    })
  }, [])

  const [formData, setFormData] = useState<FormData>({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    province: "",
    postalCode: "",
    tradeCategory: "",
    wcbAccountNumber: "",
    wcbExpiryDate: "",
    isCorporation: false,
    businessNumber: "",
    paymentMethod: "eft",
    bankName: "",
    bankTransitNumber: "",
    bankInstitutionNumber: "",
    bankAccountNumber: "",
    voidChequeFile: null,
    t5018Consent: false,
    wcbClearanceFile: null,
  })

  const updateFormData = (field: keyof FormData, value: string | boolean | File | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleNextStep = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)

    try {
      const data = new FormData()
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          data.append(key, value instanceof File ? value : String(value))
        }
      })
      
      const { submitVendorKYC } = await import('@/lib/actions/vendor-kyc')
      const result = await submitVendorKYC(data)
      
      if (!result.success) {
        console.error('Submission failed:', result.error)
      } else {
        setIsComplete(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isComplete) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <Check className="w-10 h-10 text-success" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Onboarding Complete!</h1>
            <p className="text-muted-foreground">
              Thank you for submitting your information. Our team will review your
              documents and verify your account within 1-2 business days.
            </p>
          </div>
          <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            You will receive an email notification once your account has been verified
            and activated.
          </div>
          <Button onClick={() => router.push("/vendor/portal")} className="w-full">
            Go to Vendor Portal
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold">PayFlow AP</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 rounded-full">
              <Briefcase className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium text-accent">Vendor Onboarding</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Page Title */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Contractor KYC Onboarding
            </h1>
            <p className="text-muted-foreground">
              Complete your profile to start receiving payments through PayFlow AP.
            </p>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-2 sm:gap-4">
              {steps.map((step, index) => {
                const StepIcon = step.icon
                const isActive = currentStep === step.id
                const isCompleted = currentStep > step.id

                return (
                  <div key={step.id} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                          isCompleted
                            ? "bg-primary border-primary text-primary-foreground"
                            : isActive
                            ? "border-primary text-primary bg-primary/10"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <StepIcon className="w-5 h-5" />
                        )}
                      </div>
                      <div className="mt-2 text-center hidden sm:block">
                        <p
                          className={`text-sm font-medium ${
                            isActive ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {step.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </div>
                    {index < steps.length - 1 && (
                      <div
                        className={`w-12 sm:w-24 h-0.5 mx-2 ${
                          currentStep > step.id ? "bg-primary" : "bg-border"
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Form Card */}
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            {/* Step 1: Company Profile */}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">Company Profile</h2>
                  <p className="text-sm text-muted-foreground">
                    Provide your business information and WCB details.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="companyName">
                      <Building className="w-4 h-4 inline mr-2" />
                      Company Name *
                    </Label>
                    <Input
                      id="companyName"
                      value={formData.companyName}
                      onChange={(e) => updateFormData("companyName", e.target.value)}
                      placeholder="Your Company Ltd."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contactName">
                      <User className="w-4 h-4 inline mr-2" />
                      Contact Name *
                    </Label>
                    <Input
                      id="contactName"
                      value={formData.contactName}
                      onChange={(e) => updateFormData("contactName", e.target.value)}
                      placeholder="John Smith"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">
                      <Phone className="w-4 h-4 inline mr-2" />
                      Phone Number *
                    </Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => updateFormData("phone", e.target.value)}
                      placeholder="(403) 555-0100"
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="email">
                      <Mail className="w-4 h-4 inline mr-2" />
                      Email Address *
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => updateFormData("email", e.target.value)}
                      placeholder="contact@yourcompany.ca"
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="addressLine1">
                      <MapPin className="w-4 h-4 inline mr-2" />
                      Street Address *
                    </Label>
                    <Input
                      id="addressLine1"
                      value={formData.addressLine1}
                      onChange={(e) => updateFormData("addressLine1", e.target.value)}
                      placeholder="123 Main Street"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">City *</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => updateFormData("city", e.target.value)}
                      placeholder="Calgary"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="province">Province *</Label>
                    <Select
                      value={formData.province}
                      onValueChange={(value) => updateFormData("province", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select province" />
                      </SelectTrigger>
                      <SelectContent>
                        {provinces.map((province) => (
                          <SelectItem key={province.value} value={province.value}>
                            {province.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="postalCode">Postal Code *</Label>
                    <Input
                      id="postalCode"
                      value={formData.postalCode}
                      onChange={(e) => updateFormData("postalCode", e.target.value)}
                      placeholder="T2P 1J9"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tradeCategory">Trade Category *</Label>
                    <Select
                      value={formData.tradeCategory}
                      onValueChange={(value) => updateFormData("tradeCategory", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select trade" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.length === 0 ? (
                          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                            No categories available.
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

                  <div className="sm:col-span-2 border-t border-border pt-4 mt-2">
                    <h3 className="font-medium mb-4 flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      WCB Information
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="wcbAccountNumber">WCB Account Number *</Label>
                        <Input
                          id="wcbAccountNumber"
                          value={formData.wcbAccountNumber}
                          onChange={(e) =>
                            updateFormData("wcbAccountNumber", e.target.value)
                          }
                          placeholder="123456789"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="wcbExpiryDate">
                          <Calendar className="w-4 h-4 inline mr-2" />
                          WCB Clearance Expiry *
                        </Label>
                        <Input
                          id="wcbExpiryDate"
                          type="date"
                          value={formData.wcbExpiryDate}
                          onChange={(e) =>
                            updateFormData("wcbExpiryDate", e.target.value)
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="sm:col-span-2 flex items-center gap-2">
                    <Checkbox
                      id="isCorporation"
                      checked={formData.isCorporation}
                      onCheckedChange={(checked) =>
                        updateFormData("isCorporation", checked === true)
                      }
                    />
                    <Label htmlFor="isCorporation" className="text-sm cursor-pointer">
                      This is a registered corporation
                    </Label>
                  </div>

                  {formData.isCorporation && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="businessNumber">Business Number (BN)</Label>
                      <Input
                        id="businessNumber"
                        value={formData.businessNumber}
                        onChange={(e) => updateFormData("businessNumber", e.target.value)}
                        placeholder="123456789RC0001"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Banking & Tax */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">Banking & Tax Information</h2>
                  <p className="text-sm text-muted-foreground">
                    Provide your banking details for payment processing.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Payment Method Preference</Label>
                    <Select
                      value={formData.paymentMethod}
                      onValueChange={(value) => updateFormData("paymentMethod", value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eft">
                          EFT / Direct Deposit (Recommended)
                        </SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="etransfer">Interac e-Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.paymentMethod === "eft" && (
                    <>
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <p className="text-sm text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          Please ensure your banking information is accurate. Incorrect
                          details may delay payment processing.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="bankName">Bank Name *</Label>
                          <Input
                            id="bankName"
                            value={formData.bankName}
                            onChange={(e) => updateFormData("bankName", e.target.value)}
                            placeholder="TD Canada Trust"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="bankTransitNumber">Transit Number *</Label>
                          <Input
                            id="bankTransitNumber"
                            value={formData.bankTransitNumber}
                            onChange={(e) =>
                              updateFormData("bankTransitNumber", e.target.value)
                            }
                            placeholder="12345"
                            maxLength={5}
                          />
                          <p className="text-xs text-muted-foreground">5 digits</p>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="bankInstitutionNumber">
                            Institution Number *
                          </Label>
                          <Input
                            id="bankInstitutionNumber"
                            value={formData.bankInstitutionNumber}
                            onChange={(e) =>
                              updateFormData("bankInstitutionNumber", e.target.value)
                            }
                            placeholder="004"
                            maxLength={3}
                          />
                          <p className="text-xs text-muted-foreground">3 digits</p>
                        </div>

                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="bankAccountNumber">Account Number *</Label>
                          <Input
                            id="bankAccountNumber"
                            value={formData.bankAccountNumber}
                            onChange={(e) =>
                              updateFormData("bankAccountNumber", e.target.value)
                            }
                            placeholder="1234567"
                            maxLength={12}
                          />
                          <p className="text-xs text-muted-foreground">7-12 digits</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Void Cheque Upload *</Label>
                        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            className="hidden"
                            id="voidCheque"
                            onChange={(e) =>
                              updateFormData(
                                "voidChequeFile",
                                e.target.files?.[0] || null
                              )
                            }
                          />
                          <label
                            htmlFor="voidCheque"
                            className="cursor-pointer flex flex-col items-center gap-2"
                          >
                            <Upload className="w-8 h-8 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              {formData.voidChequeFile
                                ? formData.voidChequeFile.name
                                : "Click to upload void cheque"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              PDF, PNG, or JPG up to 5MB
                            </span>
                          </label>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="border-t border-border pt-4 mt-4">
                    <h3 className="font-medium mb-4">T5018 Tax Reporting</h3>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="t5018Consent"
                        checked={formData.t5018Consent}
                        onCheckedChange={(checked) =>
                          updateFormData("t5018Consent", checked === true)
                        }
                      />
                      <Label htmlFor="t5018Consent" className="text-sm cursor-pointer">
                        I understand that as a construction subcontractor, payments made
                        to me may be reported to the CRA under the T5018 tax reporting
                        requirements.
                      </Label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">Document Upload</h2>
                  <p className="text-sm text-muted-foreground">
                    Upload your WCB clearance letter for verification.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>WCB Clearance Letter *</Label>
                    <p className="text-sm text-muted-foreground">
                      Please upload a current WCB clearance letter showing your account
                      is in good standing.
                    </p>
                    <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        id="wcbClearance"
                        onChange={(e) =>
                          updateFormData("wcbClearanceFile", e.target.files?.[0] || null)
                        }
                      />
                      <label
                        htmlFor="wcbClearance"
                        className="cursor-pointer flex flex-col items-center gap-3"
                      >
                        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                          <Upload className="w-8 h-8 text-primary" />
                        </div>
                        <span className="text-sm font-medium">
                          {formData.wcbClearanceFile
                            ? formData.wcbClearanceFile.name
                            : "Click to upload WCB clearance letter"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          PDF, PNG, or JPG up to 10MB
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium text-sm mb-2">What happens next?</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>1. Our team will review your submitted documents</li>
                      <li>2. Verification typically takes 1-2 business days</li>
                      <li>3. You will receive an email when your account is activated</li>
                      <li>4. Once verified, you can submit invoices and receive payments</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
              <Button
                variant="outline"
                onClick={handlePrevStep}
                disabled={currentStep === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>

              {currentStep < 3 ? (
                <Button onClick={handleNextStep}>
                  Next Step
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Complete Onboarding
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
