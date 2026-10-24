import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Play, Pause, Square, Volume2, VolumeX, RotateCcw, 
  Sliders, Music, Grid, Activity, Settings2, Sparkles, 
  Trash2, Plus, ChevronRight, Zap, Radio, Layers
} from 'lucide-react';

// ==========================================
// AUDIO SYNTHESIS & ENGINE ENGINE (Web Audio API)
// ==========================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.trackNodes = []; // Insert channels
    this.noiseBuffer = null;
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();

    // Master bus
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    this.masterAnalyser.smoothingTimeConstant = 0.8;

    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    // Build 6 Insert Mixer Tracks (Track 0 is Master, 1-6 are Inserts)
    this.trackNodes = [];
    for (let i = 0; i <= 6; i++) {
      const inputGain = this.ctx.createGain();
      const panNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      const faderGain = this.ctx.createGain();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;

      // Effect nodes
      const filterNode = this.ctx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 20000;

      const delayNode = this.ctx.createDelay();
      delayNode.delayTime.value = 0.25;
      const delayFeedback = this.ctx.createGain();
      delayFeedback.gain.value = 0.0; // dry initially
      const delayWet = this.ctx.createGain();
      delayWet.gain.value = 0.0;

      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);
      delayNode.connect(delayWet);

      // Distortion wave shaper
      const distortionNode = this.ctx.createWaveShaper();
      distortionNode.curve = this.makeDistortionCurve(0);
      distortionNode.oversample = '4x';

      // Chain: input -> distortion -> filter -> (split to delay) -> fader -> pan -> analyser
      inputGain.connect(distortionNode);
      distortionNode.connect(filterNode);
      
      filterNode.connect(faderGain);
      filterNode.connect(delayNode);
      delayWet.connect(faderGain);

      if (panNode) {
        faderGain.connect(panNode);
        panNode.connect(analyser);
      } else {
        faderGain.connect(analyser);
      }

      if (i > 0) {
        // Inserts route to Master Gain
        analyser.connect(this.masterGain);
      }

      this.trackNodes.push({
        input: inputGain,
        filter: filterNode,
        delay: delayNode,
        delayFeedback,
        delayWet,
        distortion: distortionNode,
        fader: faderGain,
        pan: panNode,
        analyser,
        isMuted: false,
        isSolo: false,
        vol: 0.8,
        panVal: 0
      });
    }

    // Build 1-second white noise buffer for snares/hats
    const bufferSize = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.isInitialized = true;
  }

  ensureContext() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  makeDistortionCurve(amount = 0) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      if (k === 0) {
        curve[i] = x;
      } else {
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
    }
    return curve;
  }

  setTrackParam(trackIdx, param, val) {
    if (!this.trackNodes[trackIdx]) return;
    const t = this.trackNodes[trackIdx];
    const now = this.ctx.currentTime;
    switch (param) {
      case 'vol':
        t.vol = val;
        t.fader.gain.setTargetAtTime(t.isMuted ? 0 : val, now, 0.02);
        break;
      case 'pan':
        t.panVal = val;
        if (t.pan) t.pan.pan.setTargetAtTime(val, now, 0.02);
        break;
      case 'mute':
        t.isMuted = val;
        t.fader.gain.setTargetAtTime(val ? 0 : t.vol, now, 0.02);
        break;
      case 'filterFreq':
        t.filter.frequency.setTargetAtTime(val, now, 0.02);
        break;
      case 'delaySend':
        t.delayFeedback.gain.setTargetAtTime(val * 0.7, now, 0.02);
        t.delayWet.gain.setTargetAtTime(val, now, 0.02);
        break;
      case 'distortion':
        t.distortion.curve = this.makeDistortionCurve(val * 100);
        break;
      default:
        break;
    }
  }

  setMasterVolume(val) {
    if (!this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
  }

  // --- Sound Synthesizers ---
  triggerKick(time, trackIndex = 1, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);

    gain.gain.setValueAtTime(1.1 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.38);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    osc.stop(time + 0.4);
  }

  triggerSnare(time, trackIndex = 2, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    // Body
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, time);
    osc.frequency.exponentialRampToValueAtTime(70, time + 0.08);

    oscGain.gain.setValueAtTime(0.7 * velocity, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
    osc.connect(oscGain);
    oscGain.connect(dest);

    // Snap noise
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.85 * velocity, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(dest);

    osc.start(time);
    osc.stop(time + 0.2);
    noise.start(time);
    noise.stop(time + 0.24);
  }

  triggerHiHatClosed(time, trackIndex = 3, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.55 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    noise.start(time);
    noise.stop(time + 0.07);
  }

  triggerHiHatOpen(time, trackIndex = 3, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5500;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    noise.start(time);
    noise.stop(time + 0.4);
  }

  triggerClap(time, trackIndex = 2, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    const count = 3;
    for (let i = 0; i < count; i++) {
      const burstTime = time + i * 0.012;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 3;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.6 * velocity, burstTime);
      gain.gain.exponentialRampToValueAtTime(0.001, burstTime + (i === count - 1 ? 0.22 : 0.02));

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);

      noise.start(burstTime);
      noise.stop(burstTime + 0.25);
    }
  }

  trigger808(time, trackIndex = 4, freq = 55, velocity = 1.0, duration = 0.5) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Subtle initial punch
    osc.frequency.setValueAtTime(freq * 1.5, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);

    gain.gain.setValueAtTime(0.9 * velocity, time);
    gain.gain.setValueAtTime(0.75 * velocity, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  triggerSynthLead(time, trackIndex = 5, freq = 440, velocity = 1.0, duration = 0.3) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.004, time); // Detuned for rich supersaw

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.5, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.2, time + duration);

    gain.gain.setValueAtTime(0.35 * velocity, time);
    gain.gain.setTargetAtTime(0.28 * velocity, time + 0.05, 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + 0.05);
    osc2.stop(time + duration + 0.05);
  }

  triggerMetronome(time, high = false) {
    this.ensureContext();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = high ? 1600 : 800;

    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.05);
  }
}

// Global Singleton Audio Engine
const audio = new AudioEngine();

// ==========================================
// MUSICAL CONSTANTS & UTILITIES
// ==========================================

const NOTES = [
  { name: 'B4', freq: 493.88 },
  { name: 'A#4', freq: 466.16 },
  { name: 'A4', freq: 440.0 },
  { name: 'G#4', freq: 415.3 },
  { name: 'G4', freq: 392.0 },
  { name: 'F#4', freq: 369.99 },
  { name: 'F4', freq: 349.23 },
  { name: 'E4', freq: 329.63 },
  { name: 'D#4', freq: 311.13 },
  { name: 'D4', freq: 293.66 },
  { name: 'C#4', freq: 277.18 },
  { name: 'C4', freq: 261.63 },
  { name: 'B3', freq: 246.94 },
  { name: 'A#3', freq: 233.08 },
  { name: 'A3', freq: 220.0 },
  { name: 'G#3', freq: 207.65 },
  { name: 'G3', freq: 196.0 },
  { name: 'F#3', freq: 185.0 },
  { name: 'F3', freq: 174.61 },
  { name: 'E3', freq: 164.81 },
  { name: 'D#3', freq: 155.56 },
  { name: 'D3', freq: 146.83 },
  { name: 'C#3', freq: 138.59 },
  { name: 'C3', freq: 130.81 },
];

const INITIAL_CHANNELS = [
  { id: 'kick', name: 'Kick 808', color: '#ff5722', mixerTrack: 1, vol: 0.85, pan: 0, muted: false, solo: false, type: 'drum' },
  { id: 'snare', name: 'Snare Gritty', color: '#ff9800', mixerTrack: 2, vol: 0.8, pan: 0, muted: false, solo: false, type: 'drum' },
  { id: 'clap', name: 'Clap Crisp', color: '#ffc107', mixerTrack: 2, vol: 0.75, pan: 0.1, muted: false, solo: false, type: 'drum' },
  { id: 'hat_closed', name: 'Hi-Hat Closed', color: '#4caf50', mixerTrack: 3, vol: 0.7, pan: -0.15, muted: false, solo: false, type: 'drum' },
  { id: 'hat_open', name: 'Hi-Hat Open', color: '#8bc34a', mixerTrack: 3, vol: 0.65, pan: 0.2, muted: false, solo: false, type: 'drum' },
  { id: 'bass808', name: 'Sub 808', color: '#00bcd4', mixerTrack: 4, vol: 0.9, pan: 0, muted: false, solo: false, type: 'pitched', defaultNote: 'C3' },
  { id: 'synth_lead', name: 'Retro Lead', color: '#e91e63', mixerTrack: 5, vol: 0.75, pan: 0, muted: false, solo: false, type: 'synth' },
];

const PRESETS = {
  'Trap Heat': {
    bpm: 140,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat_closed: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      hat_open: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
      bass808: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      synth_lead: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'A4', length: 2 },
        { step: 3, note: 'C4', length: 2 },
        { step: 6, note: 'E4', length: 2 },
        { step: 10, note: 'G4', length: 2 },
        { step: 13, note: 'F4', length: 2 },
      ]
    }
  },
  'House 4-on-Floor': {
    bpm: 124,
    steps: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat_closed: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      hat_open: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      bass808: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      synth_lead: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'C4', length: 2 },
        { step: 4, note: 'D#4', length: 2 },
        { step: 8, note: 'G4', length: 2 },
        { step: 12, note: 'A#4', length: 2 },
      ]
    }
  },
  'Synthwave 80s': {
    bpm: 110,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      hat_closed: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      hat_open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      bass808: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      synth_lead: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'D4', length: 2 },
        { step: 3, note: 'F4', length: 2 },
        { step: 6, note: 'A4', length: 2 },
        { step: 8, note: 'D5', length: 2 },
        { step: 11, note: 'C5', length: 2 },
        { step: 14, note: 'A4', length: 2 },
      ]
    }
  },
  'Lo-Fi Chill': {
    bpm: 85,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      clap: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat_closed: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
      hat_open: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      bass808: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      synth_lead: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    },
    notes: {
      synth_lead: [
        { step: 0, note: 'E4', length: 3 },
        { step: 5, note: 'G4', length: 2 },
        { step: 8, note: 'B4', length: 3 },
        { step: 14, note: 'D4', length: 2 },
      ]
    }
  }
};

// ==========================================
// MAIN REACT DAW COMPONENT
// ==========================================

export default function App() {
  // Transport State
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(128);
  const [currentStep, setCurrentStep] = useState(0);
  const [playMode, setPlayMode] = useState('PAT'); // 'PAT' or 'SONG'
  const [metronome, setMetronome] = useState(false);
  const [masterVol, setMasterVol] = useState(0.85);

  // Layout / Panels
  const [activeTab, setActiveTab] = useState('channelRack'); // 'channelRack' | 'pianoRoll' | 'mixer'
  const [selectedChannelId, setSelectedChannelId] = useState('synth_lead');
  const [activePattern, setActivePattern] = useState(1);

  // Channels & Step Sequencer Patterns State (4 Patterns)
  const [channels, setChannels] = useState(INITIAL_CHANNELS);
  const [stepData, setStepData] = useState(() => {
    const initial = {};
    for (let p = 1; p <= 4; p++) {
      initial[p] = {};
      INITIAL_CHANNELS.forEach(ch => {
        initial[p][ch.id] = new Array(16).fill(0);
      });
    }
    // Load default Trap pattern for Pattern 1
    initial[1] = JSON.parse(JSON.stringify(PRESETS['Trap Heat'].steps));
    return initial;
  });

  // Piano Roll Note data per pattern: { [pattern]: { [channelId]: [{ step, note, length }] } }
  const [pianoNotes, setPianoNotes] = useState(() => {
    return {
      1: JSON.parse(JSON.stringify(PRESETS['Trap Heat'].notes)),
      2: {},
      3: {},
      4: {}
    };
  });

  // Mixer FX State for 6 Insert Tracks + Master
  const [mixerTracks, setMixerTracks] = useState(() => [
    { id: 0, name: 'Master', vol: 0.85, pan: 0, filter: 20000, delay: 0, dist: 0, mute: false, solo: false },
    { id: 1, name: 'Kick / Low', vol: 0.9, pan: 0, filter: 20000, delay: 0, dist: 0.1, mute: false, solo: false },
    { id: 2, name: 'Snare/Clap', vol: 0.8, pan: 0, filter: 20000, delay: 0.1, dist: 0, mute: false, solo: false },
    { id: 3, name: 'Hats/Cymb', vol: 0.7, pan: 0, filter: 20000, delay: 0.15, dist: 0, mute: false, solo: false },
    { id: 4, name: '808 Bass', vol: 0.95, pan: 0, filter: 8000, delay: 0, dist: 0.25, mute: false, solo: false },
    { id: 5, name: 'Lead Synth', vol: 0.8, pan: 0, filter: 14000, delay: 0.35, dist: 0.05, mute: false, solo: false },
    { id: 6, name: 'Insert 6', vol: 0.8, pan: 0, filter: 20000, delay: 0, dist: 0, mute: false, solo: false },
  ]);

  // Tap Tempo State
  const tapTimesRef = useRef([]);

  // Timing & Scheduler Refs for rock-solid Web Audio timing
  const nextNoteTimeRef = useRef(0.0);
  const currentStepRef = useRef(0);
  const timerIDRef = useRef(null);
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;

  // Master Peak Meter Canvas
  const masterMeterCanvasRef = useRef(null);

  // Initialize Audio Nodes with Mixer Settings on Mount
  useEffect(() => {
    audio.init();
    mixerTracks.forEach((t) => {
      audio.setTrackParam(t.id, 'vol', t.vol);
      audio.setTrackParam(t.id, 'pan', t.pan);
      audio.setTrackParam(t.id, 'filterFreq', t.filter);
      audio.setTrackParam(t.id, 'delaySend', t.delay);
      audio.setTrackParam(t.id, 'distortion', t.dist);
      audio.setTrackParam(t.id, 'mute', t.mute);
    });
  }, []);

  // Sync Master Volume
  useEffect(() => {
    audio.setMasterVolume(masterVol);
  }, [masterVol]);

  // Handle Mixer FX Adjustments
  const handleMixerParam = (trackId, param, value) => {
    setMixerTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return { ...t, [param]: value };
      }
      return t;
    }));
    audio.setTrackParam(trackId, param, value);
  };

  // ------------------------------------------
  // AUDIO SCHEDULER (Lookahead queue)
  // ------------------------------------------
  const scheduleNote = useCallback((stepNumber, time) => {
    // 1. Metronome Click
    if (metronome && stepNumber % 4 === 0) {
      audio.triggerMetronome(time, stepNumber === 0);
    }

    const currentPatternSteps = stepData[activePattern] || {};
    const currentPatternNotes = (pianoNotes[activePattern] && pianoNotes[activePattern][selectedChannelId]) || [];

    // Any solo active?
    const isAnySolo = channels.some(c => c.solo);

    channels.forEach(ch => {
      // Check channel active status
      if (ch.muted) return;
      if (isAnySolo && !ch.solo) return;

      const trackIdx = ch.mixerTrack;
      const stepVal = currentPatternSteps[ch.id]?.[stepNumber];

      // Piano Roll overrides or complements for synth
      if (ch.id === selectedChannelId && ch.type === 'synth') {
        const foundNotes = currentPatternNotes.filter(n => n.step === stepNumber);
        if (foundNotes.length > 0) {
          foundNotes.forEach(n => {
            const noteObj = NOTES.find(x => x.name === n.note);
            if (noteObj) {
              const dur = (60 / bpm / 4) * (n.length || 1);
              audio.triggerSynthLead(time, trackIdx, noteObj.freq, 0.9, dur);
            }
          });
          return;
        }
      }

      // Standard Step Sequencer Hit
      if (stepVal === 1) {
        switch (ch.id) {
          case 'kick':
            audio.triggerKick(time, trackIdx);
            break;
          case 'snare':
            audio.triggerSnare(time, trackIdx);
            break;
          case 'clap':
            audio.triggerClap(time, trackIdx);
            break;
          case 'hat_closed':
            audio.triggerHiHatClosed(time, trackIdx);
            break;
          case 'hat_open':
            audio.triggerHiHatOpen(time, trackIdx);
            break;
          case 'bass808':
            audio.trigger808(time, trackIdx, 55, 1.0, (60 / bpm / 4) * 3);
            break;
          case 'synth_lead':
            audio.triggerSynthLead(time, trackIdx, 440, 0.8, (60 / bpm / 4) * 2);
            break;
          default:
            break;
        }
      }
    });
  }, [activePattern, stepData, pianoNotes, selectedChannelId, channels, bpm, metronome]);

  // Scheduler Loop
  const scheduler = useCallback(() => {
    if (!audio.ctx) return;
    const lookahead = 25.0; // milliseconds
    const scheduleAheadTime = 0.1; // seconds

    while (nextNoteTimeRef.current < audio.ctx.currentTime + scheduleAheadTime) {
      scheduleNote(currentStepRef.current, nextNoteTimeRef.current);
      
      // Advance step time (16th note step)
      const secondsPerBeat = 60.0 / bpm;
      const stepTime = 0.25 * secondsPerBeat;
      nextNoteTimeRef.current += stepTime;

      // Update UI step
      const nextStep = (currentStepRef.current + 1) % 16;
      currentStepRef.current = nextStep;
      setCurrentStep(nextStep);
    }
    timerIDRef.current = setTimeout(scheduler, lookahead);
  }, [bpm, scheduleNote]);

  // Start / Stop Playback
  const handlePlay = () => {
    audio.ensureContext();
    if (isPlaying) return;
    setIsPlaying(true);
    currentStepRef.current = 0;
    setCurrentStep(0);
    nextNoteTimeRef.current = audio.ctx.currentTime + 0.05;
    scheduler();
  };

  const handlePause = () => {
    setIsPlaying(false);
    clearTimeout(timerIDRef.current);
  };

  const handleStop = () => {
    setIsPlaying(false);
    clearTimeout(timerIDRef.current);
    currentStepRef.current = 0;
    setCurrentStep(0);
  };

  // Restart loop if playing and tempo changes
  useEffect(() => {
    if (isPlaying) {
      clearTimeout(timerIDRef.current);
      scheduler();
    }
  }, [bpm, scheduler, isPlaying]);

  // Master visualizer loop
  useEffect(() => {
    let animId;
    const canvas = masterMeterCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const drawMeter = () => {
      animId = requestAnimationFrame(drawMeter);
      if (!audio.masterAnalyser) return;

      const dataArray = new Uint8Array(audio.masterAnalyser.frequencyBinCount);
      audio.masterAnalyser.getByteFrequencyData(dataArray);

      // Compute average volume & peak
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const level = Math.min(1, (avg / 128) * 1.3);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw Dual Stereo Peak Meter Bars
      const numSegments = 18;
      const segWidth = (canvas.width - 6) / 2;
      const segHeight = (canvas.height - 4) / numSegments;

      for (let channel = 0; channel < 2; channel++) {
        const xOffset = channel * (segWidth + 4) + 1;
        // slight stereo offset variation
        const chLevel = Math.max(0, level + (channel === 1 ? (Math.random() * 0.06 - 0.03) : 0));
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
  }, []);

  // Tap Tempo Function
  const handleTapTempo = () => {
    const now = performance.now();
    const times = tapTimesRef.current;
    times.push(now);

    if (times.length > 4) times.shift();

    if (times.length >= 2) {
      let intervals = [];
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
  const toggleStep = (channelId, stepIndex) => {
    audio.ensureContext();
    setStepData(prev => {
      const p = prev[activePattern] || {};
      const chSteps = [...(p[channelId] || new Array(16).fill(0))];
      chSteps[stepIndex] = chSteps[stepIndex] === 1 ? 0 : 1;
      return {
        ...prev,
        [activePattern]: {
          ...p,
          [channelId]: chSteps
        }
      };
    });

    // Preview sound when toggling ON
    const ch = channels.find(c => c.id === channelId);
    if (ch && (!stepData[activePattern]?.[channelId]?.[stepIndex])) {
      previewChannelSound(ch);
    }
  };

  const previewChannelSound = (channel) => {
    audio.ensureContext();
    const now = audio.ctx.currentTime;
    switch (channel.id) {
      case 'kick': audio.triggerKick(now, channel.mixerTrack); break;
      case 'snare': audio.triggerSnare(now, channel.mixerTrack); break;
      case 'clap': audio.triggerClap(now, channel.mixerTrack); break;
      case 'hat_closed': audio.triggerHiHatClosed(now, channel.mixerTrack); break;
      case 'hat_open': audio.triggerHiHatOpen(now, channel.mixerTrack); break;
      case 'bass808': audio.trigger808(now, channel.mixerTrack, 55, 1, 0.4); break;
      case 'synth_lead': audio.triggerSynthLead(now, channel.mixerTrack, 440, 0.8, 0.25); break;
      default: break;
    }
  };

  // Load Preset
  const loadPreset = (presetName) => {
    const p = PRESETS[presetName];
    if (!p) return;
    setBpm(p.bpm);
    setStepData(prev => ({
      ...prev,
      [activePattern]: JSON.parse(JSON.stringify(p.steps))
    }));
    if (p.notes) {
      setPianoNotes(prev => ({
        ...prev,
        [activePattern]: JSON.parse(JSON.stringify(p.notes))
      }));
    }
  };

  // Clear current pattern
  const clearCurrentPattern = () => {
    setStepData(prev => {
      const empty = {};
      channels.forEach(ch => {
        empty[ch.id] = new Array(16).fill(0);
      });
      return { ...prev, [activePattern]: empty };
    });
    setPianoNotes(prev => ({ ...prev, [activePattern]: {} }));
  };

  // Randomize pattern
  const randomizePattern = () => {
    audio.ensureContext();
    setStepData(prev => {
      const randomized = {};
      channels.forEach(ch => {
        randomized[ch.id] = new Array(16).fill(0).map(() => (Math.random() > 0.72 ? 1 : 0));
      });
      return { ...prev, [activePattern]: randomized };
    });
  };

  // Channel Mute & Solo
  const toggleMute = (channelId) => {
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, muted: !ch.muted } : ch));
  };

  const toggleSolo = (channelId) => {
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
              <span className="text-sm font-black tracking-wider text-orange-400 block font-mono">FL-REACT</span>
              <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold">Producer Ed.</span>
            </div>
          </div>

          {/* Mode Switcher: PAT vs SONG */}
          <div className="flex items-center bg-zinc-900/90 p-0.5 rounded border border-zinc-700/80">
            <button
              onClick={() => setPlayMode('PAT')}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded transition-all ${
                playMode === 'PAT'
                  ? 'bg-orange-500 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              PAT
            </button>
            <button
              onClick={() => setPlayMode('SONG')}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded transition-all ${
                playMode === 'SONG'
                  ? 'bg-amber-400 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              SONG
            </button>
          </div>

          {/* Pattern Selector */}
          <div className="flex items-center gap-1 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/80">
            <Layers className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs text-zinc-400 font-mono">PAT:</span>
            {[1, 2, 3, 4].map(num => (
              <button
                key={num}
                onClick={() => setActivePattern(num)}
                className={`w-5 h-5 text-xs font-mono font-bold rounded flex items-center justify-center transition-all ${
                  activePattern === num
                    ? 'bg-orange-500 text-zinc-950 shadow'
                    : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        {/* Center: Playback Controls & LED Displays */}
        <div className="flex items-center gap-3">
          {/* Main Transport Buttons */}
          <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-md border border-zinc-700/80 shadow-inner">
            <button
              onClick={handlePlay}
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
              onClick={handlePause}
              title="Pause"
              className={`p-2 rounded transition-all ${
                !isPlaying && currentStep !== 0
                  ? 'bg-amber-500 text-zinc-950 shadow-[0_0_12px_rgba(245,158,11,0.6)]'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <Pause className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={handleStop}
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
                {String(currentStep + 1).padStart(2, '0')} / 16
              </span>
            </div>
          </div>

          {/* BPM Control & Tap Tempo */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/80">
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-mono text-zinc-400 leading-none">TEMPO</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setBpm(b => Math.max(40, b - 1))}
                  className="w-4 h-4 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center justify-center text-zinc-300"
                >
                  -
                </button>
                <input
                  type="number"
                  value={bpm}
                  onChange={(e) => setBpm(Math.min(260, Math.max(40, Number(e.target.value) || 120)))}
                  className="w-12 bg-black text-center text-orange-400 font-mono font-bold text-xs py-0.5 rounded border border-zinc-700 outline-none"
                />
                <button
                  onClick={() => setBpm(b => Math.min(260, b + 1))}
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
              max="1"
              step="0.01"
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
                <span>16 Steps</span>
                <span className="text-zinc-600">|</span>
                <span>Swing: 0%</span>
              </div>
            </div>

            {/* Channels & Step Grid */}
            <div className="divide-y divide-zinc-800/80">
              {channels.map((channel) => {
                const currentPatternSteps = stepData[activePattern]?.[channel.id] || new Array(16).fill(0);
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
                      {Array.from({ length: 16 }).map((_, stepIdx) => {
                        const isStepActive = currentPatternSteps[stepIdx] === 1;
                        const isCurrentPlayStep = currentStep === stepIdx && isPlaying;
                        // FL Studio 4-beat grouping (alternating colors every 4 steps)
                        const groupIdx = Math.floor(stepIdx / 4);
                        const isEvenGroup = groupIdx % 2 === 0;

                        return (
                          <button
                            key={stepIdx}
                            onClick={() => toggleStep(channel.id, stepIdx)}
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

        {/* VIEW 2: PIANO ROLL & MELODY EDITOR */}
        {activeTab === 'pianoRoll' && (
          <div className="max-w-6xl w-full mx-auto bg-[#202428] rounded-lg border border-zinc-700/70 shadow-2xl flex flex-col h-full max-h-[640px]">
            {/* Piano Roll Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-850 border-b border-zinc-700/70">
              <div className="flex items-center gap-3">
                <Music className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
                  Piano Roll • {channels.find(c => c.id === selectedChannelId)?.name || 'Lead Synth'}
                </h2>
                <span className="text-[10px] text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700 font-mono">
                  Snap: 1/16 Step
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="bg-zinc-900 text-xs text-orange-400 font-semibold px-2 py-1 rounded border border-zinc-700 outline-none"
                >
                  {channels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setPianoNotes(prev => ({
                      ...prev,
                      [activePattern]: {
                        ...(prev[activePattern] || {}),
                        [selectedChannelId]: []
                      }
                    }));
                  }}
                  className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-red-900/50 text-zinc-300 hover:text-red-300 rounded border border-zinc-700"
                >
                  Clear Notes
                </button>
              </div>
            </div>

            {/* Piano Roll Body: Vertical Keyboard + 16-step Grid */}
            <div className="flex-1 overflow-auto flex relative bg-[#181a1d]">
              {/* Vertical Piano Keys */}
              <div className="w-20 shrink-0 sticky left-0 z-10 bg-zinc-900 border-r border-zinc-700/80 shadow-md">
                {NOTES.map((note) => {
                  const isSharp = note.name.includes('#');
                  return (
                    <button
                      key={note.name}
                      onClick={() => {
                        audio.ensureContext();
                        const ch = channels.find(c => c.id === selectedChannelId);
                        audio.triggerSynthLead(audio.ctx.currentTime, ch ? ch.mixerTrack : 5, note.freq, 0.85, 0.4);
                      }}
                      className={`w-full h-6 text-[10px] font-mono flex items-center justify-end pr-2 border-b border-zinc-800 transition active:scale-95 ${
                        isSharp
                          ? 'bg-[#1b1c1e] text-zinc-400 hover:bg-zinc-700'
                          : 'bg-[#e4e7eb] text-zinc-900 font-bold hover:bg-white'
                      }`}
                    >
                      {note.name}
                    </button>
                  );
                })}
              </div>

              {/* Note Grid */}
              <div className="flex-1 grid grid-cols-16 min-w-[640px] relative">
                {/* Visual playback indicator column line */}
                {isPlaying && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_8px_#34d399] pointer-events-none z-20 transition-all duration-75"
                    style={{ left: `${(currentStep / 16) * 100}%` }}
                  />
                )}

                {NOTES.map((note) => {
                  const currentPatternNoteList = (pianoNotes[activePattern] && pianoNotes[activePattern][selectedChannelId]) || [];

                  return (
                    <div key={note.name} className="contents">
                      {Array.from({ length: 16 }).map((_, stepIdx) => {
                        const noteBlock = currentPatternNoteList.find(n => n.step === stepIdx && n.note === note.name);
                        const isEvenBeat = Math.floor(stepIdx / 4) % 2 === 0;

                        return (
                          <div
                            key={`${note.name}-${stepIdx}`}
                            onClick={() => {
                              audio.ensureContext();
                              setPianoNotes(prev => {
                                const pat = prev[activePattern] || {};
                                const chNotes = [...(pat[selectedChannelId] || [])];
                                const existingIndex = chNotes.findIndex(n => n.step === stepIdx && n.note === note.name);

                                if (existingIndex >= 0) {
                                  // remove note
                                  chNotes.splice(existingIndex, 1);
                                } else {
                                  // add note
                                  chNotes.push({ step: stepIdx, note: note.name, length: 2 });
                                  // preview note audio
                                  const ch = channels.find(c => c.id === selectedChannelId);
                                  audio.triggerSynthLead(audio.ctx.currentTime, ch ? ch.mixerTrack : 5, note.freq, 0.8, 0.3);
                                }

                                return {
                                  ...prev,
                                  [activePattern]: {
                                    ...pat,
                                    [selectedChannelId]: chNotes
                                  }
                                };
                              });
                            }}
                            className={`h-6 border-b border-r border-zinc-800/80 cursor-pointer relative transition-colors ${
                              isEvenBeat ? 'bg-[#23272c]' : 'bg-[#1e2226]'
                            } hover:bg-zinc-700/40`}
                          >
                            {/* Render Active Note Block */}
                            {noteBlock && (
                              <div
                                className="absolute inset-y-0.5 left-0.5 right-0.5 rounded bg-gradient-to-r from-orange-500 to-amber-500 border border-orange-300 flex items-center px-1 text-[9px] font-mono font-bold text-zinc-950 shadow-md overflow-hidden z-10"
                                title={`${noteBlock.note} (Step ${noteBlock.step})`}
                              >
                                {noteBlock.note}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
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
            AUDIO ENGINE: ACTIVE
          </span>
          <span className="text-zinc-600">|</span>
          <span>Sample Rate: 44.1 kHz</span>
          <span className="text-zinc-600">|</span>
          <span>Buffer: Low-Latency Lookahead</span>
        </div>
        <div className="text-zinc-500">
          FL Web Studio • Ready for recording and sequencing
        </div>
      </footer>
    </div>
  );
}