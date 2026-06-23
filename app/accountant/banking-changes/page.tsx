import { listBankingChangeRequests, listContractorsBankingStatus } from '@/lib/actions/banking-changes'
import { BankingChangesList } from './banking-changes-list'
import { ContractorBankingReviewList } from './contractor-banking-review-list'

export const dynamic = 'force-dynamic'

export default async function BankingChangesPage() {
  const [changeRequests, contractorStatuses] = await Promise.all([
    listBankingChangeRequests(),
    listContractorsBankingStatus(),
  ])

  if (!changeRequests.success && !contractorStatuses.success) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          You don&apos;t have permission to review banking information.
        </div>
      </main>
    )
  }

  // Contractors with pending_review status and no open change request need
  // direct profile review (backfilled by the Stage 2 migration).
  const contractorsPendingDirectReview = (contractorStatuses.contractors || []).filter(
    (c) => c.bankingApprovalStatus === 'pending_review'
  )

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">Banking Review</h1>
        <p className="text-muted-foreground mt-1">
          Review and approve contractor banking information. Account numbers are encrypted and never shown in full.
          Contractors must be approved before EFT payments can be processed.
        </p>
      </header>

      {/* Direct contractor banking profile review (backfill + direct entry) */}
      {contractorsPendingDirectReview.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold">Contractor Banking Profiles Pending Approval</h2>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-warning text-warning-foreground text-xs font-bold">
              {contractorsPendingDirectReview.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            These contractors have banking details on file but have not yet been reviewed.
            They cannot receive EFT payments until approved.
          </p>
          <ContractorBankingReviewList contractors={contractorsPendingDirectReview} />
        </section>
      )}

      {/* Banking change requests (contractor-submitted updates) */}
      <section>
        <h2 className="text-base font-semibold mb-4">Banking Change Requests</h2>
        {!changeRequests.success ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            Unable to load banking change requests.
          </div>
        ) : (
          <BankingChangesList requests={changeRequests.requests} />
        )}
      </section>

      {/* Contractor banking status overview */}
      {contractorStatuses.success && (
        <section className="mt-10">
          <h2 className="text-base font-semibold mb-4">All Contractors — Banking Status</h2>
          <ContractorBankingReviewList
            contractors={contractorStatuses.contractors || []}
            showAll
          />
        </section>
      )}
    </main>
  )
}
