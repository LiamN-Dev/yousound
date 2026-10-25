/**
 * Playback engine
 *
 * YouSong songs can be played two ways:
 *   1. A normal audio file / stream URL        -> HTMLAudioElement
 *   2. A YouTube video  (audioUrl = "youtube:VIDEO_ID")
 *                                              -> the official YouTube IFrame Player
 *
 * PlaybackRouter exposes the same small surface the app already uses on an
 * <audio> element (src, currentTime, duration, play, pause, volume, muted,
 * playbackRate, addEventListener) so AudioContext barely changes.
 *
 * The YouTube player is shown on screen (a small floating video box). That is
 * required by YouTube's embed rules, which do not allow hiding the video to
 * play audio only.
 */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_SRC_PATTERN = /^youtube:([A-Za-z0-9_-]{11})$/;

export function youtubeIdFromSrc(src: string | undefined | null): string | null {
  if (!src) return null;
  const m = src.trim().match(YT_SRC_PATTERN);
  return m ? m[1] : null;
}

let apiPromise: Promise<any> | null = null;

function loadYouTubeApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { previous?.(); } catch (_) {}
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => {
      apiPromise = null;
      reject(new Error('The YouTube player could not be loaded.'));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}

type Handler = () => void;

function errorMessageForCode(code: number | null): string {
  switch (code) {
    case 101:
    case 150:
      return 'The owner of this video does not allow it to be played on other sites.';
    case 100:
      return 'This video was removed or is private.';
    case 2:
      return 'This YouTube link is invalid.';
    case 5:
      return 'YouTube could not play this video in the embedded player.';
    default:
      return 'The YouTube player could not load this video.';
  }
}

class YouTubeEngine {
  private wrapper: HTMLDivElement;
  private iframe: HTMLIFrameElement | null = null;
  private player: any = null;
  private readyPromise: Promise<void> | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private pollTimer: number | null = null;

  private videoId: string | null = null;
  private needsLoad = false;
  private durationSec = 0;

  playing = false;
  errorCode: number | null = null;

  private volume = 0.85;
  private muted = false;
  private rate = 1;

  constructor() {
    this.wrapper = document.createElement('div');
    this.wrapper.setAttribute('data-yousong-youtube', 'true');
    Object.assign(this.wrapper.style, {
      position: 'fixed',
      right: '16px',
      bottom: '120px',
      width: 'min(356px, calc(100vw - 32px))',
      height: '200px',
      zIndex: '45',
      display: 'none',
      borderRadius: '16px',
      overflow: 'hidden',
      background: '#000',
      boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
      border: '1px solid rgba(255,255,255,0.12)',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.wrapper);
  }

  on(type: string, fn: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }

  private emit(type: string) {
    this.handlers.get(type)?.forEach((fn) => {
      try { fn(); } catch (e) { console.warn('YouTube handler error', e); }
    });
  }

  get errorMessage(): string {
    return errorMessageForCode(this.errorCode);
  }

  get currentVideoId(): string | null {
    return this.videoId;
  }

  setSettings(volume: number, muted: boolean, rate: number) {
    this.volume = volume;
    this.muted = muted;
    this.rate = rate;
    this.applySettings();
  }

  private applySettings() {
    if (!this.player || !this.player.setVolume) return;
    try {
      this.player.setVolume(Math.round(this.volume * 100));
      if (this.muted) this.player.mute(); else this.player.unMute();
      // YouTube's player supports speeds up to 2x
      this.player.setPlaybackRate(Math.min(2, Math.max(0.25, this.rate)));
    } catch (_) {}
  }

  /** Point the engine at a video. Playback starts when play() is called. */
  load(videoId: string) {
    this.videoId = videoId;
    this.durationSec = 0;
    this.errorCode = null;
    this.playing = false;
    this.needsLoad = this.iframe !== null; // later videos use loadVideoById
    this.wrapper.style.display = 'block';
  }

  private ensurePlayer(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    const firstId = this.videoId;
    if (!firstId) return Promise.reject(new Error('No video selected'));

    this.readyPromise = loadYouTubeApi().then(
      (YT) =>
        new Promise<void>((resolve, reject) => {
          const iframe = document.createElement('iframe');
          const origin = encodeURIComponent(window.location.origin);
          iframe.src =
            `https://www.youtube.com/embed/${firstId}` +
            `?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=${origin}`;
          iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
          iframe.setAttribute('allowfullscreen', 'true');
          iframe.setAttribute('title', 'YouTube video player');
          iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
          this.wrapper.appendChild(iframe);
          this.iframe = iframe;
          this.needsLoad = false; // the first video is already in the iframe URL

          this.player = new YT.Player(iframe, {
            events: {
              onReady: () => {
                this.applySettings();
                resolve();
              },
              onStateChange: (e: any) => this.onState(e.data),
              onError: (e: any) => {
                this.errorCode = typeof e.data === 'number' ? e.data : null;
                this.playing = false;
                this.emit('statechange');
                this.emit('error');
              },
            },
          });
          window.setTimeout(() => reject(new Error('YouTube player timed out')), 15000);
        })
    );

    this.readyPromise.catch(() => {
      // allow a retry on the next play()
      this.readyPromise = null;
    });
    return this.readyPromise;
  }

  private onState(state: number) {
    // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (state === 1) {
      this.playing = true;
      const d = this.safe(() => this.player.getDuration(), 0);
      if (d > 0 && d !== this.durationSec) {
        this.durationSec = d;
        this.emit('loadedmetadata');
      }
      this.startPolling();
      this.emit('statechange');
    } else if (state === 2) {
      this.playing = false;
      this.emit('statechange');
    } else if (state === 0) {
      this.playing = false;
      this.stopPolling();
      this.emit('statechange');
      this.emit('ended');
    }
  }

  private safe<T>(fn: () => T, fallback: T): T {
    try {
      const v = fn();
      return v === undefined || v === null || (typeof v === 'number' && isNaN(v)) ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  private startPolling() {
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(() => {
      if (this.durationSec <= 0) {
        const d = this.safe(() => this.player.getDuration(), 0);
        if (d > 0) {
          this.durationSec = d;
          this.emit('loadedmetadata');
        }
      }
      this.emit('timeupdate');
    }, 250);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async play(): Promise<void> {
    await this.ensurePlayer();
    if (!this.videoId) return;
    this.applySettings();
    if (this.needsLoad) {
      this.needsLoad = false;
      this.player.loadVideoById(this.videoId);
    } else {
      this.player.playVideo();
    }
  }

  pause() {
    if (this.player?.pauseVideo) {
      try { this.player.pauseVideo(); } catch (_) {}
    }
  }

  stop() {
    this.stopPolling();
    this.playing = false;
    this.videoId = null;
    try { this.player?.stopVideo?.(); } catch (_) {}
    this.wrapper.style.display = 'none';
  }

  get currentTime(): number {
    return this.player ? this.safe(() => this.player.getCurrentTime(), 0) : 0;
  }

  set currentTime(seconds: number) {
    if (this.player?.seekTo) {
      try { this.player.seekTo(seconds, true); } catch (_) {}
    }
  }

  get duration(): number {
    return this.durationSec > 0 ? this.durationSec : NaN;
  }

  destroy() {
    this.stopPolling();
    try { this.player?.destroy?.(); } catch (_) {}
    this.wrapper.remove();
    this.player = null;
    this.iframe = null;
    this.readyPromise = null;
  }
}

export class PlaybackRouter {
  private native: HTMLAudioElement;
  private yt: YouTubeEngine | null = null;
  private mode: 'native' | 'youtube' = 'native';
  private listeners = new Map<string, Set<Handler>>();

  private _volume = 0.85;
  private _muted = false;
  private _rate = 1;

  /** Human-readable reason for the last playback error (YouTube only). */
  lastError: string | null = null;

  constructor() {
    this.native = new Audio();
    this.native.preload = 'metadata';
    (['timeupdate', 'loadedmetadata', 'ended', 'error'] as const).forEach((type) => {
      this.native.addEventListener(type, () => {
        if (this.mode !== 'native') return;
        if (type === 'error') this.lastError = null;
        this.emit(type);
      });
    });
  }

  private getYt(): YouTubeEngine {
    if (!this.yt) {
      const engine = new YouTubeEngine();
      (['timeupdate', 'loadedmetadata', 'ended', 'error', 'statechange'] as const).forEach((type) => {
        engine.on(type, () => {
          if (this.mode !== 'youtube') return;
          if (type === 'error') this.lastError = engine.errorMessage;
          this.emit(type);
        });
      });
      this.yt = engine;
    }
    return this.yt;
  }

  private emit(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }

  addEventListener(type: string, fn: Handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: Handler) {
    this.listeners.get(type)?.delete(fn);
  }

  get isYouTube(): boolean {
    return this.mode === 'youtube';
  }

  /** Only meaningful for YouTube: whether the video is actually playing. */
  get isPlaying(): boolean {
    return this.mode === 'youtube' ? !!this.yt?.playing : !this.native.paused;
  }

  get src(): string {
    if (this.mode === 'youtube') return `youtube:${this.yt?.currentVideoId ?? ''}`;
    return this.native.src;
  }

  set src(url: string) {
    this.lastError = null;
    const id = youtubeIdFromSrc(url);
    if (id) {
      this.mode = 'youtube';
      this.native.pause();
      this.native.removeAttribute('src');
      this.native.load();
      const engine = this.getYt();
      engine.setSettings(this._volume, this._muted, this._rate);
      engine.load(id);
    } else {
      if (this.mode === 'youtube') this.yt?.stop();
      this.mode = 'native';
      this.native.src = url;
    }
  }

  get currentTime(): number {
    return this.mode === 'youtube' ? this.yt?.currentTime ?? 0 : this.native.currentTime;
  }

  set currentTime(seconds: number) {
    if (this.mode === 'youtube') {
      if (this.yt) this.yt.currentTime = seconds;
    } else {
      this.native.currentTime = seconds;
    }
  }

  get duration(): number {
    return this.mode === 'youtube' ? this.yt?.duration ?? NaN : this.native.duration;
  }

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = v;
    this.native.volume = v;
    this.yt?.setSettings(this._volume, this._muted, this._rate);
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    this.native.muted = m;
    this.yt?.setSettings(this._volume, this._muted, this._rate);
  }

  get playbackRate(): number {
    return this._rate;
  }

  set playbackRate(r: number) {
    this._rate = r;
    this.native.playbackRate = r;
    this.yt?.setSettings(this._volume, this._muted, this._rate);
  }

  play(): Promise<void> {
    if (this.mode === 'youtube') {
      return this.getYt().play().catch((err) => {
        this.lastError = 'The YouTube player could not start.';
        this.emit('error');
        throw err;
      });
    }
    return this.native.play();
  }

  pause() {
    if (this.mode === 'youtube') this.yt?.pause();
    else this.native.pause();
  }

  destroy() {
    this.native.pause();
    this.yt?.destroy();
    this.yt = null;
  }
}
