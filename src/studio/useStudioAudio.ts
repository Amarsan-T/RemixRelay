import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine, validatePattern } from '../audio'
import type { PlaybackState } from '../audio'
import { DRUM_CHANNELS, toAudioPattern, toAudioSong } from './patternAdapter'
import type { StudioProject } from './types'

export type PlayMode = 'pattern' | 'song'

/** One engine per mounted studio. React project state is the only edit source. */
export function useStudioAudio(project: StudioProject, activePattern: number, mode: PlayMode = 'pattern') {
  const engineRef = useRef<AudioEngine | null>(null)
  // PAT loops the selected pattern; SONG plays the whole playlist.
  const pattern = useMemo(
    () => mode === 'song' ? toAudioSong(project) : toAudioPattern(project, activePattern),
    [project, activePattern, mode],
  )
  const patternError = useMemo(() => {
    try { validatePattern(pattern); return null }
    catch (error) { return error instanceof Error ? error.message : String(error) }
  }, [pattern])
  const patternRef = useRef(pattern)
  const [playback, setPlayback] = useState<PlaybackState>({
    status: 'stopped', step: null, bpm: project.bpm, loop: project.loop, initialized: false,
  })
  const [audioError, setAudioError] = useState<string | null>(null)

  const report = useCallback((error: unknown) => {
    setAudioError(error instanceof Error ? error.message : String(error))
  }, [])

  useLayoutEffect(() => {
    if (patternError) return
    patternRef.current = pattern
    engineRef.current?.setPattern(pattern)
  }, [pattern, patternError])

  useEffect(() => {
    const engine = new AudioEngine(patternRef.current)
    engineRef.current = engine
    const unsubscribe = engine.subscribe(setPlayback)
    const onPageHide = () => engine.stop()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      unsubscribe()
      engine.dispose()
      if (engineRef.current === engine) engineRef.current = null
    }
  }, [])

  const play = useCallback(() => {
    if (patternError) return
    const engine = engineRef.current
    if (!engine) return
    setAudioError(null)
    try {
      engine.setPattern(patternRef.current)
      void engine.play().catch((error: unknown) => {
        if (engineRef.current === engine) report(error)
      })
    } catch (error) { report(error) }
  }, [patternError, report])
  const stop = useCallback(() => engineRef.current?.stop(), [])
  const preview = useCallback((id: string, pitch?: string) => {
    if (patternError) return
    const engine = engineRef.current
    if (!engine) return
    setAudioError(null)
    try {
      engine.setPattern(patternRef.current)
      void engine.previewTrack(id, { drum: DRUM_CHANNELS[id], pitch }).catch((error: unknown) => {
        if (engineRef.current === engine) report(error)
      })
    } catch (error) { report(error) }
  }, [patternError, report])
  const getOutputLevels = useCallback((): [number, number] => engineRef.current?.getOutputLevels() ?? [0, 0], [])
  return { playback, audioError: patternError ?? audioError, play, stop, preview, getOutputLevels }
}
