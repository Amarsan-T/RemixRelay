import { STEP_COUNT } from '../audio/types'
import { PRESETS } from './data'
import { patternLength } from './patternAdapter'
import type { StudioProject } from './types'

/** One atomic edit keeps authored notes and channel-rack gates in agreement. */
export function togglePatternStep(project: StudioProject, pattern: number, channel: string, step: number): StudioProject {
  const notes = project.pianoNotes[pattern]?.[channel] ?? []
  const active = project.stepData[pattern]?.[channel]?.[step] === 1 || notes.some((note) => note.step === step)
  const gates = Array.from({ length: patternLength(project, pattern) }, (_, index) => project.stepData[pattern]?.[channel]?.[index] ?? 0)
  gates[step] = active ? 0 : 1
  return {
    ...project,
    stepData: { ...project.stepData, [pattern]: { ...project.stepData[pattern], [channel]: gates } },
    pianoNotes: active ? {
      ...project.pianoNotes,
      [pattern]: { ...project.pianoNotes[pattern], [channel]: notes.filter((note) => note.step !== step) },
    } : project.pianoNotes,
  }
}

/** Replaces only the selected pattern. Existing project/playlist/instruments stay intact. */
export function clearPattern(project: StudioProject, pattern: number): StudioProject {
  return {
    ...project,
    stepData: {
      ...project.stepData,
      [pattern]: Object.fromEntries(project.channels.map((channel) => [channel.id, Array<number>(patternLength(project, pattern)).fill(0)])),
    },
    pianoNotes: { ...project.pianoNotes, [pattern]: {} },
  }
}

export function randomizePattern(project: StudioProject, pattern: number, random = Math.random): StudioProject {
  const cleared = clearPattern(project, pattern)
  return {
    ...cleared,
    stepData: {
      ...cleared.stepData,
      [pattern]: Object.fromEntries(project.channels.map((channel) => [channel.id,
        Array.from({ length: patternLength(project, pattern) }, () => random() > 0.72 ? 1 : 0),
      ])),
    },
  }
}

/** Tile a one-bar preset to the chosen length; never leave hidden notes beyond its end. */
export function loadPatternPreset(project: StudioProject, pattern: number, name: string): StudioProject {
  const preset = PRESETS[name]
  if (!preset) return project
  const length = patternLength(project, pattern)
  return {
    ...project,
    bpm: preset.bpm,
    stepData: {
      ...project.stepData,
      [pattern]: Object.fromEntries(project.channels.map((channel) => [channel.id,
        Array.from({ length }, (_, step) => preset.steps[channel.id]?.[step % STEP_COUNT] ?? 0),
      ])),
    },
    pianoNotes: {
      ...project.pianoNotes,
      [pattern]: Object.fromEntries(project.channels.map((channel) => [channel.id,
        Array.from({ length: Math.ceil(length / STEP_COUNT) }, (_, bar) =>
          (preset.notes[channel.id] ?? []).map((note) => ({
            ...note, step: note.step + bar * STEP_COUNT,
            length: Math.min(note.length, length - note.step - bar * STEP_COUNT),
          })),
        ).flat().filter((note) => note.step < length && note.length > 0),
      ])),
    },
  }
}
