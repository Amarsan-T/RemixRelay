import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

// Frutiger Aero building blocks. They're thin wrappers around the aero-* classes
// in src/index.css, so screens stay readable and share one look.

/** Bubbles drifting over the sky: size, position, and how they float. Fixed, so every visit looks the same. */
const BUBBLES = [
  { size: 140, left: '6%', top: '58%', time: 16, x: 18, y: -30 },
  { size: 70, left: '18%', top: '22%', time: 12, x: -10, y: -22 },
  { size: 220, left: '72%', top: '48%', time: 20, x: -24, y: -36 },
  { size: 46, left: '58%', top: '16%', time: 10, x: 12, y: -18 },
  { size: 96, left: '88%', top: '14%', time: 15, x: -14, y: 20 },
  { size: 34, left: '40%', top: '72%', time: 9, x: 10, y: -26 },
  { size: 58, left: '30%', top: '86%', time: 13, x: -16, y: -14 },
]

/** Full-screen sky with floating bubbles behind the content. */
export function AeroBackground({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`aero-sky relative min-h-screen overflow-hidden ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="aero-bubble"
            style={{
              width: b.size, height: b.size, left: b.left, top: b.top,
              '--float-time': `${b.time}s`, '--drift-x': `${b.x}px`, '--drift-y': `${b.y}px`,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  /** 'light' frosted glass with dark text, or 'dark' smoky glass with light text. */
  tone?: 'light' | 'dark'
  /** Adds the shine across the top half. */
  gloss?: boolean
}

/** A frosted-glass surface. */
export function GlassPanel({ tone = 'light', gloss = false, className = '', ...rest }: PanelProps) {
  const surface = tone === 'light' ? 'aero-glass' : 'aero-glass-dark'
  return <div className={`${surface} ${gloss ? 'aero-gloss' : ''} ${className}`} {...rest} />
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** aqua = main action, lime = running/on, smoke = glass on dark, frost = glass on light. */
  variant?: 'aqua' | 'lime' | 'smoke' | 'frost'
}

/** A glossy pill button. */
export function GlassButton({ variant = 'aqua', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`aero-pill aero-${variant} ${className}`} {...rest} />
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Icon shown inside the pill, before the text. */
  icon?: ReactNode
}

/** A bubbly, rounded text box for light surfaces. */
export function GlassInput({ icon, className = '', ...rest }: InputProps) {
  return (
    <label className={`aero-input flex items-center gap-2 px-3 ${className}`}>
      {icon && <span className="shrink-0 text-aero-ink-soft">{icon}</span>}
      <input className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-aero-ink-soft/70" {...rest} />
    </label>
  )
}
