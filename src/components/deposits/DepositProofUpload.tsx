import { useRef, useState } from 'react'
import { Upload, FileCheck } from 'lucide-react'

// Optional (Part 20 — "do not make proof mandatory") file picker. The
// actual upload only happens after a deposit has been created (the backend
// needs a depositId to attach the file to — see DepositPage.tsx), so this
// component just collects the File and reports it back via onSelect.
export function DepositProofUpload({ file, onSelect }: { file: File | null; onSelect: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div>
      <label className="label">Upload Proof (optional)</label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const dropped = e.dataTransfer.files?.[0]
          if (dropped) onSelect(dropped)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        aria-label="Upload deposit proof"
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${dragOver ? 'border-ocean-400 bg-ocean-500/5' : 'border-ink-600 bg-ink-900 hover:border-ink-500'}`}
      >
        {file ? (
          <>
            <FileCheck className="h-6 w-6 text-bull" />
            <p className="text-xs font-medium text-white">{file.name}</p>
            <p className="text-[11px] text-slate-500">{(file.size / 1024).toFixed(0)} KB · Click to replace</p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-slate-500" />
            <p className="text-xs text-slate-400">Click or drag a screenshot/receipt here</p>
            <p className="text-[11px] text-slate-600">PNG, JPEG, WebP, GIF, or PDF · up to 5MB</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}
