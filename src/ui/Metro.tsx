// Decoration behind the studio panels: a soft wave texture and, as a Metro
// (Windows Phone / Windows 8) touch, the current view's name in huge thin
// letters. It's static, so it costs nothing while music plays.

/** Pink/purple wave band. Source and license: see ATTRIBUTION.md. */
const WAVES = '/textures/pink-waves.png'

/**
 * Sits behind the workspace. Put it first inside an `isolate` container:
 * it draws at z-index -10, under the panels but over the sky.
 */
export function MetroBackdrop({ title }: { title: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Wave texture: scaled wider than the screen so the band sweeps across the lower half */}
      <div
        className="absolute inset-0 opacity-0"
        style={{
          backgroundImage: `url(${WAVES})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
          backgroundPosition: 'center 78%',
        }}
      />
      {/* The view's name, huge and faint, running off the bottom-left edge */}
      <div className="metro-watermark absolute -bottom-4 -left-2 text-[11rem]">{title}</div>
    </div>
  )
}
