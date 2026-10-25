import { useState, useEffect, useRef } from 'react';
import {
  Play, Square, Volume2, RotateCcw, Sliders, Music, Grid, Sparkles,
  Trash2, Zap, Radio, Layers, ListMusic, Home, Cloud, CloudOff, Link, Check,
} from 'lucide-react';
import { PRESETS } from './src/studio/data';
import { useStudioProject } from './src/studio/useStudioProject';
import { useStudioAudio, type PlayMode } from './src/studio/useStudioAudio';
import { MAX_PATTERNS, patternLength, patternNumbers, patternStepAt } from './src/studio/patternAdapter';
import { PatternLengthControl } from './src/studio/PatternLengthControl';
import { StudioPianoRoll } from './src/studio/StudioPianoRoll';
import { StudioPlaylist } from './src/studio/StudioPlaylist';
import { MetroBackdrop } from './src/ui/Metro';
import { TempoControl } from './src/studio/TempoControl';
import { clearPattern, loadPatternPreset, randomizePattern as randomizedPattern, togglePatternStep } from './src/studio/patternEditing';

/** Shown huge and faint behind each view (Metro style). */
const VIEW_TITLES: Record<string, string> = {
  playlist: 'playlist', channelRack: 'channel rack', pianoRoll: 'piano roll', mixer: 'mixer',
};
import type { MixerParam, StudioChannel, StudioProject } from './src/studio/types';
import type { ProjectChange } from './src/studio/projectSync';
import { applySuggestions, resolveSuggestions } from './convex/noteSuggestions';
import type { NoteSuggestion, ResolvedSuggestion } from './convex/noteSuggestions';
import { CoachBar } from './src/assistant/CoachBar';
import { rackHighlights, viewFor, type ActiveSuggestions, type StudioView } from './src/assistant/noteCoach';

type StudioProps = {
  /** Project to open. Without one, the studio starts with the Trap Heat demo. */
  initialProject?: StudioProject;
  /** Shown under the logo. */
  projectName?: string;
  /** Called with the project after every edit, so going home keeps your work. */
  onProjectChange?: (project: StudioProject) => void;
  /** Shows a HOME button that calls this. */
  onHome?: () => void;
  /**
   * Connects the studio to live sync: it's given a function that merges edits
   * from other browsers into the studio, and returns a disconnect.
   */
  connectRemote?: (apply: (changes: readonly ProjectChange[]) => void) => () => void;
  /** Shows whether edits have reached the server. */
  saveState?: 'saved' | 'saving' | 'error';
  /** Shows a Share button that copies this link. */
  shareUrl?: string;
  /** AI note suggestions from the chat to highlight in the editors. Only this browser sees them. */
  noteCoach?: { active: ActiveSuggestions; onClear: () => void };
};

export default function App({ initialProject, projectName, onProjectChange, onHome, connectRemote, saveState, shareUrl, noteCoach }: StudioProps) {
  const {
    project, updateProject, applyChanges, setBpm, setLoop, setMetronome, setChannels,
    setStepData, setPianoNotes, setMixerTracks, setSong, setPatternSteps, setPatternCount,
  } = useStudioProject(initialProject);

  // Edits made in another browser merge into the latest state. Playback picks them up like local edits.
  useEffect(() => connectRemote?.(applyChanges), [connectRemote, applyChanges]);
  const [linkCopied, setLinkCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (e.g. plain http); show the link instead.
      window.prompt('Copy this link to share the project:', shareUrl);
    }
  };

  // Report edits upward. The callback sits in a ref so a new function from the
  // parent on each render doesn't re-run this; opening a project isn't an edit.
  const onProjectChangeRef = useRef(onProjectChange);
  useEffect(() => { onProjectChangeRef.current = onProjectChange; });
  useEffect(() => {
    if (project !== initialProject) onProjectChangeRef.current?.(project);
    // initialProject only matters for the first comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);
  const { bpm, loop, metronome, channels, stepData, pianoNotes, mixerTracks } = project;
  // Projects open on the song arrangement.
  const [activeTab, setActiveTab] = useState<StudioView>(project.song.clips.length ? 'playlist' : 'channelRack');
  const [selectedChannelId, setSelectedChannelId] = useState('synth_lead');
  const [activePattern, setActivePattern] = useState(1);
  // PAT loops the selected pattern; SONG plays the playlist.
  const [playMode, setPlayMode] = useState<PlayMode>(project.song.clips.length ? 'song' : 'pattern');
  const { playback, audioError, play: handlePlay, stop: handleStop, preview, getOutputLevels } = useStudioAudio(project, activePattern, playMode);
  const isPlaying = playback.status === 'playing';
  const currentStep = playback.step ?? 0;
  // In SONG mode the playhead counts across bars; the 16-step views show its position in the bar.
  const stepInBar = currentStep % 16;
  // Patterns can be any number of steps long (16 = one bar).
  const patternSteps = patternLength(project, activePattern);
  const patterns = patternNumbers(project);
  /** Adds an empty pattern after the last one and selects it. */
  const addPattern = () => {
    if (patterns.length >= MAX_PATTERNS) return;
    const next = patterns.length + 1;
    setPatternCount(next);
    setActivePattern(next);
  };
  // Where the pattern on screen is up to, or null when you aren't hearing it.
  const patternPlayStep = !isPlaying ? null
    : playMode === 'pattern' ? currentStep : patternStepAt(project, activePattern, currentStep);
  const masterVol = mixerTracks.find((track) => track.id === 0)?.vol ?? 0.85;

  // AI coach: suggestions are re-checked against the live project on every
  // render, so highlights follow edits from this browser and collaborators.
  const coachItems = noteCoach ? resolveSuggestions(project, noteCoach.active.set.items) : [];
  const rackPads = rackHighlights(coachItems, activePattern);
  // The piano roll shows the selected channel, or the first melodic one if a drum is selected.
  const melodicChannels = channels.filter((channel) => channel.type !== 'drum');
  const pianoChannelId = (melodicChannels.find((channel) => channel.id === selectedChannelId) ?? melodicChannels[0])?.id;
  const showSuggestion = (item: ResolvedSuggestion) => {
    const target = viewFor(item);
    setActivePattern(target.pattern);
    setSelectedChannelId(target.channelId);
    setActiveTab(target.view);
  };
  // Never called on its own: only from Apply buttons the user pressed.
  const applyCoachSuggestions = (items: NoteSuggestion[]) => updateProject((previous) => applySuggestions(previous, items));
  // Asking to see suggestions opens the first one still to do.
  const coachFocus = noteCoach ? `${noteCoach.active.messageId}:${noteCoach.active.focus}` : '';
  useEffect(() => {
    const first = coachItems.find((item) => item.status === 'pending');
    if (coachFocus && first) showSuggestion(first);
    // Only when someone asks to be shown, never because the project changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachFocus]);
  const masterMeterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleMixerParam = <K extends MixerParam>(trackId: number, param: K, value: typeof mixerTracks[number][K]) => {
    setMixerTracks(prev => prev.map(track => track.id === trackId ? { ...track, [param]: value } : track));
  };
  const setMasterVol = (value: number) => handleMixerParam(0, 'vol', value);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || event.repeat || target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      if (playback.status === 'playing' || playback.status === 'starting') handleStop();
      else handlePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlay, handleStop, playback.status]);

  // Master visualizer loop
  useEffect(() => {
    let animId: number;
    const canvas = masterMeterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawMeter = () => {
      animId = requestAnimationFrame(drawMeter);
      const levels = getOutputLevels();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Dual Stereo Peak Meter Bars
      const numSegments = 18;
      const segWidth = (canvas.width - 6) / 2;
      const segHeight = (canvas.height - 4) / numSegments;

      for (let channel = 0; channel < 2; channel++) {
        const xOffset = channel * (segWidth + 4) + 1;
        // Actual left/right levels from the shared engine.
        const chLevel = Math.min(1, Math.sqrt(levels[channel]) * 1.8);
        const activeSegments = Math.floor(chLevel * numSegments);

        for (let s = 0; s < numSegments; s++) {
          const y = canvas.height - (s + 1) * segHeight;
          const isLit = s < activeSegments;

          let color = '#2e7d32'; // Green
          if (s > 11) color = '#fbc02d'; // Yellow
          if (s > 15) color = '#d32f2f'; // Red

          ctx.fillStyle = isLit ? color : '#1a221f';
          ctx.shadowColor = isLit ? color : 'transparent';
          ctx.shadowBlur = isLit ? 4 : 0;
          ctx.fillRect(xOffset, y + 1, segWidth, segHeight - 2);
        }
      }
    };

    drawMeter();
    return () => cancelAnimationFrame(animId);
  }, [getOutputLevels]);

  // Toggle Step Sequencer cell
  const toggleStep = (channelId: string, stepIndex: number) => {
    const hasNotes = pianoNotes[activePattern]?.[channelId]?.some(note => note.step === stepIndex) ?? false;
    const wasActive = stepData[activePattern]?.[channelId]?.[stepIndex] === 1 || hasNotes;
    updateProject(previous => togglePatternStep(previous, activePattern, channelId, stepIndex));

    // Preview sound when toggling ON
    const ch = channels.find(c => c.id === channelId);
    if (ch && !wasActive && !isPlaying) {
      previewChannelSound(ch);
    }
  };

  const previewChannelSound = (channel: StudioChannel) => preview(channel.id);

  // Load Preset
  const loadPreset = (presetName: string) => {
    updateProject(previous => loadPatternPreset(previous, activePattern, presetName));
  };

  // Clear current pattern
  const clearCurrentPattern = () => {
    updateProject(previous => clearPattern(previous, activePattern));
  };

  // Randomize pattern
  const randomizePattern = () => {
    updateProject(previous => randomizedPattern(previous, activePattern));
  };

  // Channel Mute & Solo
  const toggleMute = (channelId: string) => {
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, muted: !ch.muted } : ch));
  };

  const toggleSolo = (channelId: string) => {
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, solo: !ch.solo } : ch));
  };

  // Song position calculation
  const bars = Math.floor(currentStep / 16) + 1;
  const beats = Math.floor((currentStep % 16) / 4) + 1;
  const ticks = (currentStep % 4) + 1;

  return (
    <div className="studio-shell flex flex-col h-dvh w-full aero-sky text-zinc-200 select-none overflow-hidden">
      {/* ==================================================== */}
      {/* 1. TOP TRANSPORT BAR (FL Studio Classic Toolbar)     */}
      {/* ==================================================== */}
      <header className="aero-glass-dark aero-gloss flex shrink-0 flex-wrap items-center justify-between px-3 py-2 gap-2 z-20 border-x-0 border-t-0">
        
        {/* Left: Brand & Mode Toggle */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 pr-2.5 border-r border-white/10">
            <div className="aero-pill aero-aqua w-8 h-8 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="leading-tight">
              <span className="text-sm font-semibold tracking-[0.18em] text-white block">REMIXRELAY</span>
              <span className="text-[10px] text-aero-glow/80 uppercase tracking-widest font-semibold block max-w-40 truncate">{projectName ?? 'Music Studio'}</span>
            </div>
          </div>

          {onHome && (
            <button
              type="button"
              aria-label="Home"
              title="Back to your projects"
              onClick={() => { handleStop(); onHome(); }}
              className="aero-pill aero-smoke px-2.5 py-1 text-xs"
            >
              <Home className="w-3.5 h-3.5" /> HOME
            </button>
          )}

          {shareUrl && (
            <button
              type="button"
              aria-label="Copy share link"
              title="Copy a link anyone can open to edit this project with you"
              onClick={copyShareLink}
              className="aero-pill aero-smoke px-2.5 py-1 text-xs"
            >
              {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link className="w-3.5 h-3.5" />}
              {linkCopied ? 'COPIED' : 'SHARE'}
            </button>
          )}

          {saveState && (
            <span
              role="status"
              aria-label="Save status"
              title={saveState === 'error' ? 'Not saved yet. Retrying.' : saveState === 'saving' ? 'Saving your changes' : 'All changes saved'}
              className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider ${
                saveState === 'error' ? 'text-red-300' : saveState === 'saving' ? 'text-amber-200' : 'text-sky-100/60'
              }`}
            >
              {saveState === 'error' ? <CloudOff className="w-3.5 h-3.5" /> : <Cloud className="w-3.5 h-3.5" />}
              {saveState === 'error' ? 'Offline' : saveState === 'saving' ? 'Saving' : 'Saved'}
            </span>
          )}

          {/* Mode Switcher: PAT vs SONG */}
          <div className="aero-well flex items-center p-0.5">
            <button
              aria-label="Pattern playback mode"
              aria-pressed={playMode === 'pattern'}
              onClick={() => setPlayMode('pattern')}
              className={`px-2.5 py-1 text-xs ${playMode === 'pattern' ? 'aero-pill aero-aqua' : 'rounded-full font-semibold text-sky-100/70 hover:text-white'}`}
            >
              PAT
            </button>
            <button
              aria-label="Song playback mode"
              aria-pressed={playMode === 'song'}
              title="Play the whole playlist"
              onClick={() => setPlayMode('song')}
              className={`px-2.5 py-1 text-xs ${playMode === 'song' ? 'aero-pill aero-aqua' : 'rounded-full font-semibold text-sky-100/70 hover:text-white'}`}
            >
              SONG
            </button>
          </div>

          {/* Pattern Selector */}
          <div className="aero-well flex items-center gap-1 px-2 py-1 max-w-72 overflow-x-auto">
            <Layers className="w-3.5 h-3.5 text-aero-glow shrink-0" />
            <span className="text-xs font-semibold text-sky-100/70">PAT:</span>
            {patterns.map(num => (
              <button
                key={num}
                onClick={() => setActivePattern(num)}
                aria-label={`Select pattern ${num}`}
                aria-pressed={activePattern === num}
                className={`min-w-5 h-5 px-1 shrink-0 text-xs flex items-center justify-center transition-all ${
                  activePattern === num
                    ? 'aero-pill aero-aqua'
                    : 'rounded-full font-semibold text-sky-100/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={addPattern}
              disabled={patterns.length >= MAX_PATTERNS}
              aria-label="New pattern"
              title="Add a pattern"
              className="w-5 h-5 shrink-0 text-xs font-bold rounded-full flex items-center justify-center text-sky-100/70 hover:bg-white/10 hover:text-white border border-dashed border-sky-200/40"
            >
              +
            </button>
          </div>
        </div>

        {/* Center: Playback Controls & LED Displays */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {/* Main Transport Buttons */}
          <div className="aero-well flex items-center gap-1.5 p-1">
            <button
              onClick={handlePlay}
              aria-label="Play"
              aria-pressed={isPlaying}
              disabled={playback.status === 'starting'}
              title="Play (Space)"
              className={`w-8 h-8 ${isPlaying ? 'aero-pill aero-lime' : 'aero-pill aero-smoke'}`}
            >
              <Play className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={() => setLoop(value => !value)}
              aria-label="Loop"
              aria-pressed={loop}
              title={loop ? 'Loop enabled' : 'Play once to the end'}
              className={`w-8 h-8 ${loop ? 'aero-pill aero-aqua' : 'aero-pill aero-smoke'}`}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleStop}
              aria-label="Stop"
              title="Stop"
              className="aero-pill aero-smoke w-8 h-8"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* FL Studio Signature Digital LCD Counter */}
          <div className="aero-lcd flex shrink-0 items-center gap-2.5 px-3 py-1.5 rounded-xl whitespace-nowrap" aria-label="Playback position">
            <div className="text-right">
              <span className="text-[9px] uppercase tracking-wider text-sky-200/50 block leading-none">Pos</span>
              <span className="font-mono text-sm tracking-widest font-bold">
                {String(bars).padStart(2, '0')}:{String(beats).padStart(2, '0')}:{String(ticks).padStart(2, '0')}
              </span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <span className="text-[9px] uppercase tracking-wider text-sky-200/50 block leading-none">Step</span>
              <span className="font-mono text-sm font-bold text-lime-300 [text-shadow:0_0_6px_rgba(190,242,100,0.6)]">
                {String(stepInBar + 1).padStart(2, '0')} / 16
              </span>
            </div>
          </div>

          {/* BPM Control & Tap Tempo */}
          <TempoControl bpm={bpm} setBpm={setBpm} />

          {/* Metronome Button */}
          <button
            onClick={() => setMetronome(!metronome)}
            title="Metronome"
            aria-label="Metronome"
            aria-pressed={metronome}
            className={`w-8 h-8 ${metronome ? 'aero-pill aero-aqua' : 'aero-pill aero-smoke'}`}
          >
            <Radio className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Master Volume & Stereo Visualizer Canvas */}
        <div className="flex items-center gap-3">
          {/* Master Volume */}
          <div className="aero-well flex items-center gap-1.5 px-2.5 py-1">
            <Volume2 className="w-3.5 h-3.5 text-sky-100/70" />
            <input
              type="range"
              min="0"
              max="1.2"
              step="0.01"
              aria-label="Master volume"
              value={masterVol}
              onChange={(e) => setMasterVol(parseFloat(e.target.value))}
              className="w-14 h-1.5 rounded-lg cursor-pointer accent-sky-400"
              title={`Master Vol: ${Math.round(masterVol * 100)}%`}
            />
            <span className="text-[10px] font-mono text-sky-100/70 w-7 text-right">
              {Math.round(masterVol * 100)}%
            </span>
          </div>

          {/* Stereo Master Peak LEDs Canvas */}
          <div className="aero-lcd p-1 rounded-lg flex flex-col items-center">
            <canvas
              ref={masterMeterCanvasRef}
              width={28}
              height={32}
              className="rounded"
              title="Master Stereo Peak Meter"
            />
            <span className="text-[8px] text-sky-200/50 tracking-wider">OUT</span>
          </div>
        </div>
      </header>

      {audioError && <div role="alert" className="bg-red-950 text-red-200 border-b border-red-700 px-4 py-2 text-sm">{audioError}</div>}

      {/* ==================================================== */}
      {/* 2. SUB-BAR: Presets, Quick Tools, and Tab Switchers  */}
      {/* ==================================================== */}
      <div className="studio-tools aero-glass z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs text-aero-ink rounded-none border-x-0 border-t-0">
        {/* Preset Selector */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <span className="text-aero-ink-soft text-[11px] font-semibold flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-500" /> Presets:
          </span>
          <div className="flex flex-wrap gap-1">
            {Object.keys(PRESETS).map((pName) => (
              <button
                key={pName}
                onClick={() => loadPreset(pName)}
                title={`Replace Pattern ${activePattern} with ${pName}`}
                className="aero-pill aero-frost px-2.5 py-0.5 text-[11px]"
              >
                {pName}
              </button>
            ))}
          </div>
        </div>

        {/* Pattern Quick Operations */}
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button
            onClick={randomizePattern}
            className="aero-pill aero-aqua px-2.5 py-0.5 text-[11px]"
          >
            <Sparkles className="w-3 h-3" /> Randomize
          </button>
          <button
            onClick={clearCurrentPattern}
            className="aero-pill aero-frost px-2.5 py-0.5 text-[11px] hover:text-red-600"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>

          {/* Layout Tab Switchers */}
          <nav aria-label="Studio views" className="studio-tabs flex max-w-full flex-wrap items-end gap-x-5 gap-y-2 pb-1 lg:ml-5">
            <button
              onClick={() => setActiveTab('playlist')}
              aria-pressed={activeTab === 'playlist'}
              className="metro-pivot flex items-center gap-1.5"
            >
              <ListMusic className="w-3.5 h-3.5" /> Playlist
            </button>
            <button
              onClick={() => setActiveTab('channelRack')}
              aria-pressed={activeTab === 'channelRack'}
              className="metro-pivot flex items-center gap-1.5"
            >
              <Grid className="w-3.5 h-3.5" /> Channel Rack
            </button>
            <button
              onClick={() => setActiveTab('pianoRoll')}
              aria-pressed={activeTab === 'pianoRoll'}
              className="metro-pivot flex items-center gap-1.5"
            >
              <Music className="w-3.5 h-3.5" /> Piano Roll
            </button>
            <button
              onClick={() => setActiveTab('mixer')}
              aria-pressed={activeTab === 'mixer'}
              className="metro-pivot flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" /> Mixer
            </button>
          </nav>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. MAIN WORKSPACE AREA                              */}
      {/* ==================================================== */}
      <main className="min-h-0 flex-1 overflow-auto relative isolate p-3 sm:p-4 flex flex-col justify-start">
        <MetroBackdrop title={VIEW_TITLES[activeTab] ?? ''} />

        {noteCoach && coachItems.length > 0 && (
          <CoachBar
            // A new reply starts with its list open and no pending confirmation.
            key={noteCoach.active.messageId}
            items={coachItems}
            summary={noteCoach.active.set.summary}
            skipped={noteCoach.active.set.skipped}
            view={activeTab}
            pattern={activePattern}
            pianoChannelId={pianoChannelId}
            onGo={showSuggestion}
            onApply={applyCoachSuggestions}
            onClear={noteCoach.onClear}
          />
        )}

        {/* VIEW 1: CHANNEL RACK & STEP SEQUENCER */}
        {activeTab === 'channelRack' && (
          <div className="aero-panel max-w-6xl w-full mx-auto overflow-hidden">
            {/* Header */}
            <div className="aero-panel-header flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <h2 className="text-sm font-semibold tracking-wide text-white">
                  Channel Rack • Pattern {activePattern}
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                <PatternLengthControl
                  key={activePattern}
                  project={project}
                  pattern={activePattern}
                  setPatternSteps={setPatternSteps}
                  setStepData={setStepData}
                  setPianoNotes={setPianoNotes}
                />
                <span className="text-zinc-600">|</span>
                <span>16th-note grid</span>
              </div>
            </div>

            {/* Channels & Step Grid */}
            <div className="overflow-x-auto" role="region" aria-label="Channel step sequencer" tabIndex={0}>
            <div className="divide-y divide-white/5" style={{ minWidth: Math.max(720, 320 + patternSteps * 32) }}>
              {channels.map((channel) => {
                const currentPatternSteps = stepData[activePattern]?.[channel.id] || new Array(patternSteps).fill(0);
                const isSelected = selectedChannelId === channel.id;

                return (
                  <div
                    key={channel.id}
                    onClick={() => setSelectedChannelId(channel.id)}
                    className={`flex items-center px-3 py-1.5 transition-colors ${
                      isSelected ? 'bg-sky-400/10' : 'hover:bg-white/5'
                    }`}
                  >
                    {/* Left: Channel Controls (Pan, Vol, Mute, Solo) */}
                    <div className="studio-channel-controls flex items-center self-stretch gap-2 w-72 shrink-0 sm:sticky sm:left-0 z-10">
                      {/* Selection LED */}
                      <div className={`w-1.5 h-6 rounded-full transition-all ${
                        isSelected ? 'bg-aero-glow shadow-[0_0_8px_#7fe3ff]' : 'bg-transparent'
                      }`} />

                      {/* Mute & Solo buttons */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleMute(channel.id); }}
                        className={`w-5 h-5 text-[9px] ${channel.muted ? 'aero-pill aero-ruby' : 'aero-pill aero-smoke'}`}
                        title="Mute Channel"
                        aria-label={`Mute ${channel.name}`}
                        aria-pressed={channel.muted}
                      >
                        M
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSolo(channel.id); }}
                        className={`w-5 h-5 text-[9px] ${channel.solo ? 'aero-pill aero-amber' : 'aero-pill aero-smoke'}`}
                        title="Solo Channel"
                        aria-label={`Solo ${channel.name}`}
                        aria-pressed={channel.solo}
                      >
                        S
                      </button>

                      {/* Pan Knob Slider */}
                      <div className="flex flex-col items-center" title={`Pan: ${channel.pan}`}>
                        <span className="text-[8px] text-sky-100/60 leading-none">PAN</span>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.05"
                          aria-label={`${channel.name} pan`}
                          value={channel.pan}
                          onChange={(e) => {
                            e.stopPropagation();
                            const val = parseFloat(e.target.value);
                            setChannels(prev => prev.map(c => c.id === channel.id ? { ...c, pan: val } : c));
                          }}
                          className="w-10 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
                        />
                      </div>

                      {/* Volume Slider */}
                      <div className="flex flex-col items-center" title={`Vol: ${Math.round(channel.vol * 100)}%`}>
                        <span className="text-[8px] text-sky-100/60 leading-none">VOL</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.02"
                          aria-label={`${channel.name} volume`}
                          value={channel.vol}
                          onChange={(e) => {
                            e.stopPropagation();
                            const val = parseFloat(e.target.value);
                            setChannels(prev => prev.map(c => c.id === channel.id ? { ...c, vol: val } : c));
                          }}
                          className="w-12 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                        />
                      </div>

                      {/* Channel Name Button / Preview Trigger */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          previewChannelSound(channel);
                          setSelectedChannelId(channel.id);
                        }}
                        className="aero-pill aero-smoke min-w-0 flex-1 justify-between px-2 py-1 text-left group"
                      >
                        <span className="min-w-0 text-xs font-semibold text-white group-hover:text-aero-glow transition truncate">
                          {channel.name}
                        </span>
                        <span
                          className="shrink-0 whitespace-nowrap text-[9px] px-1.5 py-0.2 rounded font-mono font-bold"
                          style={{ backgroundColor: `${channel.color}33`, color: channel.color }}
                        >
                          Trk {channel.mixerTrack}
                        </span>
                      </button>
                    </div>

                    {/* Right: Step Sequencer Pads (FL 4-beat color grouping) */}
                    <div className="flex items-center gap-1 pl-4 flex-1">
                      {Array.from({ length: patternSteps }).map((_, stepIdx) => {
                        const isStepActive = currentPatternSteps[stepIdx] === 1 || (channel.type !== 'drum' &&
                          (pianoNotes[activePattern]?.[channel.id]?.some(note => note.step === stepIdx) ?? false));
                        const isCurrentPlayStep = patternPlayStep === stepIdx;
                        const coachPad = rackPads.get(`${channel.id}:${stepIdx}`);
                        // FL Studio 4-beat grouping (alternating colors every 4 steps)
                        const groupIdx = Math.floor(stepIdx / 4);
                        const isEvenGroup = groupIdx % 2 === 0;

                        return (
                          <button
                            key={stepIdx}
                            onClick={() => toggleStep(channel.id, stepIdx)}
                            aria-label={`${channel.name} step ${stepIdx + 1}`}
                            aria-description={coachPad?.label}
                            title={coachPad?.label}
                            aria-pressed={isStepActive}
                            className={`h-9 flex-1 min-w-[28px] max-w-[44px] rounded-[3px] border transition-all duration-75 relative flex items-center justify-center ${
                              isStepActive
                                ? 'bg-gradient-to-b from-[#6fd3ff] to-[#0a84d6] border-[#7fe3ff] shadow-[0_0_10px_rgba(30,167,242,0.5)]'
                                : isEvenGroup
                                ? 'bg-[#32373d] hover:bg-[#3b4148] border-zinc-700/80'
                                : 'bg-[#25292e] hover:bg-[#2d3238] border-zinc-800'
                            } ${isCurrentPlayStep ? 'ring-2 ring-lime-300 ring-offset-1 ring-offset-[#14212e] scale-[1.05]' : ''}`}
                          >
                            {/* Inner LED highlight notch */}
                            <div className={`w-3/4 h-1.5 rounded-full ${
                              isStepActive 
                                ? 'bg-white/85 shadow-[0_0_4px_#fff]' 
                                : 'bg-black/25'
                            }`} />
                            {coachPad && <span aria-hidden="true" className={`coach-pad ${coachPad.kind}`} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        )}

        {/* VIEW 0: SONG PLAYLIST */}
        {activeTab === 'playlist' && (
          <StudioPlaylist
            project={project}
            setSong={setSong}
            activePattern={activePattern}
            onSelectPattern={setActivePattern}
            onNewPattern={addPattern}
            onOpenPattern={(pattern) => { setActivePattern(pattern); setActiveTab('channelRack'); setPlayMode('pattern'); }}
            playStep={playMode === 'song' && isPlaying ? currentStep : null}
          />
        )}

        {/* VIEW 2: PIANO ROLL & MELODY EDITOR */}
        {activeTab === 'pianoRoll' && (
          <StudioPianoRoll
            project={project}
            activePattern={activePattern}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            setChannels={setChannels}
            setPianoNotes={setPianoNotes}
            setStepData={setStepData}
            preview={preview}
            playStep={patternPlayStep}
            setPatternSteps={setPatternSteps}
            suggestions={coachItems}
          />
        )}

        {/* VIEW 3: MULTI-CHANNEL MIXER & EFFECTS */}
        {activeTab === 'mixer' && (
          <div className="aero-panel max-w-6xl w-full mx-auto p-4 flex flex-col gap-4">
            {/* Mixer Header */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-aero-glow" />
                <h2 className="text-sm font-semibold tracking-wide text-white">
                  Master & Insert Mixer (6 Tracks + Master Bus)
                </h2>
              </div>
              <div className="text-[11px] text-zinc-400 font-mono">
                Real-Time EQ / Delay / Overdrive DSP
              </div>
            </div>

            {/* Mixer Strips Container */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {mixerTracks.map((track) => {
                const isMaster = track.id === 0;

                return (
                  <div
                    key={track.id}
                    className={`rounded-lg border p-2.5 flex flex-col items-center gap-2 relative ${
                      isMaster 
                        ? 'aero-strip !border-aero-glow/60 shadow-[0_0_14px_rgba(127,227,255,0.25)]' 
                        : 'aero-strip'
                    }`}
                  >
                    {/* Track Title */}
                    <div className="w-full text-center pb-1 border-b border-white/10">
                      <span className={`text-[11px] font-mono font-bold truncate block ${
                        isMaster ? 'text-aero-glow' : 'text-white'
                      }`}>
                        {track.name}
                      </span>
                      <span className="text-[9px] text-zinc-500 font-mono">
                        {isMaster ? 'MASTER' : `IN ${track.id}`}
                      </span>
                    </div>

                    {/* Quick FX Knobs per Track */}
                    <div className="w-full space-y-1 bg-black/30 p-1.5 rounded-lg border border-white/10">
                      {/* Lowpass EQ Filter */}
                      <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400">
                        <span>FILTER</span>
                        <span>{Math.round(track.filter / 1000)}k</span>
                      </div>
                      <input
                        type="range"
                        min="500"
                        max="20000"
                        step="500"
                        aria-label={`${track.name} filter`}
                        value={track.filter}
                        onChange={(e) => handleMixerParam(track.id, 'filter', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-cyan-400"
                      />

                      {/* Echo / Delay Send */}
                      <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 pt-0.5">
                        <span>DELAY</span>
                        <span>{Math.round(track.delay * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="0.8"
                        step="0.05"
                        aria-label={`${track.name} delay`}
                        value={track.delay}
                        onChange={(e) => handleMixerParam(track.id, 'delay', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-purple-400"
                      />

                      {/* Overdrive Distortion */}
                      <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 pt-0.5">
                        <span>DIST</span>
                        <span>{Math.round(track.dist * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="0.8"
                        step="0.05"
                        aria-label={`${track.name} distortion`}
                        value={track.dist}
                        onChange={(e) => handleMixerParam(track.id, 'dist', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-rose-500"
                      />
                    </div>

                    {/* Pan Slider */}
                    <div className="w-full flex items-center justify-between gap-1">
                      <span className="text-[8px] font-mono text-zinc-500">L</span>
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.05"
                        aria-label={`${track.name} pan`}
                        value={track.pan}
                        onChange={(e) => handleMixerParam(track.id, 'pan', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-sky-400"
                        title={`Pan: ${track.pan}`}
                      />
                      <span className="text-[8px] font-mono text-zinc-500">R</span>
                    </div>

                    {/* Vertical Volume Fader */}
                    <div className="flex items-center justify-center h-36 relative py-1">
                      <input
                        type="range"
                        min="0"
                        max="1.2"
                        step="0.02"
                        aria-label={`${track.name} volume`}
                        value={track.vol}
                        onChange={(e) => handleMixerParam(track.id, 'vol', parseFloat(e.target.value))}
                        className="h-32 -rotate-90 appearance-none bg-zinc-800 rounded-lg cursor-pointer accent-emerald-400 w-32"
                        title={`Level: ${Math.round((track.vol / 1.2) * 100)}%`}
                      />
                    </div>

                    {/* Mute and Solo Controls */}
                    <div className="flex items-center gap-1 w-full justify-center">
                      <button
                        onClick={() => handleMixerParam(track.id, 'mute', !track.mute)}
                        aria-label={`Mute mixer ${track.name}`}
                        aria-pressed={track.mute}
                        className={`px-2.5 py-0.5 text-[10px] ${track.mute ? 'aero-pill aero-ruby' : 'aero-pill aero-smoke'}`}
                      >
                        M
                      </button>
                      <button
                        aria-label={`Solo mixer ${track.name}`}
                        aria-pressed={track.solo}
                        onClick={() => {
                          const newSolo = !track.solo;
                          handleMixerParam(track.id, 'solo', newSolo);
                        }}
                        className={`px-2.5 py-0.5 text-[10px] ${track.solo ? 'aero-pill aero-amber' : 'aero-pill aero-smoke'}`}
                      >
                        S
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* ==================================================== */}
      {/* 4. BOTTOM STATUS BAR & SYSTEM DIAGNOSTICS            */}
      {/* ==================================================== */}
      <footer className="aero-glass-dark shrink-0 px-4 py-1.5 text-[11px] text-sky-100/70 flex flex-wrap gap-2 items-center justify-between border-x-0 border-b-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            AUDIO: {playback.status === 'starting' ? 'ENABLING' : playback.status.toUpperCase()}
          </span>
          <span className="text-zinc-600">|</span>
          <span>{playback.initialized ? 'Audio enabled' : 'Click Play to enable audio'}</span>
          <span className="text-zinc-600">|</span>
          <span>{loop ? 'Looping' : 'Play once'}</span>
        </div>
        <div className="text-sky-100/50">
          RemixRelay • Collaborative music studio
        </div>
      </footer>
    </div>
  );
}
