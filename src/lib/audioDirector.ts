// ============================================
// Doubt Game - Audio Director
// EO-02: Client-side Audio Engine
// ============================================
// Single AudioContext + Mixer pattern
// Background music with ducking + SFX overlay
// ============================================

export type SFXKey = 'cry' | 'file' | 'report' | 'walks' | 'pistol1' | 'pistol2' | 'pistol3';

export interface AudioCue {
  type: 'duck_and_play' | 'play_only' | 'duck' | 'restore' | 'stop_bg' | 'start_bg';
  file?: SFXKey;
  duckTo?: number;
  restoreTo?: number;
  duckDuration?: number;
  restoreDuration?: number;
}

const SFX_PATHS: Record<SFXKey, string> = {
  cry: '/music/cry.mp3',
  file: '/music/file.mp3',
  report: '/music/report.mp3',
  walks: '/music/walks.mp3',
  pistol1: '/music/Pistol1.mp3',
  pistol2: '/music/Pistol2.mp3',
  pistol3: '/music/Pistol3.mp3',
};

const BG_PATH = '/music/125.mp3';
const DEFAULT_BG_VOLUME = 0.35;
const DEFAULT_DUCK_VOLUME = 0.12;
const DEFAULT_SFX_VOLUME = 0.8;

class AudioDirector {
  private ctx: AudioContext | null = null;
  private bgGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgSource: AudioBufferSourceNode | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private initialized = false;
  private bgPlaying = false;
  private muted = false;
  private bgVolume = DEFAULT_BG_VOLUME;

  /**
   * تهيئة AudioContext - يجب استدعاؤها بعد تفاعل المستخدم
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.ctx = new AudioContext();
      this.bgGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.bgGain.gain.value = this.bgVolume;
      this.sfxGain.gain.value = DEFAULT_SFX_VOLUME;

      this.bgGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);

      this.initialized = true;
      console.log('🎧 AudioDirector initialized');

      // تحميل الموسيقى الخلفية أولاً
      await this.loadBuffer('bg', BG_PATH);

      // تحميل المؤثرات بالتوازي (لا ننتظر)
      this.preloadSFX();
    } catch (err) {
      console.error('🎧 AudioDirector init failed:', err);
    }
  }

  /**
   * تحميل ملف صوتي إلى الذاكرة
   */
  private async loadBuffer(key: string, url: string): Promise<void> {
    if (!this.ctx || this.buffers.has(key)) return;
    try {
      const res = await fetch(url);
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
      this.buffers.set(key, audioBuf);
      console.log(`🎵 Loaded: ${key}`);
    } catch (err) {
      console.error(`🎵 Failed to load ${key}:`, err);
    }
  }

  /**
   * تحميل كل المؤثرات مسبقاً
   */
  private async preloadSFX(): Promise<void> {
    const entries = Object.entries(SFX_PATHS) as [SFXKey, string][];
    await Promise.allSettled(entries.map(([key, url]) => this.loadBuffer(key, url)));
    console.log(`🎧 SFX preloaded: ${this.buffers.size} buffers`);
  }

  /**
   * تشغيل الموسيقى الخلفية (loop)
   */
  playBackground(): void {
    if (!this.ctx || !this.bgGain || this.bgPlaying) return;

    const buffer = this.buffers.get('bg');
    if (!buffer) { console.warn('🎵 BG buffer not loaded'); return; }

    // إيقاف أي مصدر سابق
    this.stopBackground();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.bgGain);
    source.start(0);
    this.bgSource = source;
    this.bgPlaying = true;
    console.log('🎵 Background playing');
  }

  /**
   * إيقاف الموسيقى الخلفية
   */
  stopBackground(): void {
    if (this.bgSource) {
      try { this.bgSource.stop(); } catch { /* already stopped */ }
      this.bgSource = null;
    }
    this.bgPlaying = false;
  }

  /**
   * تشغيل مؤثر صوتي
   */
  playSFX(key: SFXKey): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;

    const buffer = this.buffers.get(key);
    if (!buffer) { console.warn(`🎵 SFX not loaded: ${key}`); return; }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain);
    source.start(0);
    console.log(`🔊 SFX: ${key}`);
  }

  /**
   * خفض صوت الخلفية تدريجياً (Ducking)
   */
  duck(to: number = DEFAULT_DUCK_VOLUME, duration: number = 0.3): void {
    if (!this.ctx || !this.bgGain || this.muted) return;
    this.bgGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, this.ctx.currentTime);
    this.bgGain.gain.linearRampToValueAtTime(to, this.ctx.currentTime + duration);
  }

  /**
   * استعادة صوت الخلفية تدريجياً
   */
  restore(to: number = DEFAULT_BG_VOLUME, duration: number = 1.5): void {
    if (!this.ctx || !this.bgGain || this.muted) return;
    this.bgGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, this.ctx.currentTime);
    this.bgGain.gain.linearRampToValueAtTime(to, this.ctx.currentTime + duration);
  }

  /**
   * Duck + Play SFX + Auto Restore
   */
  duckAndPlay(key: SFXKey, duckTo?: number, restoreAfterMs: number = 2000): void {
    this.duck(duckTo);
    this.playSFX(key);
    setTimeout(() => this.restore(), restoreAfterMs);
  }

  /**
   * تنفيذ Audio Cue من السيرفر
   */
  executeCue(cue: AudioCue): void {
    switch (cue.type) {
      case 'duck_and_play':
        if (cue.file) this.duckAndPlay(cue.file, cue.duckTo);
        break;
      case 'play_only':
        if (cue.file) this.playSFX(cue.file);
        break;
      case 'duck':
        this.duck(cue.duckTo, cue.duckDuration);
        break;
      case 'restore':
        this.restore(cue.restoreTo, cue.restoreDuration);
        break;
      case 'stop_bg':
        this.stopBackground();
        break;
      case 'start_bg':
        this.playBackground();
        break;
    }
  }

  /**
   * Mute / Unmute
   */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.bgGain && this.ctx) {
      this.bgGain.gain.setValueAtTime(this.muted ? 0 : this.bgVolume, this.ctx.currentTime);
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.muted ? 0 : DEFAULT_SFX_VOLUME, this.ctx.currentTime);
    }
    return this.muted;
  }

  isMuted(): boolean { return this.muted; }
  isReady(): boolean { return this.initialized; }
  isPlaying(): boolean { return this.bgPlaying; }

  /**
   * Resume AudioContext if suspended (autoplay policy)
   */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }
}

// Singleton - AudioContext واحد فقط في التطبيق كله
export const audioDirector = new AudioDirector();
