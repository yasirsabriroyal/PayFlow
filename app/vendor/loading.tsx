export default function VendorLoading() {
  return (
    <div className="min-h-screen bg-background p-6 animate-pulse">
      {/* Page header skeleton */}
      <div className="mb-8">
        <div className="h-8 w-48 bg-muted rounded mb-2" />
        <div className="h-4 w-72 bg-muted rounded" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-5">
            <div className="h-4 w-24 bg-muted rounded mb-3" />
            <div className="h-7 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="rounded-lg border bg-card p-5">
        <div className="h-5 w-32 bg-muted rounded mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 bg-muted rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}
