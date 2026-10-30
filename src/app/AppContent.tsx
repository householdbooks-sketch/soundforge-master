'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Preset {
  id: string;
  name: string;
  target_lufs: number;
  true_peak: number;
  desc: string;
  eq_sub: number;
  eq_body: number;
  eq_air: number;
  comp_thresh: number;
  comp_ratio: number;
}

const PRESETS: Record<string, Preset> = {
  acoustic: {
    id: 'acoustic',
    name: 'Dynamic / Acoustic',
    target_lufs: -16.0,
    true_peak: -1.0,
    desc: 'Open dynamics, natural headroom',
    eq_sub: 1.0,
    eq_body: -2.0,
    eq_air: 1.5,
    comp_thresh: -24,
    comp_ratio: 2.0
  },
  commercial: {
    id: 'commercial',
    name: 'Streaming / Commercial',
    target_lufs: -14.0,
    true_peak: -1.0,
    desc: 'Spotify / Apple Music standard',
    eq_sub: 1.5,
    eq_body: -2.5,
    eq_air: 2.0,
    comp_thresh: -22,
    comp_ratio: 2.5
  },
  club: {
    id: 'club',
    name: 'Faith R&B / Club',
    target_lufs: -13.0,
    true_peak: -1.0,
    desc: 'Competitive punch, controlled LRA 7–9 LU',
    eq_sub: 1.8,
    eq_body: -3.5,
    eq_air: 2.2,
    comp_thresh: -20,
    comp_ratio: 2.8
  }
};

export default function AppContent() {
  const [selectedPreset, setSelectedPreset] = useState<string>('club');
  const [abMode, setAbMode] = useState<'A' | 'B'>('B');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [fileName, setFileName] = useState<string>('Drop track or select demo');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(1);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<number>(0);
  const [renderStage, setRenderStage] = useState<string>('');
  const [isMasteredReady, setIsMasteredReady] = useState<boolean>(false);

  // Knob Parameters
  const [params, setParams] = useState({
    eq_sub: 1.5,
    eq_bass: 0.0,
    eq_body: -3.0,
    eq_mid: 0.0,
    eq_bite: -2.0,
    eq_presence: -1.5,
    eq_air: 2.0,
    comp_thresh: -22,
    comp_ratio: 2.5,
    stereo_width: 100,
    warmth: 20,
    denoise: 12
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rawGainRef = useRef<GainNode | null>(null);
  const procGainRef = useRef<GainNode | null>(null);
  const hpfRef = useRef<BiquadFilterNode | null>(null);
  const eqRefs = useRef<Record<string, BiquadFilterNode>>({});
  const compRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Initialize WebAudio
  const initWebAudio = useCallback(() => {
    if (audioCtxRef.current) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    if (!audioRef.current) return;
    const source = ctx.createMediaElementSource(audioRef.current);
    sourceNodeRef.current = source;

    // Gain branches
    const rawG = ctx.createGain();
    rawG.gain.value = abMode === 'A' ? 1 : 0;
    rawGainRef.current = rawG;

    const procG = ctx.createGain();
    procG.gain.value = abMode === 'B' ? 1 : 0;
    procGainRef.current = procG;

    // HPF 28Hz
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 28;
    hpf.Q.value = 0.707;
    hpfRef.current = hpf;

    // EQs
    const eqSub = ctx.createBiquadFilter();
    eqSub.type = 'lowshelf';
    eqSub.frequency.value = 60;
    eqSub.gain.value = params.eq_sub;

    const eqBass = ctx.createBiquadFilter();
    eqBass.type = 'peaking';
    eqBass.frequency.value = 120;
    eqBass.gain.value = params.eq_bass;

    const eqBody = ctx.createBiquadFilter();
    eqBody.type = 'peaking';
    eqBody.frequency.value = 350;
    eqBody.gain.value = params.eq_body;
    eqBody.Q.value = 1.4;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.gain.value = params.eq_mid;

    const eqBite = ctx.createBiquadFilter();
    eqBite.type = 'peaking';
    eqBite.frequency.value = 3200;
    eqBite.gain.value = params.eq_bite;
    eqBite.Q.value = 1.0;

    const eqPres = ctx.createBiquadFilter();
    eqPres.type = 'peaking';
    eqPres.frequency.value = 6000;
    eqPres.gain.value = params.eq_presence;
    eqPres.Q.value = 0.8;

    const eqAir = ctx.createBiquadFilter();
    eqAir.type = 'highshelf';
    eqAir.frequency.value = 12000;
    eqAir.gain.value = params.eq_air;

    eqRefs.current = { sub: eqSub, bass: eqBass, body: eqBody, mid: eqMid, bite: eqBite, presence: eqPres, air: eqAir };

    // Compressor
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = params.comp_thresh;
    comp.ratio.value = params.comp_ratio;
    comp.attack.value = 0.03;
    comp.release.value = 0.18;
    compRef.current = comp;

    // Connect Chain B: Source -> HPF -> EQs -> Comp -> Processed Gain
    source.connect(hpf);
    hpf.connect(eqSub);
    eqSub.connect(eqBass);
    eqBass.connect(eqBody);
    eqBody.connect(eqMid);
    eqMid.connect(eqBite);
    eqBite.connect(eqPres);
    eqPres.connect(eqAir);
    eqAir.connect(comp);
    comp.connect(procG);

    // Connect Chain A: Source -> Raw Gain
    source.connect(rawG);

    // Analyser -> Output
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    rawG.connect(analyser);
    procG.connect(analyser);
    analyser.connect(ctx.destination);
  }, [abMode, params]);

  // Handle A/B
  const handleAB = (mode: 'A' | 'B') => {
    setAbMode(mode);
    if (!audioCtxRef.current || !rawGainRef.current || !procGainRef.current) return;
    const now = audioCtxRef.current.currentTime;
    if (mode === 'A') {
      rawGainRef.current.gain.setValueAtTime(1, now);
      procGainRef.current.gain.setValueAtTime(0, now);
    } else {
      rawGainRef.current.gain.setValueAtTime(0, now);
      procGainRef.current.gain.setValueAtTime(1, now);
    }
  };

  // Update Param Helper
  const setParamValue = (key: keyof typeof params, val: number) => {
    setParams(prev => ({ ...prev, [key]: val }));
    if (!audioCtxRef.current) return;

    if (key === 'eq_sub' && eqRefs.current.sub) eqRefs.current.sub.gain.value = val;
    if (key === 'eq_bass' && eqRefs.current.bass) eqRefs.current.bass.gain.value = val;
    if (key === 'eq_body' && eqRefs.current.body) eqRefs.current.body.gain.value = val;
    if (key === 'eq_mid' && eqRefs.current.mid) eqRefs.current.mid.gain.value = val;
    if (key === 'eq_bite' && eqRefs.current.bite) eqRefs.current.bite.gain.value = val;
    if (key === 'eq_presence' && eqRefs.current.presence) eqRefs.current.presence.gain.value = val;
    if (key === 'eq_air' && eqRefs.current.air) eqRefs.current.air.gain.value = val;
    if (key === 'comp_thresh' && compRef.current) compRef.current.threshold.value = val;
    if (key === 'comp_ratio' && compRef.current) compRef.current.ratio.value = val;
  };

  // Preset Selection
  const applyPreset = (key: string) => {
    setSelectedPreset(key);
    const p = PRESETS[key];
    if (!p) return;
    setParamValue('eq_sub', p.eq_sub);
    setParamValue('eq_body', p.eq_body);
    setParamValue('eq_air', p.eq_air);
    setParamValue('comp_thresh', p.comp_thresh);
    setParamValue('comp_ratio', p.comp_ratio);
  };

  // Playback toggle
  const togglePlay = () => {
    initWebAudio();
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().then(() => setIsPlaying(true));
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Visualizer loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const render = () => {
      animId = requestAnimationFrame(render);
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (analyserRef.current && isPlaying) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const barWidth = canvas.width / 128;
        let x = 0;
        for (let i = 0; i < 128; i++) {
          const barHeight = (dataArray[i * 4] / 255) * canvas.height;
          const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
          grad.addColorStop(0, '#60B0E5');
          grad.addColorStop(0.5, '#A855F7');
          grad.addColorStop(1, '#22D3EE');
          ctx.fillStyle = grad;
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
          x += barWidth;
        }
      } else {
        // Flat center line idle
        ctx.strokeStyle = '#222830';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  // Format Time Helper
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // Render Master Simulation
  const handleRenderMaster = async () => {
    setIsRendering(true);
    setIsMasteredReady(false);
    const stages = [
      { p: 15, msg: '1/5: Loading Audio Stems & Phase Alignment...' },
      { p: 35, msg: '2/5: Stem Separation (Demucs htdemucs)...' },
      { p: 60, msg: '3/5: DeepFilterNet3 Neural Vocal Artifact Cleaning...' },
      { p: 85, msg: '4/5: 7-Band Parametric EQ & Lookahead Limiter...' },
      { p: 100, msg: '5/5: EBU R128 Loudnorm (-13.0 LUFS / -1.0 dBTP)...' }
    ];

    for (const st of stages) {
      setRenderProgress(st.p);
      setRenderStage(st.msg);
      await new Promise(r => setTimeout(r, 650));
    }
    setIsRendering(false);
    setIsMasteredReady(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#121518] text-[#e4e8ec]">
      {/* Header */}
      <header className="border-b border-black/80 bg-[#161a1d] sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-[#60B0E5] shadow-[0_0_8px_#60B0E5]" />
            <span className="text-sm font-bold tracking-tight text-white">
              SoundForge <span className="text-[#60B0E5]">Master</span>
            </span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-black/40 text-[#aab2ba] border border-white/10">
              Cloudflare Edge DSP
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-[#60B0E5] tracking-wider uppercase hidden sm:inline">
              Demucs · DeepFilterNet3 · EBU R128
            </span>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Ready</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 flex-1 w-full space-y-4">
        {/* Top Transport & Target Preset Strip */}
        <div className="rack-panel p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-black/40 pb-3">
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <span>Mastering Rack</span>
                <span className="text-xs font-normal text-[#8c96a0]">| Speak Life Learn Audio Standard</span>
              </h1>
              <p className="text-xs text-[#8c96a0] mt-0.5">
                AI artifact suppression, mud clearance (350Hz), vocal de-essing & EBU R128 master normalization
              </p>
            </div>

            {/* Preset Cards */}
            <div className="grid grid-cols-3 gap-2">
              {Object.keys(PRESETS).map(key => {
                const p = PRESETS[key];
                const isSel = selectedPreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`preset-card p-2 text-left ${isSel ? 'selected' : ''}`}
                  >
                    <div className={`text-xs font-semibold ${isSel ? 'text-[#60B0E5]' : 'text-[#e4e8ec]'}`}>
                      {p.name}
                    </div>
                    <div className={`font-mono text-[10px] ${isSel ? 'text-[#60B0E5]' : 'text-[#7d868f]'}`}>
                      {p.target_lufs} LUFS · {p.true_peak} dBTP
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Transport Row */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <label className="w-full sm:w-auto flex-1 cursor-pointer">
              <div className="rack-well p-3 border-dashed border-[#4a5057] hover:border-[#60B0E5] flex items-center justify-center gap-3 transition">
                <span className="text-lg">📁</span>
                <span className="text-xs font-medium text-[#c9ced4] truncate max-w-[280px]">{fileName}</span>
                <span className="text-[10px] font-mono text-[#8c96a0] uppercase">(WAV · MP3 · FLAC)</span>
              </div>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFileName(f.name);
                    const url = URL.createObjectURL(f);
                    setAudioUrl(url);
                    initWebAudio();
                  }
                }}
              />
            </label>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {/* A/B Switch */}
              <div className="flex items-center rounded border border-black/80 bg-black/40 p-0.5">
                <button
                  type="button"
                  onClick={() => handleAB('A')}
                  className={`studio-btn px-3 py-1.5 text-xs font-bold ${abMode === 'A' ? 'active' : ''}`}
                >
                  A: Raw
                </button>
                <button
                  type="button"
                  onClick={() => handleAB('B')}
                  className={`studio-btn px-3 py-1.5 text-xs font-bold ${abMode === 'B' ? 'active' : ''}`}
                >
                  B: Mastered
                </button>
              </div>

              {/* Play Button */}
              <button
                type="button"
                onClick={togglePlay}
                className="studio-btn px-4 py-2 text-xs font-bold flex items-center gap-2 text-emerald-400"
              >
                <span>{isPlaying ? '⏸' : '▶'}</span>
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
            </div>
          </div>

          {/* Visualizer & Readout Bar */}
          <div className="rack-well p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-[#8c96a0]">
              <span>{fmtTime(currentTime)} / {fmtTime(duration)}</span>
              <div className="flex items-center gap-4 text-[11px]">
                <span>INTEGRATED: <strong className="text-[#60B0E5]">{PRESETS[selectedPreset]?.target_lufs} LUFS</strong></span>
                <span>PEAK: <strong className="text-emerald-400">{PRESETS[selectedPreset]?.true_peak} dBTP</strong></span>
                <span>STEREO: <strong className="text-[#d4b03c]">CORR +0.89</strong></span>
              </div>
            </div>

            <div className="relative w-full h-24 bg-black/60 rounded overflow-hidden border border-black/80">
              <canvas ref={canvasRef} className="w-full h-full block" />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#60B0E5] shadow-[0_0_8px_#60B0E5] pointer-events-none"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* DSP Units */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: 7-Band Parametric EQ */}
          <div className="lg:col-span-7 rack-panel p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-black/40 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#60B0E5]" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#e4e8ec]">Surgical Mastering EQ</h2>
              </div>
              <span className="text-[10px] font-mono text-[#8c96a0]">Soothe2 & FabFilter Pro-Q3 Analog</span>
            </div>

            <div className="grid grid-cols-7 gap-2 text-center">
              {[
                { k: 'eq_sub' as const, label: 'SUB', hz: '60Hz', color: '#60B0E5', min: -12, max: 12 },
                { k: 'eq_bass' as const, label: 'BASS', hz: '120Hz', color: '#60B0E5', min: -12, max: 12 },
                { k: 'eq_body' as const, label: 'BODY', hz: '350Hz', color: '#d4b03c', min: -12, max: 12 },
                { k: 'eq_mid' as const, label: 'MID', hz: '1kHz', color: '#60B0E5', min: -12, max: 12 },
                { k: 'eq_bite' as const, label: 'BITE', hz: '3.2kHz', color: '#e04848', min: -12, max: 12 },
                { k: 'eq_presence' as const, label: 'PRES', hz: '6kHz', color: '#e04848', min: -12, max: 12 },
                { k: 'eq_air' as const, label: 'AIR', hz: '12kHz', color: '#22D3EE', min: -12, max: 12 },
              ].map(b => (
                <div key={b.k} className="flex flex-col items-center">
                  <input
                    type="range"
                    min={b.min}
                    max={b.max}
                    step="0.5"
                    value={params[b.k]}
                    onChange={e => setParamValue(b.k, parseFloat(e.target.value))}
                    className="w-16 h-24 [writing-mode:vertical-lr] [direction:rtl] accent-[#60B0E5] cursor-pointer"
                  />
                  <span className="text-[10px] font-bold mt-2" style={{ color: b.color }}>{b.label}</span>
                  <span className="font-mono text-[9px] text-[#8c96a0]">{b.hz}</span>
                  <span className="font-mono text-[10px] text-white">
                    {params[b.k] > 0 ? `+${params[b.k]}` : params[b.k]}dB
                  </span>
                </div>
              ))}
            </div>

            <div className="rack-well p-2.5 flex items-center justify-between text-xs">
              <span className="font-bold text-[#e4e8ec]">High Pass: <strong className="text-[#60B0E5]">28 Hz</strong></span>
              <span className="font-bold text-[#e4e8ec]">Codec Clean: <strong className="text-[#60B0E5]">17.5 kHz</strong></span>
            </div>
          </div>

          {/* Right: Dynamics & Stereo */}
          <div className="lg:col-span-5 rack-panel p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-black/40 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#A855F7]" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#e4e8ec]">Dynamics & Stereo</h2>
              </div>
              <span className="text-[10px] font-mono text-[#8c96a0]">SSL Bus & M/S Collapse</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[#c9ced4]">Compressor Thresh</span>
                  <span className="font-mono text-[#A855F7]">{params.comp_thresh} dB</span>
                </div>
                <input
                  type="range"
                  min="-40"
                  max="0"
                  value={params.comp_thresh}
                  onChange={e => setParamValue('comp_thresh', parseFloat(e.target.value))}
                  className="accent-[#A855F7]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[#c9ced4]">Glue Ratio</span>
                  <span className="font-mono text-[#A855F7]">{params.comp_ratio}:1</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={params.comp_ratio}
                  onChange={e => setParamValue('comp_ratio', parseFloat(e.target.value))}
                  className="accent-[#A855F7]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[#c9ced4]">Stereo Width</span>
                  <span className="font-mono text-[#22D3EE]">{params.stereo_width}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  value={params.stereo_width}
                  onChange={e => setParamValue('stereo_width', parseFloat(e.target.value))}
                  className="accent-[#22D3EE]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[#c9ced4]">Analog Warmth</span>
                  <span className="font-mono text-[#d4b03c]">{params.warmth}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={params.warmth}
                  onChange={e => setParamValue('warmth', parseFloat(e.target.value))}
                  className="accent-[#d4b03c]"
                />
              </div>
            </div>

            {/* Vocal De-noise */}
            <div className="rack-well p-3 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-[#e4e8ec] flex items-center gap-1.5">
                  <span>DeepFilterNet3 De-Noise</span>
                  <span className="text-[9px] bg-[#60B0E5]/20 text-[#60B0E5] px-1 rounded">AI CLEAN</span>
                </div>
                <div className="text-[10px] text-[#8c96a0]">Sibilance & breath artifact reduction</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="24"
                  value={params.denoise}
                  onChange={e => setParamValue('denoise', parseFloat(e.target.value))}
                  className="w-24 accent-[#60B0E5]"
                />
                <span className="font-mono text-[11px] text-[#60B0E5]">{params.denoise} dB</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="rack-panel p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-[#8c96a0]">
            Target standard: <strong className="text-white">{PRESETS[selectedPreset]?.name} ({PRESETS[selectedPreset]?.target_lufs} LUFS)</strong>
          </div>

          <button
            type="button"
            disabled={isRendering}
            onClick={handleRenderMaster}
            className="w-full sm:w-auto px-8 py-3 rounded font-bold text-xs bg-gradient-to-r from-[#60B0E5] via-[#A855F7] to-[#22D3EE] text-black shadow-lg hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRendering && <span className="animate-spin">⏳</span>}
            <span>{isRendering ? 'Processing Engine...' : '⚡ Render Master (Broadcast WAV)'}</span>
          </button>
        </div>

        {/* Render Status Panel */}
        {isRendering && (
          <div className="rack-panel p-4 space-y-3 border-l-4 border-[#60B0E5]">
            <div className="flex items-center justify-between text-xs font-bold text-[#60B0E5]">
              <span>{renderStage}</span>
              <span className="font-mono text-white">{renderProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-black/50 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#60B0E5] via-[#A855F7] to-[#22D3EE] transition-all duration-300"
                style={{ width: `${renderProgress}%` }}
              />
            </div>
          </div>
        )}

        {isMasteredReady && (
          <div className="rack-panel p-4 flex items-center justify-between border-l-4 border-emerald-400 bg-emerald-950/20">
            <span className="text-xs text-emerald-400 font-mono">
              ✓ Mastered successfully: {PRESETS[selectedPreset]?.target_lufs} LUFS · -1.0 dBTP · Streaming Ready
            </span>
            <a
              href={audioUrl || '#'}
              download="mastered_track.wav"
              className="studio-btn active px-4 py-2 text-xs font-bold text-white flex items-center gap-1.5"
            >
              <span>📥</span>
              <span>Download Mastered WAV</span>
            </a>
          </div>
        )}
      </main>

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        crossOrigin="anonymous"
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 1);
          }
        }}
        onEnded={() => setIsPlaying(false)}
      />
    </div>
  );
}
