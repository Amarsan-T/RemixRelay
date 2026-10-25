// A Metro (Windows Phone / Windows 8) touch behind the studio panels: the
// current view's name in huge thin letters. It's static, so it costs nothing
// while music plays.

/**
 * Sits behind the workspace. Put it first inside an `isolate` container:
 * it draws at z-index -10, under the panels but over the sky.
 */
export function MetroBackdrop({ title }: { title: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* The view's name, huge and faint, running off the bottom-left edge */}
      <div className="metro-watermark absolute -bottom-4 -left-2 text-[11rem]">{title}</div>
    </div>
  )
}
