import { cn } from '@/lib/utils'

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15', className)}>
      {value === null ? (
        <div className="animate-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-primary" />
      ) : (
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      )}
    </div>
  )
}
