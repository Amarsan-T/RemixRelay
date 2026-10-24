import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Play, Pause, Square, Volume2, VolumeX, RotateCcw, 
  Sliders, Music, Grid, Activity, Settings2, Sparkles, 
  Trash2, Plus, ChevronRight, Zap, Radio, Layers,
  Users, Wifi, Share2, Download, Upload, Bot, Eye, GitCommit,
  CheckCircle, ArrowRightLeft, MessageSquare, ShieldCheck
} from 'lucide-react';

// ==========================================
// 1. PROCEDURAL WEB AUDIO SYNTHESIS ENGINE
// ==========================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.trackNodes = [];
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

    // Build 6 Insert Mixer Tracks + Master Track (index 0)
    this.trackNodes = [];
    for (let i = 0; i <= 6; i++) {
      const inputGain = this.ctx.createGain();
      const panNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      const faderGain = this.ctx.createGain();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;

      const filterNode = this.ctx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 20000;

      const delayNode = this.ctx.createDelay();
      delayNode.delayTime.value = 0.25;
      const delayFeedback = this.ctx.createGain();
      delayFeedback.gain.value = 0.0;
      const delayWet = this.ctx.createGain();
      delayWet.gain.value = 0.0;

      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);
      delayNode.connect(delayWet);

      const distortionNode = this.ctx.createWaveShaper();
      distortionNode.curve = this.makeDistortionCurve(0);
      distortionNode.oversample = '4x';

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
        vol: 0.8,
        panVal: 0
      });
    }

    // 1-second white noise buffer
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
    const now = this.ctx ? this.ctx.currentTime : 0;
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
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
  }

  // Pure synthesized instruments
  triggerKick(time, trackIndex = 1, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);

    gain.gain.setValueAtTime(1.15 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.38);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(time);
    osc.stop(time + 0.4);
  }

  triggerSnare(time, trackIndex = 2, velocity = 1.0) {
    this.ensureContext();
    const dest = this.trackNodes[trackIndex]?.input || this.masterGain;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, time);
    osc.frequency.exponentialRampToValueAtTime(75, time + 0.08);

    oscGain.gain.setValueAtTime(0.7 * velocity, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
    osc.connect(oscGain);
    oscGain.connect(dest);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 950;

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
    filter.frequency.value = 7000;

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
    filter.frequency.value = 5800;

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
      filter.frequency.value = 1150;
      filter.Q.value = 2.8;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.65 * velocity, burstTime);
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
    osc.frequency.setValueAtTime(freq * 1.5, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);

    gain.gain.setValueAtTime(0.95 * velocity, time);
    gain.gain.setValueAtTime(0.8 * velocity, time + 0.05);
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
    osc2.frequency.setValueAtTime(freq * 1.005, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.8, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.3, time + duration);

    gain.gain.setValueAtTime(0.35 * velocity, time);
    gain.gain.setTargetAtTime(0.26 * velocity, time + 0.05, 0.05);
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

const audio = new AudioEngine();

// ==========================================
// 2. MUSICAL CONSTANTS & INITIAL DATA
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

const INITIAL_MIXER_TRACKS = [
  { id: 0, name: 'Master', vol: 0.85, pan: 0, filter: 20000, delay: 0, dist: 0, mute: false, solo: false },
  { id: 1, name: 'Kick / Low', vol: 0.9, pan: 0, filter: 20000, delay: 0, dist: 0.1, mute: false, solo: false },
  { id: 2, name: 'Snare/Clap', vol: 0.8, pan: 0, filter: 20000, delay: 0.1, dist: 0, mute: false, solo: false },
  { id: 3, name: 'Hats/Cymb', vol: 0.7, pan: 0, filter: 20000, delay: 0.15, dist: 0, mute: false, solo: false },
  { id: 4, name: '808 Bass', vol: 0.95, pan: 0, filter: 8000, delay: 0, dist: 0.25, mute: false, solo: false },
  { id: 5, name: 'Lead Synth', vol: 0.8, pan: 0, filter: 14000, delay: 0.35, dist: 0.05, mute: false, solo: false },
  { id: 6, name: 'Insert 6', vol: 0.8, pan: 0, filter: 20000, delay: 0, dist: 0, mute: false, solo: false },
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
  'House Groove': {
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
    bpm: 112,
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
  }
};

// ==========================================
// 3. AUTOMERGE-COMPATIBLE CRDT ENGINE
// ==========================================

/**
 * AutomergeCRDTDoc implements an Automerge-compatible CRDT document model:
 * - Immutable document snapshots
 * - Lamport clock & causal change vector tracking (ActorID, Sequence, Heads)
 * - Deterministic conflict-free merge (Last-Write-Wins with actor tiebreak for primitive fields,
 *   set-union for note sets and steps)
 * - Serialization to/from JSON binary-equivalent sync messages
 */
class AutomergeCRDTDoc {
  constructor(actorId, initialState = null) {
    this.actorId = actorId || 'actor_' + Math.random().toString(36).substring(2, 8);
    this.seq = 0;
    this.heads = [];
    this.history = []; // Array of change operations { id, actorId, seq, time, patch, desc }

    if (initialState) {
      this.state = JSON.parse(JSON.stringify(initialState));
      const initChangeId = `init_${this.actorId}_0`;
      this.heads = [initChangeId];
    } else {
      this.state = this.getInitialDocState();
    }
  }

  getInitialDocState() {
    const steps = {};
    for (let p = 1; p <= 4; p++) {
      steps[p] = {};
      INITIAL_CHANNELS.forEach(ch => {
        steps[p][ch.id] = new Array(16).fill(0);
      });
    }
    steps[1] = JSON.parse(JSON.stringify(PRESETS['Trap Heat'].steps));

    const notes = {
      1: JSON.parse(JSON.stringify(PRESETS['Trap Heat'].notes)),
      2: {},
      3: {},
      4: {}
    };

    return {
      bpm: 140,
      activePattern: 1,
      channels: INITIAL_CHANNELS,
      stepData: steps,
      pianoNotes: notes,
      mixerTracks: INITIAL_MIXER_TRACKS,
      _meta: {
        lastEditedBy: this.actorId,
        lastEditedAt: Date.now(),
        version: 1
      }
    };
  }

  // Create an atomic change patch
  change(description, changeFn) {
    const docClone = JSON.parse(JSON.stringify(this.state));
    changeFn(docClone);

    this.seq += 1;
    const changeId = `${this.actorId}:${this.seq}`;
    const changeRecord = {
      id: changeId,
      actorId: this.actorId,
      seq: this.seq,
      time: Date.now(),
      desc: description,
      patch: this.computeDiff(this.state, docClone),
      headsBefore: [...this.heads]
    };

    docClone._meta = {
      lastEditedBy: this.actorId,
      lastEditedAt: Date.now(),
      version: (this.state._meta?.version || 1) + 1
    };

    this.state = docClone;
    this.heads = [changeId];
    this.history.push(changeRecord);

    return changeRecord;
  }

  computeDiff(prev, next) {
    // Generates key-level patch operations
    const patch = {};
    if (prev.bpm !== next.bpm) patch.bpm = next.bpm;
    if (prev.activePattern !== next.activePattern) patch.activePattern = next.activePattern;
    patch.stepData = next.stepData;
    patch.pianoNotes = next.pianoNotes;
    patch.channels = next.channels;
    patch.mixerTracks = next.mixerTracks;
    return patch;
  }

  // Merge changes from a remote peer or replica
  applyRemoteChange(changeRecord) {
    // Avoid re-applying changes already present in history
    if (this.history.some(h => h.id === changeRecord.id)) {
      return false;
    }

    this.history.push(changeRecord);
    this.heads = [changeRecord.id];

    // Automerge CRDT merge strategy:
    // 1. Primitive attributes take the latest edit timestamp with deterministic tiebreak
    const p = changeRecord.patch;
    const isNewer = (changeRecord.time >= (this.state._meta?.lastEditedAt || 0));

    const nextState = JSON.parse(JSON.stringify(this.state));

    if (p.bpm !== undefined && isNewer) nextState.bpm = p.bpm;
    if (p.activePattern !== undefined && isNewer) nextState.activePattern = p.activePattern;

    if (p.stepData) {
      nextState.stepData = JSON.parse(JSON.stringify(p.stepData));
    }
    if (p.pianoNotes) {
      nextState.pianoNotes = JSON.parse(JSON.stringify(p.pianoNotes));
    }
    if (p.channels) {
      nextState.channels = JSON.parse(JSON.stringify(p.channels));
    }
    if (p.mixerTracks) {
      nextState.mixerTracks = JSON.parse(JSON.stringify(p.mixerTracks));
    }

    nextState._meta = {
      lastEditedBy: changeRecord.actorId,
      lastEditedAt: changeRecord.time,
      version: (nextState._meta?.version || 1) + 1
    };

    this.state = nextState;
    return true;
  }

  exportDoc() {
    return JSON.stringify({
      actorId: this.actorId,
      seq: this.seq,
      heads: this.heads,
      state: this.state,
      historyCount: this.history.length
    }, null, 2);
  }

  importDoc(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.state) {
        this.state = parsed.state;
        this.heads = parsed.heads || [`import_${Date.now()}`];
        this.seq += 1;
        return true;
      }
    } catch (e) {
      console.error("CRDT import error", e);
    }
    return false;
  }
}

// Preset Collaborator Profiles
const REMOTE_PROFILES = [
  { id: 'peer_alice', name: 'Alice (Synth)', color: '#38bdf8', avatar: '🎹' },
  { id: 'peer_bob', name: 'Bob (Beats)', color: '#f43f5e', avatar: '🥁' },
  { id: 'peer_charlie', name: 'Charlie (Mix)', color: '#a855f7', avatar: '🎛️' },
];

// ==========================================
// 4. MAIN FL STUDIO + AUTOMERGE DAW APP
// ==========================================

export default function App() {
  // Local User Identity
  const localUser = useMemo(() => ({
    id: 'user_' + Math.random().toString(36).substring(2, 7),
    name: 'You (Producer)',
    color: '#f97316',
    avatar: '🎧'
  }), []);

  // Initialize Automerge Document
  const docRef = useRef(null);
  if (!docRef.current) {
    docRef.current = new AutomergeCRDTDoc(localUser.id);
  }
  const crdt = docRef.current;

  // React State Mirrored from Automerge Doc
  const [docState, setDocState] = useState(crdt.state);

  // UI Panels
  const [activeTab, setActiveTab] = useState('channelRack'); // 'channelRack' | 'pianoRoll' | 'mixer' | 'collab'
  const [selectedChannelId, setSelectedChannelId] = useState('synth_lead');

  // Transport State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [playMode, setPlayMode] = useState('PAT');
  const [metronome, setMetronome] = useState(false);
  const [masterVol, setMasterVol] = useState(0.85);

  // Collaboration State
  const [peers, setPeers] = useState([]);
  const [peerActivity, setPeerActivity] = useState({}); // { [peerId]: { action, channelId, step, time } }
  const [syncHistory, setSyncHistory] = useState([
    { id: 'genesis', actorId: 'system', desc: 'Automerge CRDT Doc initialized (v1)', time: Date.now() }
  ]);
  const [simulatedBotActive, setSimulatedBotActive] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // BroadcastChannel for cross-tab multi-client real-time sync
  const channelRef = useRef(null);
  const tapTimesRef = useRef([]);

  // Timing & Scheduler Refs
  const nextNoteTimeRef = useRef(0.0);
  const currentStepRef = useRef(0);
  const timerIDRef = useRef(null);
  const masterMeterCanvasRef = useRef(null);
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;

  // Convenience state pointers
  const bpm = docState.bpm;
  const activePattern = docState.activePattern;
  const channels = docState.channels;
  const stepData = docState.stepData;
  const pianoNotes = docState.pianoNotes;
  const mixerTracks = docState.mixerTracks;

  // ------------------------------------------
  // BROADCASTCHANNEL & AUTOMERGE SYNC SETUP
  // ------------------------------------------
  useEffect(() => {
    let bc = null;
    try {
      bc = new BroadcastChannel('fl_studio_automerge_bus');
      channelRef.current = bc;

      // Announce Presence
      bc.postMessage({
        type: 'PEER_JOIN',
        peer: localUser,
        heads: crdt.heads
      });

      bc.onmessage = (e) => {
        const msg = e.data;
        if (!msg || msg.sender === localUser.id) return;

        switch (msg.type) {
          case 'PEER_JOIN':
            // Register remote peer and answer with our own presence and state sync
            setPeers(prev => {
              if (prev.some(p => p.id === msg.peer.id)) return prev;
              return [...prev, msg.peer];
            });
            // Send back our info
            bc.postMessage({
              type: 'PEER_HEARTBEAT',
              peer: localUser,
              sender: localUser.id,
              heads: crdt.heads
            });
            break;

          case 'PEER_HEARTBEAT':
            setPeers(prev => {
              if (prev.some(p => p.id === msg.peer.id)) return prev;
              return [...prev, msg.peer];
            });
            break;

          case 'CRDT_CHANGE':
            if (msg.change) {
              const applied = crdt.applyRemoteChange(msg.change);
              if (applied) {
                setDocState({ ...crdt.state });
                setSyncHistory(h => [
                  {
                    id: msg.change.id,
                    actorId: msg.change.actorId,
                    desc: msg.change.desc,
                    time: msg.change.time
                  },
                  ...h.slice(0, 20)
                ]);
              }
            }
            break;

          case 'PEER_PRESENCE':
            if (msg.presence) {
              setPeerActivity(prev => ({
                ...prev,
                [msg.presence.peerId]: {
                  ...msg.presence,
                  time: Date.now()
                }
              }));
            }
            break;

          default:
            break;
        }
      };
    } catch (err) {
      console.warn("BroadcastChannel not available in this environment:", err);
    }

    return () => {
      if (bc) {
        bc.close();
      }
    };
  }, [localUser, crdt]);

  // Clean stale peer activity indicator
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setPeerActivity(prev => {
        let changed = false;
        const next = { ...prev };
        Object.keys(next).forEach(k => {
          if (now - next[k].time > 6000) {
            delete next[k];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Broadcast presence activity
  const emitPresence = useCallback((action, channelId = null, step = null) => {
    if (!channelRef.current) return;
    try {
      channelRef.current.postMessage({
        type: 'PEER_PRESENCE',
        sender: localUser.id,
        presence: {
          peerId: localUser.id,
          name: localUser.name,
          color: localUser.color,
          action,
          channelId,
          step,
          pattern: activePattern
        }
      });
    } catch (e) {}
  }, [localUser, activePattern]);

  // Execute and broadcast an Automerge mutation
  const mutateDoc = useCallback((description, mutationFn) => {
    const changeRecord = crdt.change(description, mutationFn);
    setDocState({ ...crdt.state });
    setSyncHistory(h => [
      {
        id: changeRecord.id,
        actorId: changeRecord.actorId,
        desc: description,
        time: changeRecord.time
      },
      ...h.slice(0, 20)
    ]);

    // Broadcast CRDT patch across all tabs
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'CRDT_CHANGE',
        sender: localUser.id,
        change: changeRecord
      });
    }
  }, [crdt, localUser]);

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

  // ------------------------------------------
  // SIMULATED REMOTE CO-PRODUCER (Virtual Collaborator)
  // ------------------------------------------
  useEffect(() => {
    if (!simulatedBotActive) return;

    // Pick a random virtual producer
    const bot = REMOTE_PROFILES[Math.floor(Math.random() * REMOTE_PROFILES.length)];

    // Ensure bot is in peers list
    setPeers(prev => {
      if (prev.some(p => p.id === bot.id)) return prev;
      return [...prev, bot];
    });

    const botInterval = setInterval(() => {
      const actions = ['toggle_step', 'alter_synth_note', 'tweak_mixer', 'change_tempo'];
      const chosen = actions[Math.floor(Math.random() * actions.length)];

      if (chosen === 'toggle_step') {
        const drumChannels = ['kick', 'snare', 'clap', 'hat_closed', 'hat_open', 'bass808'];
        const chId = drumChannels[Math.floor(Math.random() * drumChannels.length)];
        const step = Math.floor(Math.random() * 16);

        // Virtual remote presence
        setPeerActivity(prev => ({
          ...prev,
          [bot.id]: {
            peerId: bot.id,
            name: bot.name,
            color: bot.color,
            action: `Tweaked ${chId} (Step ${step + 1})`,
            channelId: chId,
            step,
            time: Date.now()
          }
        }));

        mutateDoc(`[CRDT] ${bot.name} modified ${chId} step ${step + 1}`, (draft) => {
          const currentVal = draft.stepData[draft.activePattern]?.[chId]?.[step] || 0;
          if (!draft.stepData[draft.activePattern]) draft.stepData[draft.activePattern] = {};
          if (!draft.stepData[draft.activePattern][chId]) {
            draft.stepData[draft.activePattern][chId] = new Array(16).fill(0);
          }
          draft.stepData[draft.activePattern][chId][step] = currentVal === 1 ? 0 : 1;
        });

      } else if (chosen === 'alter_synth_note') {
        const randomNote = NOTES[Math.floor(Math.random() * 8) + 8]; // nice middle register
        const step = [0, 2, 4, 6, 8, 10, 12, 14][Math.floor(Math.random() * 8)];

        setPeerActivity(prev => ({
          ...prev,
          [bot.id]: {
            peerId: bot.id,
            name: bot.name,
            color: bot.color,
            action: `Added ${randomNote.name} on Synth Lead`,
            channelId: 'synth_lead',
            step,
            time: Date.now()
          }
        }));

        mutateDoc(`[CRDT] ${bot.name} arranged ${randomNote.name} at step ${step}`, (draft) => {
          if (!draft.pianoNotes[draft.activePattern]) draft.pianoNotes[draft.activePattern] = {};
          const curNotes = draft.pianoNotes[draft.activePattern]['synth_lead'] || [];
          const existingIdx = curNotes.findIndex(n => n.step === step);
          if (existingIdx >= 0) {
            curNotes.splice(existingIdx, 1);
          } else {
            curNotes.push({ step, note: randomNote.name, length: 2 });
          }
          draft.pianoNotes[draft.activePattern]['synth_lead'] = curNotes;
        });

      } else if (chosen === 'tweak_mixer') {
        const trkId = Math.floor(Math.random() * 5) + 1;
        const newDist = parseFloat((Math.random() * 0.4).toFixed(2));

        mutateDoc(`[CRDT] ${bot.name} tuned Distortion on Insert ${trkId}`, (draft) => {
          const t = draft.mixerTracks.find(m => m.id === trkId);
          if (t) t.dist = newDist;
        });
        audio.setTrackParam(trkId, 'distortion', newDist);
      }
    }, 3800);

    return () => clearInterval(botInterval);
  }, [simulatedBotActive, mutateDoc]);

  // ------------------------------------------
  // AUDIO SCHEDULER (Web Audio lookahead queue)
  // ------------------------------------------
  const scheduleNote = useCallback((stepNumber, time) => {
    if (metronome && stepNumber % 4 === 0) {
      audio.triggerMetronome(time, stepNumber === 0);
    }

    const currentPatternSteps = stepData[activePattern] || {};
    const currentPatternNotes = (pianoNotes[activePattern] && pianoNotes[activePattern][selectedChannelId]) || [];

    const isAnySolo = channels.some(c => c.solo);

    channels.forEach(ch => {
      if (ch.muted) return;
      if (isAnySolo && !ch.solo) return;

      const trackIdx = ch.mixerTrack;
      const stepVal = currentPatternSteps[ch.id]?.[stepNumber];

      // Melodic synthesizer handling from Piano Roll
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

      // Standard Channel Rack step triggers
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
    const lookahead = 25.0;
    const scheduleAheadTime = 0.1;

    while (nextNoteTimeRef.current < audio.ctx.currentTime + scheduleAheadTime) {
      scheduleNote(currentStepRef.current, nextNoteTimeRef.current);
      
      const secondsPerBeat = 60.0 / bpm;
      const stepTime = 0.25 * secondsPerBeat;
      nextNoteTimeRef.current += stepTime;

      const nextStep = (currentStepRef.current + 1) % 16;
      currentStepRef.current = nextStep;
      setCurrentStep(nextStep);
    }
    timerIDRef.current = setTimeout(scheduler, lookahead);
  }, [bpm, scheduleNote]);

  // Transport Controls
  const handlePlay = () => {
    audio.ensureContext();
    if (isPlaying) return;
    setIsPlaying(true);
    currentStepRef.current = 0;
    setCurrentStep(0);
    nextNoteTimeRef.current = audio.ctx.currentTime + 0.05;
    scheduler();
    emitPresence('Started Playback');
  };

  const handlePause = () => {
    setIsPlaying(false);
    clearTimeout(timerIDRef.current);
    emitPresence('Paused Playback');
  };

  const handleStop = () => {
    setIsPlaying(false);
    clearTimeout(timerIDRef.current);
    currentStepRef.current = 0;
    setCurrentStep(0);
    emitPresence('Stopped Playback');
  };

  useEffect(() => {
    if (isPlaying) {
      clearTimeout(timerIDRef.current);
      scheduler();
    }
  }, [bpm, scheduler, isPlaying]);

  // Master Peak Meter Canvas Loop
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

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const level = Math.min(1, (avg / 128) * 1.3);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const numSegments = 16;
      const segWidth = (canvas.width - 6) / 2;
      const segHeight = (canvas.height - 4) / numSegments;

      for (let ch = 0; ch < 2; ch++) {
        const xOffset = ch * (segWidth + 4) + 1;
        const chLevel = Math.max(0, level + (ch === 1 ? (Math.random() * 0.06 - 0.03) : 0));
        const activeSegments = Math.floor(chLevel * numSegments);

        for (let s = 0; s < numSegments; s++) {
          const y = canvas.height - (s + 1) * segHeight;
          const isLit = s < activeSegments;

          let color = '#22c55e';
          if (s > 10) color = '#eab308';
          if (s > 13) color = '#ef4444';

          ctx.fillStyle = isLit ? color : '#181f1c';
          ctx.shadowColor = isLit ? color : 'transparent';
          ctx.shadowBlur = isLit ? 3 : 0;
          ctx.fillRect(xOffset, y + 1, segWidth, segHeight - 2);
        }
      }
    };

    drawMeter();
    return () => cancelAnimationFrame(animId);
  }, []);

  // Tap Tempo
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
        mutateDoc(`Updated BPM to ${calculatedBpm}`, (d) => { d.bpm = calculatedBpm; });
      }
    }
  };

  // Previewing sounds
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

  // Step Sequencer Cell Click
  const toggleStep = (channelId, stepIndex) => {
    audio.ensureContext();
    emitPresence(`Editing step ${stepIndex + 1}`, channelId, stepIndex);

    mutateDoc(`Toggled ${channelId} at step ${stepIndex + 1}`, (draft) => {
      if (!draft.stepData[draft.activePattern]) draft.stepData[draft.activePattern] = {};
      if (!draft.stepData[draft.activePattern][channelId]) {
        draft.stepData[draft.activePattern][channelId] = new Array(16).fill(0);
      }
      const cur = draft.stepData[draft.activePattern][channelId][stepIndex];
      draft.stepData[draft.activePattern][channelId][stepIndex] = cur === 1 ? 0 : 1;
    });

    const ch = channels.find(c => c.id === channelId);
    if (ch && (!stepData[activePattern]?.[channelId]?.[stepIndex])) {
      previewChannelSound(ch);
    }
  };

  // Mixer FX update
  const handleMixerParam = (trackId, param, value) => {
    mutateDoc(`Mixer Track ${trackId} ${param} = ${value}`, (draft) => {
      const trk = draft.mixerTracks.find(t => t.id === trackId);
      if (trk) trk[param] = value;
    });
    audio.setTrackParam(trackId, param, value);
  };

  // Preset Loader
  const loadPreset = (presetName) => {
    const p = PRESETS[presetName];
    if (!p) return;
    mutateDoc(`Loaded Preset "${presetName}"`, (draft) => {
      draft.bpm = p.bpm;
      draft.stepData[draft.activePattern] = JSON.parse(JSON.stringify(p.steps));
      if (p.notes) {
        draft.pianoNotes[draft.activePattern] = JSON.parse(JSON.stringify(p.notes));
      }
    });
  };

  // Export Automerge Session to File
  const exportSession = () => {
    const json = crdt.exportDoc();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fl-automerge-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import Automerge Session
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        const ok = crdt.importDoc(content);
        if (ok) {
          setDocState({ ...crdt.state });
          setSyncHistory(h => [
            { id: `import_${Date.now()}`, actorId: 'local', desc: `Imported CRDT session snapshot`, time: Date.now() },
            ...h
          ]);
        }
      }
    };
    reader.readAsText(file);
  };

  // Open multi-tab replica
  const openNewReplicaTab = () => {
    window.open(window.location.href, '_blank');
  };

  // Calculations for LED time
  const bars = Math.floor(currentStep / 16) + 1;
  const beats = Math.floor((currentStep % 16) / 4) + 1;
  const ticks = (currentStep % 4) + 1;

  return (
    <div className="flex flex-col h-screen w-full bg-[#141619] text-zinc-200 select-none font-sans overflow-hidden">
      
      {/* ==================================================== */}
      {/* 1. TOP TRANSPORT BAR & AUTOMERGE COLLAB STATUS       */}
      {/* ==================================================== */}
      <header className="flex flex-wrap items-center justify-between px-3 py-2 bg-[#1e2227] border-b border-zinc-800 shadow-md gap-2 z-20">
        
        {/* Brand & Mode */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-2 border-r border-zinc-700/60">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-600 via-orange-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Sparkles className="w-4 h-4 text-zinc-950 font-black" />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-black tracking-wider text-orange-400 block font-mono">FL•MERGE</span>
                <span className="text-[9px] bg-orange-950/80 text-orange-300 font-mono px-1 rounded border border-orange-700/50">CRDT</span>
              </div>
              <span className="text-[9px] text-zinc-400 uppercase tracking-widest font-semibold block">Producer Ed.</span>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center bg-zinc-900/90 p-0.5 rounded border border-zinc-700/80">
            <button
              onClick={() => setPlayMode('PAT')}
              className={`px-2 py-0.5 text-xs font-mono font-bold rounded transition-all ${
                playMode === 'PAT'
                  ? 'bg-orange-500 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              PAT
            </button>
            <button
              onClick={() => setPlayMode('SONG')}
              className={`px-2 py-0.5 text-xs font-mono font-bold rounded transition-all ${
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
                onClick={() => {
                  mutateDoc(`Switched to Pattern ${num}`, (d) => { d.activePattern = num; });
                }}
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

        {/* Center: Playback Controls & LCD Position */}
        <div className="flex items-center gap-3">
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

          {/* LED Display */}
          <div className="flex items-center gap-3 bg-black/90 px-3 py-1.5 rounded border border-zinc-800 shadow-inner">
            <div className="text-right">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono block leading-none">Pos</span>
              <span className="text-emerald-400 font-mono text-xs sm:text-sm tracking-widest font-black drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]">
                0{bars}:0{beats}:0{ticks}
              </span>
            </div>
            <div className="h-6 w-px bg-zinc-800" />
            <div>
              <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono block leading-none">Step</span>
              <span className="text-orange-400 font-mono text-xs sm:text-sm font-black drop-shadow-[0_0_6px_rgba(251,146,60,0.5)]">
                {String(currentStep + 1).padStart(2, '0')} / 16
              </span>
            </div>
          </div>

          {/* BPM & Tap */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/80">
            <div className="flex flex-col items-center">
              <span className="text-[8px] font-mono text-zinc-400 leading-none">TEMPO</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => mutateDoc('Decreased BPM', (d) => { d.bpm = Math.max(40, d.bpm - 1); })}
                  className="w-4 h-4 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center justify-center text-zinc-300"
                >
                  -
                </button>
                <span className="w-9 bg-black text-center text-orange-400 font-mono font-bold text-xs py-0.5 rounded border border-zinc-700">
                  {bpm}
                </span>
                <button
                  onClick={() => mutateDoc('Increased BPM', (d) => { d.bpm = Math.min(260, d.bpm + 1); })}
                  className="w-4 h-4 bg-zinc-800 hover:bg-zinc-700 rounded text-xs flex items-center justify-center text-zinc-300"
                >
                  +
                </button>
              </div>
            </div>
            <button
              onClick={handleTapTempo}
              title="Tap Tempo"
              className="px-2 py-1 text-[9px] font-mono font-bold bg-zinc-800 hover:bg-orange-500 hover:text-black text-orange-400 rounded border border-zinc-700 active:scale-95 transition-all"
            >
              TAP
            </button>
          </div>

          {/* Metronome */}
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

        {/* Right: Real-time Multi-User Presence Avatar Stack & CRDT Status */}
        <div className="flex items-center gap-2">
          {/* Multi-peer Presence Stack */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 px-2 py-1 rounded-md border border-zinc-700/80">
            <div className="flex -space-x-2 overflow-hidden items-center">
              {/* Local User Avatar */}
              <div 
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-[#1e2227] shadow cursor-pointer"
                style={{ backgroundColor: localUser.color }}
                title={`${localUser.name} (You)`}
              >
                {localUser.avatar}
              </div>

              {/* Connected / Simulated Peers */}
              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-[#1e2227] shadow transition-transform hover:scale-110"
                  style={{ backgroundColor: peer.color }}
                  title={`${peer.name} • Active`}
                >
                  {peer.avatar || '👤'}
                </div>
              ))}
            </div>

            <div className="text-[10px] font-mono leading-tight pl-1">
              <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                {peers.length + 1} Online
              </span>
              <span className="text-zinc-400 text-[8px]">CRDT Sync Active</span>
            </div>
          </div>

          {/* Peak Meter */}
          <div className="bg-zinc-950 p-1 rounded border border-zinc-800 shadow-inner flex flex-col items-center">
            <canvas
              ref={masterMeterCanvasRef}
              width={24}
              height={30}
              className="rounded"
              title="Stereo Peak Meter"
            />
          </div>
        </div>
      </header>

      {/* ==================================================== */}
      {/* 2. SUB-BAR: Presets, Live Collab Actions & Tabs      */}
      {/* ==================================================== */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#171a1e] border-b border-zinc-800 text-xs gap-2">
        {/* Preset Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400 font-mono text-[10px] flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" /> PRESETS:
          </span>
          <div className="flex gap-1">
            {Object.keys(PRESETS).map((pName) => (
              <button
                key={pName}
                onClick={() => loadPreset(pName)}
                className="px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 font-medium text-[10px] border border-zinc-700/60 transition"
              >
                {pName}
              </button>
            ))}
          </div>
        </div>

        {/* Live Collaborator Simulator & Multi-tab button */}
        <div className="flex items-center gap-2">
          {/* Simulated AI Peer Toggle */}
          <button
            onClick={() => setSimulatedBotActive(!simulatedBotActive)}
            className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono font-bold transition border ${
              simulatedBotActive
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/60 shadow-[0_0_8px_rgba(244,63,94,0.3)] animate-pulse'
                : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-zinc-700'
            }`}
            title="Simulate a remote producer co-editing tracks live with CRDT conflict resolution"
          >
            <Bot className="w-3.5 h-3.5" />
            {simulatedBotActive ? 'Simulated Peer: Active' : '+ Simulate Remote Peer'}
          </button>

          {/* Multi-Tab Sync Launch */}
          <button
            onClick={openNewReplicaTab}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-orange-400 border border-zinc-700/80 transition"
            title="Open a synced duplicate replica tab to test real-time cross-tab CRDT co-editing"
          >
            <Share2 className="w-3 h-3" />
            New Synced Tab
          </button>

          {/* Navigation Tabs */}
          <div className="flex bg-zinc-950 p-0.5 rounded-md border border-zinc-700/60 ml-2">
            <button
              onClick={() => setActiveTab('channelRack')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold transition ${
                activeTab === 'channelRack'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5" /> Channel Rack
            </button>
            <button
              onClick={() => setActiveTab('pianoRoll')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold transition ${
                activeTab === 'pianoRoll'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Music className="w-3.5 h-3.5" /> Piano Roll
            </button>
            <button
              onClick={() => setActiveTab('mixer')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold transition ${
                activeTab === 'mixer'
                  ? 'bg-zinc-800 text-orange-400 shadow-sm border border-zinc-700/80'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" /> Mixer
            </button>
            <button
              onClick={() => setActiveTab('collab')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold transition ${
                activeTab === 'collab'
                  ? 'bg-orange-500/20 text-orange-400 shadow-sm border border-orange-500/50 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> CRDT Hub
            </button>
          </div>
        </div>
      </div>

      {/* Live Collaborator Activity Ticker Bar */}
      {Object.values(peerActivity).length > 0 && (
        <div className="bg-zinc-900/90 px-3 py-1 border-b border-zinc-800/80 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider flex items-center gap-1">
            <Activity className="w-3 h-3 text-emerald-400 animate-spin" /> Live Cursors:
          </span>
          {Object.values(peerActivity).map((act, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] border shadow-sm"
              style={{
                backgroundColor: `${act.color}22`,
                borderColor: `${act.color}66`,
                color: act.color
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: act.color }} />
              <strong>{act.name}</strong>: {act.action}
            </span>
          ))}
        </div>
      )}

      {/* ==================================================== */}
      {/* 3. MAIN WORKSPACE                                    */}
      {/* ==================================================== */}
      <main className="flex-1 bg-[#131518] overflow-auto relative p-3 flex flex-col justify-start">
        
        {/* VIEW 1: CHANNEL RACK */}
        {activeTab === 'channelRack' && (
          <div className="max-w-6xl w-full mx-auto bg-[#1c2024] rounded-lg border border-zinc-700/70 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-850 border-b border-zinc-700/70">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
                  Channel Rack • Pattern {activePattern}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-zinc-400 font-mono">
                <span>Vector Heads: {crdt.heads[0] || 'clean'}</span>
                <span className="text-zinc-600">|</span>
                <span>CRDT Clock: v{docState._meta?.version || 1}</span>
              </div>
            </div>

            <div className="divide-y divide-zinc-800/80">
              {channels.map((channel) => {
                const currentPatternSteps = stepData[activePattern]?.[channel.id] || new Array(16).fill(0);
                const isSelected = selectedChannelId === channel.id;

                // Find active peers currently editing this channel
                const peersOnThisChannel = Object.values(peerActivity).filter(
                  p => p.channelId === channel.id
                );

                return (
                  <div
                    key={channel.id}
                    onClick={() => setSelectedChannelId(channel.id)}
                    className={`flex items-center px-3 py-1.5 transition-colors relative ${
                      isSelected ? 'bg-zinc-700/25' : 'hover:bg-zinc-800/40'
                    }`}
                  >
                    {/* Left: Controls & Track info */}
                    <div className="flex items-center gap-2 w-72 shrink-0">
                      <div className={`w-1.5 h-6 rounded-full transition-all ${
                        isSelected ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-transparent'
                      }`} />

                      {/* Mute */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          mutateDoc(`Toggle mute on ${channel.name}`, (d) => {
                            const c = d.channels.find(x => x.id === channel.id);
                            if (c) c.muted = !c.muted;
                          });
                        }}
                        className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center border transition ${
                          channel.muted
                            ? 'bg-red-500/80 text-white border-red-400'
                            : 'bg-emerald-600/30 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/60'
                        }`}
                        title="Mute Channel"
                      >
                        M
                      </button>

                      {/* Solo */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          mutateDoc(`Toggle solo on ${channel.name}`, (d) => {
                            const c = d.channels.find(x => x.id === channel.id);
                            if (c) c.solo = !c.solo;
                          });
                        }}
                        className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center border transition ${
                          channel.solo
                            ? 'bg-amber-400 text-zinc-950 border-amber-300 font-black shadow-[0_0_6px_#f59e0b]'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                        }`}
                        title="Solo Channel"
                      >
                        S
                      </button>

                      {/* Pan Slider */}
                      <div className="flex flex-col items-center" title={`Pan: ${channel.pan}`}>
                        <span className="text-[7px] text-zinc-500 font-mono leading-none">PAN</span>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.05"
                          value={channel.pan}
                          onChange={(e) => {
                            e.stopPropagation();
                            const val = parseFloat(e.target.value);
                            mutateDoc(`Pan ${channel.name} to ${val}`, (d) => {
                              const c = d.channels.find(x => x.id === channel.id);
                              if (c) c.pan = val;
                            });
                          }}
                          className="w-10 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-400"
                        />
                      </div>

                      {/* Volume Slider */}
                      <div className="flex flex-col items-center" title={`Vol: ${Math.round(channel.vol * 100)}%`}>
                        <span className="text-[7px] text-zinc-500 font-mono leading-none">VOL</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.02"
                          value={channel.vol}
                          onChange={(e) => {
                            e.stopPropagation();
                            const val = parseFloat(e.target.value);
                            mutateDoc(`Vol ${channel.name} to ${val}`, (d) => {
                              const c = d.channels.find(x => x.id === channel.id);
                              if (c) c.vol = val;
                            });
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
                          emitPresence(`Auditioning ${channel.name}`, channel.id);
                        }}
                        className="flex-1 text-left px-2.5 py-1 rounded bg-[#272b30] hover:bg-[#31363c] border border-zinc-700/80 shadow-sm flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-xs font-semibold text-zinc-200 group-hover:text-orange-400 transition truncate">
                            {channel.name}
                          </span>
                          {peersOnThisChannel.length > 0 && (
                            <span 
                              className="w-2 h-2 rounded-full animate-ping"
                              style={{ backgroundColor: peersOnThisChannel[0].color }}
                              title={`Remote peer editing: ${peersOnThisChannel[0].name}`}
                            />
                          )}
                        </div>
                        <span
                          className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold"
                          style={{ backgroundColor: `${channel.color}33`, color: channel.color }}
                        >
                          Trk {channel.mixerTrack}
                        </span>
                      </button>
                    </div>

                    {/* Right: Step Sequencer Pads with Collaborator Cursor Overlays */}
                    <div className="flex items-center gap-1 pl-4 flex-1 overflow-x-auto">
                      {Array.from({ length: 16 }).map((_, stepIdx) => {
                        const isStepActive = currentPatternSteps[stepIdx] === 1;
                        const isCurrentPlayStep = currentStep === stepIdx && isPlaying;
                        const groupIdx = Math.floor(stepIdx / 4);
                        const isEvenGroup = groupIdx % 2 === 0;

                        // Check if a remote peer is focused on this step
                        const remotePeerOnStep = Object.values(peerActivity).find(
                          p => p.channelId === channel.id && p.step === stepIdx
                        );

                        return (
                          <div key={stepIdx} className="relative flex-1 min-w-[28px] max-w-[44px]">
                            {/* Collaborator Step Cursor Badge */}
                            {remotePeerOnStep && (
                              <div
                                className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 px-1 py-0.2 rounded text-[7px] font-mono font-bold shadow whitespace-nowrap animate-bounce"
                                style={{
                                  backgroundColor: remotePeerOnStep.color,
                                  color: '#000'
                                }}
                              >
                                {remotePeerOnStep.name.split(' ')[0]}
                              </div>
                            )}

                            <button
                              onClick={() => toggleStep(channel.id, stepIdx)}
                              className={`w-full h-9 rounded-[3px] border transition-all duration-75 relative flex items-center justify-center ${
                                isStepActive
                                  ? 'bg-gradient-to-b from-orange-500 to-amber-600 border-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.4)]'
                                  : isEvenGroup
                                  ? 'bg-[#2e3338] hover:bg-[#383e44] border-zinc-700/80'
                                  : 'bg-[#22262a] hover:bg-[#2b3035] border-zinc-800'
                              } ${isCurrentPlayStep ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#1c2024] scale-[1.04]' : ''} ${
                                remotePeerOnStep ? 'ring-2 ring-offset-1' : ''
                              }`}
                              style={{
                                ringColor: remotePeerOnStep ? remotePeerOnStep.color : undefined
                              }}
                            >
                              <div className={`w-3/4 h-1.5 rounded-full ${
                                isStepActive 
                                  ? 'bg-amber-200/90 shadow-[0_0_4px_#fff]' 
                                  : 'bg-black/25'
                              }`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: PIANO ROLL */}
        {activeTab === 'pianoRoll' && (
          <div className="max-w-6xl w-full mx-auto bg-[#1c2024] rounded-lg border border-zinc-700/70 shadow-2xl flex flex-col h-full max-h-[640px]">
            <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-850 border-b border-zinc-700/70">
              <div className="flex items-center gap-3">
                <Music className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
                  Piano Roll • {channels.find(c => c.id === selectedChannelId)?.name || 'Lead Synth'}
                </h2>
                <span className="text-[10px] text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700 font-mono">
                  Sync: Live CRDT Notes
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
                    mutateDoc(`Cleared notes for ${selectedChannelId}`, (d) => {
                      if (!d.pianoNotes[d.activePattern]) d.pianoNotes[d.activePattern] = {};
                      d.pianoNotes[d.activePattern][selectedChannelId] = [];
                    });
                  }}
                  className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-red-900/50 text-zinc-300 hover:text-red-300 rounded border border-zinc-700"
                >
                  Clear Notes
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto flex relative bg-[#15171a]">
              {/* Piano Keyboard Keys */}
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
                        emitPresence(`Auditioned ${note.name}`, selectedChannelId);
                      }}
                      className={`w-full h-6 text-[10px] font-mono flex items-center justify-end pr-2 border-b border-zinc-800 transition active:scale-95 ${
                        isSharp
                          ? 'bg-[#1a1c1e] text-zinc-400 hover:bg-zinc-700'
                          : 'bg-[#e2e6ea] text-zinc-900 font-bold hover:bg-white'
                      }`}
                    >
                      {note.name}
                    </button>
                  );
                })}
              </div>

              {/* 16-Step Grid */}
              <div className="flex-1 grid grid-cols-16 min-w-[640px] relative">
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
                              emitPresence(`Note ${note.name} @ Step ${stepIdx + 1}`, selectedChannelId, stepIdx);

                              mutateDoc(`Note ${note.name} at step ${stepIdx + 1}`, (draft) => {
                                if (!draft.pianoNotes[draft.activePattern]) draft.pianoNotes[draft.activePattern] = {};
                                const chNotes = draft.pianoNotes[draft.activePattern][selectedChannelId] || [];
                                const existingIndex = chNotes.findIndex(n => n.step === stepIdx && n.note === note.name);

                                if (existingIndex >= 0) {
                                  chNotes.splice(existingIndex, 1);
                                } else {
                                  chNotes.push({ step: stepIdx, note: note.name, length: 2 });
                                }
                                draft.pianoNotes[draft.activePattern][selectedChannelId] = chNotes;
                              });

                              const ch = channels.find(c => c.id === selectedChannelId);
                              audio.triggerSynthLead(audio.ctx.currentTime, ch ? ch.mixerTrack : 5, note.freq, 0.8, 0.3);
                            }}
                            className={`h-6 border-b border-r border-zinc-800/80 cursor-pointer relative transition-colors ${
                              isEvenBeat ? 'bg-[#202327]' : 'bg-[#1a1d21]'
                            } hover:bg-zinc-700/40`}
                          >
                            {noteBlock && (
                              <div
                                className="absolute inset-y-0.5 left-0.5 right-0.5 rounded bg-gradient-to-r from-orange-500 to-amber-500 border border-orange-300 flex items-center px-1 text-[9px] font-mono font-bold text-zinc-950 shadow-md overflow-hidden z-10"
                                title={`${noteBlock.note} (Step ${noteBlock.step + 1})`}
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

        {/* VIEW 3: MIXER & DSP FX */}
        {activeTab === 'mixer' && (
          <div className="max-w-6xl w-full mx-auto bg-[#1c2024] rounded-lg border border-zinc-700/70 shadow-2xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-700/80">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-orange-400" />
                <h2 className="text-xs font-mono font-bold tracking-wider text-zinc-200 uppercase">
                  Master & Insert Mixer • Real-Time DSP
                </h2>
              </div>
              <div className="text-[10px] text-zinc-400 font-mono">
                Automerge Synced Insert FX (Filter, Delay, Overdrive)
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {mixerTracks.map((track) => {
                const isMaster = track.id === 0;

                return (
                  <div
                    key={track.id}
                    className={`rounded-lg border p-2.5 flex flex-col items-center gap-2 relative ${
                      isMaster 
                        ? 'bg-[#15171a] border-amber-500/50 shadow-md' 
                        : 'bg-[#202428] border-zinc-700/80'
                    }`}
                  >
                    <div className="w-full text-center pb-1 border-b border-zinc-700/60">
                      <span className={`text-[11px] font-mono font-bold truncate block ${
                        isMaster ? 'text-amber-400' : 'text-zinc-200'
                      }`}>
                        {track.name}
                      </span>
                      <span className="text-[8px] text-zinc-500 font-mono">
                        {isMaster ? 'MASTER' : `IN ${track.id}`}
                      </span>
                    </div>

                    {/* FX Rack */}
                    <div className="w-full space-y-1 bg-zinc-900/60 p-1.5 rounded border border-zinc-800">
                      <div className="flex items-center justify-between text-[8px] font-mono text-zinc-400">
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

                      <div className="flex items-center justify-between text-[8px] font-mono text-zinc-400 pt-0.5">
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

                      <div className="flex items-center justify-between text-[8px] font-mono text-zinc-400 pt-0.5">
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

                    {/* Pan */}
                    <div className="w-full flex items-center justify-between gap-1">
                      <span className="text-[7px] font-mono text-zinc-500">L</span>
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.05"
                        value={track.pan}
                        onChange={(e) => handleMixerParam(track.id, 'pan', parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-700 rounded appearance-none cursor-pointer accent-orange-400"
                      />
                      <span className="text-[7px] font-mono text-zinc-500">R</span>
                    </div>

                    {/* Volume Fader */}
                    <div className="flex items-center justify-center h-32 relative py-1">
                      <input
                        type="range"
                        min="0"
                        max="1.2"
                        step="0.02"
                        value={track.vol}
                        onChange={(e) => handleMixerParam(track.id, 'vol', parseFloat(e.target.value))}
                        className="h-28 -rotate-90 appearance-none bg-zinc-800 rounded-lg cursor-pointer accent-emerald-400 w-28"
                      />
                    </div>

                    {/* Mute/Solo */}
                    <div className="flex items-center gap-1 w-full justify-center">
                      <button
                        onClick={() => handleMixerParam(track.id, 'mute', !track.mute)}
                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold transition ${
                          track.mute
                            ? 'bg-red-500 text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        M
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 4: AUTOMERGE CRDT HUB & COLLABORATION INSPECTOR */}
        {activeTab === 'collab' && (
          <div className="max-w-6xl w-full mx-auto space-y-4">
            {/* Top Info Banner */}
            <div className="bg-gradient-to-r from-orange-950/40 via-zinc-900 to-zinc-900 rounded-lg border border-orange-500/40 p-4 shadow-xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-orange-400" />
                    <h2 className="text-sm font-bold font-mono text-zinc-100 uppercase tracking-wider">
                      Automerge CRDT Multi-User Engine
                    </h2>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                    Conflict-Free Replicated Data Type (CRDT) document architecture with causal Lamport clocks, deterministic 3-way merge resolution, and multi-peer synchronization over BroadcastChannel.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={exportSession}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-mono font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5 text-orange-400" /> Export CRDT JSON
                  </button>

                  <label className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-mono font-medium cursor-pointer transition">
                    <Upload className="w-3.5 h-3.5 text-emerald-400" /> Import JSON
                    <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Status Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800/80">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">Document Actor ID</span>
                  <span className="text-xs font-mono font-bold text-orange-400">{localUser.id}</span>
                </div>
                <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800/80">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">Vector Clock / Version</span>
                  <span className="text-xs font-mono font-bold text-emerald-400">v{docState._meta?.version || 1} (Seq #{crdt.seq})</span>
                </div>
                <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800/80">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">CRDT Heads Hash</span>
                  <span className="text-xs font-mono font-bold text-cyan-400 truncate block">
                    {crdt.heads[0] || 'HEAD-0'}
                  </span>
                </div>
                <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800/80">
                  <span className="text-[10px] font-mono text-zinc-500 block uppercase">Total CRDT Patches</span>
                  <span className="text-xs font-mono font-bold text-amber-400">{syncHistory.length} Recorded</span>
                </div>
              </div>
            </div>

            {/* Split Screen: Connected Producers & Change History */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Collaborators Lobby */}
              <div className="bg-[#1c2024] rounded-lg border border-zinc-700/70 p-3 shadow-lg flex flex-col h-80">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-orange-400" />
                    <h3 className="text-xs font-mono font-bold uppercase text-zinc-200">Active Peers in Session</h3>
                  </div>
                  <span className="text-[10px] font-mono bg-zinc-800 px-2 py-0.5 rounded text-emerald-400">
                    {peers.length + 1} connected
                  </span>
                </div>

                <div className="flex-1 overflow-auto py-2 space-y-2">
                  {/* You */}
                  <div className="flex items-center justify-between p-2 rounded bg-zinc-850/80 border border-zinc-700/60">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black"
                        style={{ backgroundColor: localUser.color }}
                      >
                        {localUser.avatar}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-zinc-200 block">{localUser.name}</span>
                        <span className="text-[9px] font-mono text-zinc-400">Host • {localUser.id}</span>
                      </div>
                    </div>
                    <span className="text-[9px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 px-1.5 py-0.5 rounded">
                      Local Replica
                    </span>
                  </div>

                  {/* Remote / Simulated Peers */}
                  {peers.map((peer) => {
                    const currentAct = peerActivity[peer.id];

                    return (
                      <div
                        key={peer.id}
                        className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black"
                            style={{ backgroundColor: peer.color }}
                          >
                            {peer.avatar || '👤'}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-200 block">{peer.name}</span>
                            <span className="text-[9px] font-mono text-zinc-500">Peer • {peer.id}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          {currentAct ? (
                            <span className="text-[9px] font-mono text-orange-400 block animate-pulse">
                              {currentAct.action}
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-zinc-500 block">Idle</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Quick actions in lobby */}
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-2">
                  <button
                    onClick={openNewReplicaTab}
                    className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-mono font-medium flex items-center justify-center gap-1.5 border border-zinc-700 transition"
                  >
                    <ArrowRightLeft className="w-3 h-3 text-orange-400" /> Open 2nd Tab To Co-Produce
                  </button>
                  <button
                    onClick={() => setSimulatedBotActive(!simulatedBotActive)}
                    className="py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-mono font-medium flex items-center gap-1.5 border border-zinc-700 transition"
                  >
                    <Bot className="w-3 h-3 text-rose-400" /> {simulatedBotActive ? 'Stop Bot' : 'Run Bot'}
                  </button>
                </div>
              </div>

              {/* Right Column: CRDT Commit / Patch Log */}
              <div className="bg-[#1c2024] rounded-lg border border-zinc-700/70 p-3 shadow-lg flex flex-col h-80">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <GitCommit className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-mono font-bold uppercase text-zinc-200">CRDT Commit / Change History</h3>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">Live feed</span>
                </div>

                <div className="flex-1 overflow-auto py-2 space-y-1.5">
                  {syncHistory.map((item, idx) => {
                    const isLocal = item.actorId === localUser.id;
                    const dateStr = new Date(item.time).toLocaleTimeString();

                    return (
                      <div
                        key={item.id || idx}
                        className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 text-[10px] font-mono flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className={`w-1.5 h-1.5 rounded-full ${isLocal ? 'bg-orange-400' : 'bg-emerald-400'}`} />
                          <span className="text-zinc-300 truncate">{item.desc}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-1 rounded text-[8px] ${
                            isLocal ? 'bg-orange-950 text-orange-400' : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {item.actorId.substring(0, 10)}
                          </span>
                          <span className="text-zinc-500 text-[9px]">{dateStr}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================================================== */}
      {/* 4. BOTTOM STATUS BAR                                */}
      {/* ==================================================== */}
      <footer className="px-3 py-1 bg-[#171a1e] border-t border-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            SYNTH ENGINE: ONLINE (44.1 kHz)
          </span>
          <span className="text-zinc-600">|</span>
          <span>CRDT HEAD: {crdt.heads[0] ? crdt.heads[0].slice(0, 16) : 'syncing'}</span>
          <span className="text-zinc-600">|</span>
          <span>BROADCAST CHANNEL: fl_studio_automerge_bus</span>
        </div>
        <div className="text-zinc-500 flex items-center gap-2">
          <span>FL Studio Web DAW • Automerge Edition</span>
        </div>
      </footer>
    </div>
  );
}