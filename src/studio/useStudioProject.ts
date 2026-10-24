import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createStudioProject } from './data'
import type { StudioProject } from './types'

/** All sequencer, note, channel, and mixer edits live in this one project state. */
export function useStudioProject() {
  const [project, setProject] = useState(createStudioProject)
  const setField = useCallback(<K extends keyof StudioProject>(field: K, action: SetStateAction<StudioProject[K]>) => {
    setProject((previous) => {
      const value = typeof action === 'function'
        ? (action as (current: StudioProject[K]) => StudioProject[K])(previous[field])
        : action
      return { ...previous, [field]: value }
    })
  }, [])
  const fieldSetter = <K extends keyof StudioProject>(field: K): Dispatch<SetStateAction<StudioProject[K]>> =>
    (action) => setField(field, action)
  return {
    project,
    setBpm: fieldSetter('bpm'), setLoop: fieldSetter('loop'), setMetronome: fieldSetter('metronome'),
    setChannels: fieldSetter('channels'), setStepData: fieldSetter('stepData'),
    setPianoNotes: fieldSetter('pianoNotes'), setMixerTracks: fieldSetter('mixerTracks'),
  }
}
