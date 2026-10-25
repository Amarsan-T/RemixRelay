import { useState, useEffect, useRef } from 'react';
import {
  Play, Square, Volume2, RotateCcw, Sliders, Music, Grid, Sparkles,
  Trash2, Zap, Radio, Layers, ListMusic, Home, Cloud, CloudOff, Link, Check,
} from 'lucide-react';
import { MAX_BPM, MIN_BPM } from './src/audio';
import { PRESETS } from './src/studio/data';
import { useStudioProject } from './src/studio/useStudioProject';
import { useStudioAudio, type PlayMode } from './src/studio/useStudioAudio';
import { MAX_PATTERNS, patternLength, patternNumbers, patternStepAt } from './src/studio/patternAdapter';
import { PatternLengthControl } from './src/studio/PatternLengthControl';
import { StudioPianoRoll } from './src/studio/StudioPianoRoll';
import { StudioPlaylist } from './src/studio/StudioPlaylist';
import type { MixerParam, StepData, StudioChannel, StudioProject } from './src/studio/types';
import type { ProjectChange } from './src/studio/projectSync';

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
};

export default function App({ initialProject, projectName, onProjectChange, onHome, connectRemote, saveState, shareUrl }: StudioProps) {
  const {
    project, applyChanges, setBpm, setLoop, setMetronome, setChannels,
    setStepData, setPianoNotes, setMixerTracks, setSong, setPatternSteps, setPatternCount,
  } = useStudioProject(initialProject);

  // Edits made in another browser merge into the latest state. Playback picks them up like local edits.
  useEffect(() => connectRemote?.(applyChanges), [connectRemote, applyChanges]);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
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
  const [activeTab, setActiveTab] = useState('playlist');
  const [selectedChannelId, setSelectedChannelId] = useState('synth_lead');
  const [activePattern, setActivePattern] = useState(1);
  // PAT loops the selected pattern; SONG plays the playlist.
  const [playMode, setPlayMode] = useState<PlayMode>('pattern');
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
    const next = patterns.length + 1;
    setPatternCount(next);
    setActivePattern(next);
  };
  // Where the pattern on screen is up to, or null when you aren't hearing it.
  const patternPlayStep = !isPlaying ? null
    : playMode === 'pattern' ? currentStep : patternStepAt(project, activePattern, currentStep);
  const masterVol = mixerTracks.find((track) => track.id === 0)?.vol ?? 0.85;
  const tapTimesRef = useRef<number[]>([]);
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

  // Tap Tempo Function
  const handleTapTempo = () => {
    const now = performance.now();
    const times = tapTimesRef.current;
    times.push(now);

    if (times.length > 4) times.shift();

    if (times.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < times.length; i++) {
        intervals.push(times[i] - times[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
      const calculatedBpm = Math.round(60000 / avgInterval);
      if (calculatedBpm >= 40 && calculatedBpm <= 240) {
        setBpm(calculatedBpm);
      }
    }
  };

  // Toggle Step Sequencer cell
  const toggleStep = (channelId: string, stepIndex: number) => {
    const hasNotes = pianoNotes[activePattern]?.[channelId]?.some(note => note.step === stepIndex) ?? false;
    const wasActive = stepData[activePattern]?.[channelId]?.[stepIndex] === 1 || hasNotes;
    setStepData(prev => {
      const p = prev[activePattern] || {};
      const chSteps = [...(p[channelId] || new Array(patternSteps).fill(0))];
      chSteps[stepIndex] = wasActive ? 0 : 1;
      return {
        ...prev,
        [activePattern]: {
          ...p,
          [channelId]: chSteps
        }
      };
    });
    if (hasNotes) {
      setPianoNotes(prev => ({ ...prev, [activePattern]: {
        ...prev[activePattern], [channelId]: (prev[activePattern]?.[channelId] ?? []).filter(note => note.step !== stepIndex),
      } }));
    }

    // Preview sound when toggling ON
    const ch = channels.find(c => c.id === channelId);
    if (ch && !wasActive && !isPlaying) {
      previewChannelSound(ch);
    }
  };

  const previewChannelSound = (channel: StudioChannel) => preview(channel.id);

  // Load Preset
  const loadPreset = (presetName: string) => {
    const p = PRESETS[presetName];
    if (!p) return;
    setBpm(p.bpm);
    setStepData(prev => ({
      ...prev,
      [activePattern]: structuredClone(p.steps)
    }));
    if (p.notes) {
      setPianoNotes(prev => ({
        ...prev,
        [activePattern]: structuredClone(p.notes)
      }));
    }
  };

  // Clear current pattern
  const clearCurrentPattern = () => {
    setStepData(prev => {
      const empty: StepData[number] = {};
      channels.forEach(ch => {
        empty[ch.id] = new Array(patternSteps).fill(0);
      });
      return { ...prev, [activePattern]: empty };
    });
    setPianoNotes(prev => ({ ...prev, [activePattern]: {} }));
  };

  // Randomize pattern
  const randomizePattern = () => {
    setStepData(prev => {
      const randomized: StepData[number] = {};
      channels.forEach(ch => {
        randomized[ch.id] = new Array(patternSteps).fill(0).map(() => (Math.random() > 0.72 ? 1 : 0));
      });
      return { ...prev, [activePattern]: randomized };
    });
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
    <div className="flex flex-col h-screen w-full bg-[#181a1d] text-zinc-200 select-none font-sans overflow-hidden">
      {/* ==================================================== */}
      {/* 1. TOP TRANSPORT BAR (FL Studio Classic Toolbar)     */}
      {/* ==================================================== */}
      <header className="flex flex-wrap items-center justify-between px-3 py-2 bg-[#212529] border-b border-zinc-800 shadow-md gap-2 z-20">
        
        {/* Left: Brand & Mode Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-2 border-r border-zinc-700/60">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-600 via-orange-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Sparkles className="w-4 h-4 text-zinc-950 font-bold" />
            </div>
            <div className="leading-tight">
              <span className="text-sm font-black tracking-wider text-orange-400 block font-mono">REMIXRELAY</span>
              <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold block max-w-40 truncate">{projectName ?? 'Music Studio'}</span>
            </div>
          </div>

          {onHome && (
            <button
              type="button"
              aria-label="Home"
              title="Back to your projects"
              onClick={() => { handleStop(); onHome(); }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-bold rounded border border-zinc-700/80 bg-zinc-900/90 text-zinc-300 hover:text-orange-400"
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
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-bold rounded border border-zinc-700/80 bg-zinc-900/90 text-zinc-300 hover:text-orange-400"
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
                saveState === 'error' ? 'text-red-400' : saveState === 'saving' ? 'text-amber-300' : 'text-zinc-500'
              }`}
            >
              {saveState === 'error' ? <CloudOff className="w-3.5 h-3.5" /> : <Cloud className="w-3.5 h-3.5" />}
              {saveState === 'error' ? 'Offline' : saveState === 'saving' ? 'Saving' : 'Saved'}
            </span>
          )}

          {/* Mode Switcher: PAT vs SONG */}
          <div className="flex items-center bg-zinc-900/90 p-0.5 rounded border border-zinc-700/80">
            <button
              aria-label="Pattern playback mode"
              aria-pressed={playMode === 'pattern'}
              onClick={() => setPlayMode('pattern')}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded ${playMode === 'pattern' ? 'bg-orange-500 text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              PAT
            </button>
            <button
              aria-label="Song playback mode"
              aria-pressed={playMode === 'song'}
              title="Play the whole playlist"
              onClick={() => setPlayMode('song')}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded ${playMode === 'song' ? 'bg-orange-500 text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              SONG
            </button>
          </div>

          {/* Pattern Selector */}
          <div className="flex items-center gap-1 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/80 max-w-72 overflow-x-auto">
            <Layers className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="text-xs text-zinc-400 font-mono">PAT:</span>
            {patterns.map(num => (
              <button
                key={num}
                onClick={() => setActivePattern(num)}
                className={`min-w-5 h-5 px-0.5 shrink-0 text-xs font-mono font-bold rounded flex items-center justify-center transition-all ${
                  activePattern === num
                    ? 'bg-orange-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:bg-zinc-800'
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
              className="w-5 h-5 shrink-0 text-xs font-mono font-bold rounded flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-orange-400 border border-dashed border-zinc-700"
            >
              +
            </button>
          </div>
        </div>

        {/* Center: Playback Controls & LED Displays */}
        <div className="flex items-center gap-3">
          {/* Main Transport Buttons */}
          <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-md border border-zinc-700/80 shadow-inner">
            <button
              onClick={handlePlay}
              aria-label="Play"
              aria-pressed={isPlaying}
              disabled={playback.status === 'starting'}
              title="Play (Space)"
              className={`p-2 rounded transition-all ${
                isPlaying 
                  ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_12px_rgba(16,185,129,0.7)]' 
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={() => setLoop(value => !value)}
              aria-label="Loop"
              aria-pressed={loop}
              title={loop ? 'Loop enabled' : 'Play one bar'}
              className={`p-2 rounded transition-all ${
                loop
                  ? 'bg-amber-500 text-zinc-950 shadow-[0_0_12px_rgba(245,158,11,0.6)]'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleStop}
              aria-label="Stop"
              title="Stop"
              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-all active:scale-95"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* FL Studio Signature Digital LCD Counter */}
          <div className="flex items-center gap-3 bg-black/90 px-3 py-1.5 rounded border border-zinc-800 shadow-inner">
            <div className="text-right">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono block leading-none">Pos</span>
              <span className="text-emerald-400 font-mono text-sm tracking-widest font-black drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]">
                0{bars}:0{beats}:0{ticks}
              </span>
            </div>
            <div className="h-6 w-px bg-zinc-800" />
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono block leading-none">Step</span>
              <span className="text-orange-400 font-mono text-sm font-black drop-shadow-[0_0_6px_rgba(251,146,60,0.5)]">
                {String(stepInBar + 1).padStart(2, '0')} / 16
              </span>
            </div>
          </div>

          {/* BPM Control & Tap Tempo */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/80">
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-mono text-zinc-400 leading-none">TEMPO</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setBpm(b => Math.max(MIN_BPM, b - 1))}
                  className="w-4 h-4 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center justify-center text-zinc-300"
                >
                  -
                </button>
                <input
                  type="number"
                  aria-label="Tempo BPM"
                  min={MIN_BPM}
                  max={MAX_BPM}
                  step="1"
                  value={bpm}
                  onChange={(e) => setBpm(Math.min(MAX_BPM, Math.max(MIN_BPM, Number(e.target.value) || 120)))}
                  className="w-12 bg-black text-center text-orange-400 font-mono font-bold text-xs py-0.5 rounded border border-zinc-700 outline-none"
                />
                <button
                  onClick={() => setBpm(b => Math.min(MAX_BPM, b + 1))}
                  className="w-4 h-4 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center justify-center text-zinc-300"
                >
                  +
                </button>
              </div>
            </div>
            <button
              onClick={handleTapTempo}
              title="Tap Tempo"
              className="px-2 py-1 text-[10px] font-mono font-bold bg-zinc-800 hover:bg-orange-500 hover:text-black text-orange-400 rounded border border-zinc-700 active:scale-95 transition-all"
            >
              TAP
            </button>
          </div>

          {/* Metronome Button */}
          <button
            onClick={() => setMetronome(!metronome)}
            title="Metronome"
            aria-label="Metronome"
            aria-pressed={metronome}
            className={`p-2 rounded border transition-all ${
              metronome
                ? 'bg-orange-500 text-zinc-950 border-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.5)]'
                : 'bg-zinc-800/80 text-zinc-400 border-zinc-700 hover:text-zinc-200'
            }`}
          >
            <Radio className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Master Volume & Stereo Visualizer Canvas */}
        <div className="flex items-center gap-3">
          {/* Master Volume */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/80">
            <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
            <input
              type="range"
              min="0"
              max="1.2"
              step="0.01"
              aria-label="Master volume"
              value={masterVol}
              onChange={(e) => setMasterVol(parseFloat(e.target.value))}
              className="w-16 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
              title={`Master Vol: ${Math.round(masterVol * 100)}%`}
            />
            <span className="text-[10px] font-mono text-zinc-400 w-7 text-right">
              {Math.round(masterVol * 100)}%
            </span>
          </div>

          {/* Stereo Master Peak LEDs Canvas */}
          <div className="bg-zinc-950 p-1 rounded border border-zinc-800 shadow-inner flex flex-col items-center">
            <canvas
              ref={masterMeterCanvasRef}
              width={28}
              height={32}
              className="rounded"
              title="Master Stereo Peak Meter"
            />
            <span className="text-[8px] font-mono text-zinc-500 tracking-tighter">OUT</span>
          </div>
        </div>
      </header>

      {audioError && <div role="alert" className="bg-red-950 text-red-200 border-b border-red-700 px-4 py-2 text-sm">{audioError}</div>}

      {/* ==================================================== */}
      {/* 2. SUB-BAR: Presets, Quick Tools, and Tab Switchers  */}
      {/* ==================================================== */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#1b1e22] border-b border-zinc-800 text-xs">
        {/* Preset Selector */}
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 font-mono text-[11px] flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" /> Presets:
          </span>
          <div className="flex gap-1">
            {Object.keys(PRESETS).map((pName) => (
              <button
                key={pName}
                onClick={() => loadPreset(pName)}
                className="px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 font-medium text-[11px] border border-zinc-700/60 transition"
              >
                {pName}
              </button>
            ))}
          </div>
        </div>

        {/* Pattern Quick Operations */}
        <div className="flex items-center gap-2">
          <button
            onClick={randomizePattern}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-orange-400 border border-zinc-700/60 text-[11px] transition"
          >
            <Sparkles className="w-3 h-3" /> Randomize
          </button>
          <button
            onClick={clearCurrentPattern}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 border border-zinc-700/60 text-[11px] transition"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>

          {/* Layout Tab Switchers */}
          <div className="flex bg-zinc-950 p-0.5 rounded-md border border-zinc-700/60 ml-2">
            <button
              onClick={() => setActiveTab('playlist')}
              className={`flex items-center gap-1 px-3 py-1 rounded text-[11px] font-semibold transition ${
                activeTab === 'playlist'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ListMusic className="w-3.5 h-3.5" /> Playlist
            </button>
            <button
              onClick={() => setActiveTab('channelRack')}
              className={`flex items-center gap-1 px-3 py-1 rounded text-[11px] font-semibold transition ${
                activeTab === 'channelRack'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5" /> Channel Rack
            </button>
            <button
              onClick={() => setActiveTab('pianoRoll')}
              className={`flex items-center gap-1 px-3 py-1 rounded text-[11px] font-semibold transition ${
                activeTab === 'pianoRoll'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Music className="w-3.5 h-3.5" /> Piano Roll
            </button>
            <button
              onClick={() => setActiveTab('mixer')}
              className={`flex items-center gap-1 px-3 py-1 rounded text-[11px] font-semibold transition ${
                activeTab === 'mixer'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" /> Mixer
            </button>
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. MAIN WORKSPACE AREA                              */}
      {/* ==================================================== */}
      <main className="flex-1 bg-[#16181b] overflow-auto relative p-3 flex flex-col justify-start">
        
        {/* VIEW 1: CHANNEL RACK & STEP SEQUENCER */}
        {activeTab === 'channelRack' && (
          <div className="max-w-6xl w-full mx-auto bg-[#202428] rounded-lg border border-zinc-700/70 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-850 border-b border-zinc-700/70">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
                  Channel Rack • Pattern {activePattern}
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                <PatternLengthControl
                  project={project}
                  pattern={activePattern}
                  setPatternSteps={setPatternSteps}
                  setStepData={setStepData}
                  setPianoNotes={setPianoNotes}
                />
                <span className="text-zinc-600">|</span>
                <span>Swing: 0%</span>
              </div>
            </div>

            {/* Channels & Step Grid */}
            <div className="divide-y divide-zinc-800/80">
              {channels.map((channel) => {
                const currentPatternSteps = stepData[activePattern]?.[channel.id] || new Array(patternSteps).fill(0);
                const isSelected = selectedChannelId === channel.id;

                return (
                  <div
                    key={channel.id}
                    onClick={() => setSelectedChannelId(channel.id)}
                    className={`flex items-center px-3 py-1.5 transition-colors ${
                      isSelected ? 'bg-zinc-700/25' : 'hover:bg-zinc-800/40'
                    }`}
                  >
                    {/* Left: Channel Controls (Pan, Vol, Mute, Solo) */}
                    <div className="flex items-center gap-2 w-72 shrink-0">
                      {/* Selection LED */}
                      <div className={`w-1.5 h-6 rounded-full transition-all ${
                        isSelected ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-transparent'
                      }`} />

                      {/* Mute & Solo buttons */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleMute(channel.id); }}
                        className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center border transition ${
                          channel.muted
                            ? 'bg-red-500/80 text-white border-red-400'
                            : 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/60'
                        }`}
                        title="Mute Channel"
                        aria-label={`Mute ${channel.name}`}
                        aria-pressed={channel.muted}
                      >
                        M
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSolo(channel.id); }}
                        className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center border transition ${
                          channel.solo
                            ? 'bg-amber-400 text-zinc-950 border-amber-300 font-black shadow-[0_0_6px_#f59e0b]'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                        }`}
                        title="Solo Channel"
                        aria-label={`Solo ${channel.name}`}
                        aria-pressed={channel.solo}
                      >
                        S
                      </button>

                      {/* Pan Knob Slider */}
                      <div className="flex flex-col items-center" title={`Pan: ${channel.pan}`}>
                        <span className="text-[8px] text-zinc-500 font-mono leading-none">PAN</span>
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
                          className="w-10 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-400"
                        />
                      </div>

                      {/* Volume Slider */}
                      <div className="flex flex-col items-center" title={`Vol: ${Math.round(channel.vol * 100)}%`}>
                        <span className="text-[8px] text-zinc-500 font-mono leading-none">VOL</span>
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
                        className="flex-1 text-left px-2.5 py-1 rounded bg-[#2b3035] hover:bg-[#343a40] border border-zinc-700/80 shadow-sm flex items-center justify-between group"
                      >
                        <span className="text-xs font-semibold text-zinc-200 group-hover:text-orange-400 transition truncate">
                          {channel.name}
                        </span>
                        <span
                          className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold"
                          style={{ backgroundColor: `${channel.color}33`, color: channel.color }}
                        >
                          Trk {channel.mixerTrack}
                        </span>
                      </button>
                    </div>

                    {/* Right: Step Sequencer Pads (FL 4-beat color grouping) */}
                    <div className="flex items-center gap-1 pl-4 flex-1 overflow-x-auto">
                      {Array.from({ length: patternSteps }).map((_, stepIdx) => {
                        const isStepActive = currentPatternSteps[stepIdx] === 1 || (channel.type !== 'drum' &&
                          (pianoNotes[activePattern]?.[channel.id]?.some(note => note.step === stepIdx) ?? false));
                        const isCurrentPlayStep = patternPlayStep === stepIdx;
                        // FL Studio 4-beat grouping (alternating colors every 4 steps)
                        const groupIdx = Math.floor(stepIdx / 4);
                        const isEvenGroup = groupIdx % 2 === 0;

                        return (
                          <button
                            key={stepIdx}
                            onClick={() => toggleStep(channel.id, stepIdx)}
                            aria-label={`${channel.name} step ${stepIdx + 1}`}
                            aria-pressed={isStepActive}
                            className={`h-9 flex-1 min-w-[28px] max-w-[44px] rounded-[3px] border transition-all duration-75 relative flex items-center justify-center ${
                              isStepActive
                                ? 'bg-gradient-to-b from-orange-500 to-amber-600 border-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.4)]'
                                : isEvenGroup
                                ? 'bg-[#32373d] hover:bg-[#3b4148] border-zinc-700/80'
                                : 'bg-[#25292e] hover:bg-[#2d3238] border-zinc-800'
                            } ${isCurrentPlayStep ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#202428] scale-[1.05]' : ''}`}
                          >
                            {/* Inner LED highlight notch */}
                            <div className={`w-3/4 h-1.5 rounded-full ${
                              isStepActive 
                                ? 'bg-amber-200/90 shadow-[0_0_4px_#fff]' 
                                : 'bg-black/25'
                            }`} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
            onOpenPattern={(pattern) => { setActivePattern(pattern); setActiveTab('channelRack'); }}
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
          />
        )}

        {/* VIEW 3: MULTI-CHANNEL MIXER & EFFECTS */}
        {activeTab === 'mixer' && (
          <div className="max-w-6xl w-full mx-auto bg-[#202428] rounded-lg border border-zinc-700/70 shadow-2xl p-4 flex flex-col gap-4">
            {/* Mixer Header */}
            <div className="flex items-center justify-between pb-2 border-b border-zinc-700/80">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
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
                        ? 'bg-[#181a1d] border-amber-500/50 shadow-md' 
                        : 'bg-[#23272c] border-zinc-700/80'
                    }`}
                  >
                    {/* Track Title */}
                    <div className="w-full text-center pb-1 border-b border-zinc-700/60">
                      <span className={`text-[11px] font-mono font-bold truncate block ${
                        isMaster ? 'text-amber-400' : 'text-zinc-200'
                      }`}>
                        {track.name}
                      </span>
                      <span className="text-[9px] text-zinc-500 font-mono">
                        {isMaster ? 'MASTER' : `IN ${track.id}`}
                      </span>
                    </div>

                    {/* Quick FX Knobs per Track */}
                    <div className="w-full space-y-1 bg-zinc-900/60 p-1.5 rounded border border-zinc-800">
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
                        value={track.pan}
                        onChange={(e) => handleMixerParam(track.id, 'pan', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-orange-400"
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
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                          track.mute
                            ? 'bg-red-500 text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        M
                      </button>
                      <button
                        onClick={() => {
                          const newSolo = !track.solo;
                          handleMixerParam(track.id, 'solo', newSolo);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                          track.solo
                            ? 'bg-amber-400 text-black shadow'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
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
      <footer className="px-4 py-1.5 bg-[#1b1e22] border-t border-zinc-800 text-[11px] font-mono text-zinc-400 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            AUDIO: {playback.status === 'starting' ? 'ENABLING' : playback.status.toUpperCase()}
          </span>
          <span className="text-zinc-600">|</span>
          <span>{playback.initialized ? 'Audio enabled' : 'Click Play to enable audio'}</span>
          <span className="text-zinc-600">|</span>
          <span>{loop ? 'Looping' : 'One bar'}</span>
        </div>
        <div className="text-zinc-500">
          RemixRelay • Collaborative music studio
        </div>
      </footer>
    </div>
  );
}
