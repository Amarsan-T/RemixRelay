import { useEffect, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { downloadBlob, encodeMp3, encodeWav } from '../music/render'

type Props = {
  /** File name without the extension. */
  fileName: string
  /** Produces the audio to save. */
  render: () => Promise<AudioBuffer>
  /** Called first, e.g. to stop playback so the live audio and the export don't overlap. */
  onBeforeExport?: () => void
}

type Format = 'wav' | 'mp3'

const FORMATS: { format: Format; label: string; detail: string }[] = [
  { format: 'wav', label: 'WAV', detail: 'Full quality, larger file' },
  { format: 'mp3', label: 'MP3', detail: 'Smaller file, easy to share' },
]

/** "Export" button with a WAV / MP3 menu. */
export function ExportButton({ fileName, render, onBeforeExport }: Props) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'rendering' | 'encoding'>('idle')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close the menu when clicking anywhere else.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function exportAs(format: Format) {
    setOpen(false)
    setError(null)
    onBeforeExport?.()
    try {
      setStatus('rendering')
      const buffer = await render()
      setStatus('encoding')
      // Let the "Encoding…" label paint before the encoder keeps the page busy.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const blob = format === 'wav' ? encodeWav(buffer) : await encodeMp3(buffer)
      downloadBlob(blob, `${safeFileName(fileName)}.${format}`)
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setStatus('idle')
    }
  }

  const busy = status !== 'idle'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-line-strong disabled:opacity-60"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        {status === 'rendering' ? 'Rendering…' : status === 'encoding' ? 'Encoding…' : 'Export'}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-white p-1 shadow-lg"
        >
          {FORMATS.map((f) => (
            <button
              key={f.format}
              type="button"
              role="menuitem"
              onClick={() => exportAs(f.format)}
              className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-black/[.04]"
            >
              <span className="text-sm font-medium">Download {f.label}</span>
              <span className="text-xs text-muted">{f.detail}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="absolute right-0 mt-2 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

/** Removes characters Windows and macOS don't allow in file names. */
function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'RemixRelay export'
}
