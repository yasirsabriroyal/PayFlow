import { listBankingChangeRequests } from '@/lib/actions/banking-changes'
import { BankingChangesList } from './banking-changes-list'

export const dynamic = 'force-dynamic'

export default async function BankingChangesPage() {
  const { success, requests } = await listBankingChangeRequests()

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">Banking Change Requests</h1>
        <p className="text-muted-foreground mt-1">
          Review and approve contractor banking updates. Account numbers are encrypted and never shown in full.
        </p>
      </header>

      {!success ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          You don&apos;t have permission to review banking changes.
        </div>
      ) : (
        <BankingChangesList requests={requests} />
      )}
    </main>
  )
}
