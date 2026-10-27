import React, { useState, useRef, useEffect } from 'react';
import { useAudio } from '../context/AudioContext';
import { YouTubeTestPlayer } from './YouTubeTestPlayer';
import { useAuth } from '../context/AuthContext';
import { SongRequest } from '../types';
import { connectGoogleDrive, getDriveAccessToken } from '../lib/firebase';
import {
  ShieldCheck,
  Play,
  Pause,
  Upload,
  CheckCircle2,
  Clock,
  Radio,
  ExternalLink,
  Volume2,
  VolumeX,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Edit3,
  Save,
  Check,
  X,
  HardDrive,
  Headphones,
  Eye,
  Layers,
  ArrowRight,
  Sliders,
} from 'lucide-react';

export const AdminPipelineManager: React.FC = () => {
  const {
    songRequests,
    adminUpdateRequest,
    adminApproveAndProcess,
    adminPublishRequest,
    deleteSongRequest,
    updateSongRequestStatus,
  } = useAuth();

  const [activePipelineTab, setActivePipelineTab] = useState<'holding' | 'processing' | 'staging' | 'published'>('holding');
  
  // Google Drive Connection State
  const [googleDriveConnected, setGoogleDriveConnected] = useState<boolean>(!!getDriveAccessToken());
  const [googleAccountEmail, setGoogleAccountEmail] = useState<string | null>(null);
  const [isConnectingDrive, setIsConnectingDrive] = useState<boolean>(false);

  // In-line editing state for pending holding queue items (songTitle, artist, coverUrl, genre)
  const [editingMetadata, setEditingMetadata] = useState<Record<string, {
    songTitle: string;
    artist: string;
    coverUrl: string;
    genre: string;
    notes?: string;
  }>>({});

  const [isSavingEdit, setIsSavingEdit] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Test Stream Audio Player State
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.85);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { playSong, isPlaying: mainPlayerPlaying, togglePlay } = useAudio();
  // Which staged request currently has its inline video preview open
  const [testPlayerFor, setTestPlayerFor] = useState<string | null>(null);
  const [hideVideoFor, setHideVideoFor] = useState<Record<string, boolean>>({});

  // Decline Modal State
  const [decliningReq, setDecliningReq] = useState<SongRequest | null>(null);
  const [declineReason, setDeclineReason] = useState<string>('');

  // Segregate requests by pipeline status
  const pendingRequests = songRequests.filter((r) => r.requestType !== 'feature' && r.status === 'pending');
  const processingRequests = songRequests.filter((r) => r.requestType !== 'feature' && r.status === 'processing');
  const stagingRequests = songRequests.filter((r) => r.requestType !== 'feature' && r.status === 'staging');
  const publishedRequests = songRequests.filter((r) => r.requestType !== 'feature' && r.status === 'published');

  // Handle Google Drive Auth
  const handleConnectGoogleDrive = async () => {
    setIsConnectingDrive(true);
    setActionError(null);
    try {
      const result = await connectGoogleDrive();
      setGoogleDriveConnected(true);
      setGoogleAccountEmail(result.user.email || 'liamnystrom9@gmail.com');
      setSuccessToast('Google Drive connected! Converted MP3 tracks will be uploaded to your Drive folder.');
    } catch (err: any) {
      console.error('Google Drive connection error:', err);
      setActionError(err.message || 'Failed to authenticate with Google Drive.');
    } finally {
      setIsConnectingDrive(false);
    }
  };

  // Initialize or get edit metadata for a request
  const getEditState = (req: SongRequest) => {
    return editingMetadata[req.id] || {
      songTitle: req.songTitle,
      artist: req.artist || '',
      coverUrl: req.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
      genre: req.genre || 'Vibe / Chill',
      notes: req.notes || '',
    };
  };

  const updateEditField = (id: string, field: string, value: string, req: SongRequest) => {
    const current = getEditState(req);
    setEditingMetadata((prev) => ({
      ...prev,
      [id]: {
        ...current,
        [field]: value,
      },
    }));
  };

  // Step 2: Save edits without approving yet
  const handleSaveMetadata = async (req: SongRequest) => {
    setIsSavingEdit(req.id);
    setActionError(null);
    try {
      const editState = getEditState(req);
      await adminUpdateRequest(req.id, {
        songTitle: editState.songTitle.trim(),
        artist: editState.artist.trim(),
        coverUrl: editState.coverUrl.trim(),
        genre: editState.genre.trim(),
        notes: editState.notes?.trim(),
      });
      setSuccessToast(`Saved metadata corrections for "${editState.songTitle}". System is still awaiting manual approval.`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to save metadata');
    } finally {
      setIsSavingEdit(null);
    }
  };

  // Step 3: Trigger "Approve & Process" (Mandatory Gate)
  const handleApproveAndProcess = async (req: SongRequest) => {
    setProcessingId(req.id);
    setActionError(null);
    try {
      const editState = getEditState(req);
      const token = getDriveAccessToken() || undefined;

      const result = await adminApproveAndProcess(
        req.id,
        {
          songTitle: editState.songTitle.trim(),
          artist: editState.artist.trim(),
          coverUrl: editState.coverUrl.trim(),
          genre: editState.genre.trim(),
        },
        token
      );

      if (!result.success) {
        throw new Error(result.error || 'Conversion process failed');
      }

      setSuccessToast(`"${editState.songTitle}" approved! Now in Staging for Test Stream.`);
      setActivePipelineTab('staging');
    } catch (err: any) {
      console.error('Approve and process error:', err);
      setActionError(err.message || 'Failed to convert audio');
    } finally {
      setProcessingId(null);
    }
  };

  // Step 4: Final Publish Toggle
  const handleTogglePublish = async (req: SongRequest, shouldPublish: boolean) => {
    setActionError(null);
    try {
      const result = await adminPublishRequest(req.id, shouldPublish, !!hideVideoFor[req.id]);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update publish state');
      }

      if (shouldPublish) {
        setSuccessToast(`🎉 "${req.songTitle}" is now LIVE in the YouSong public library!`);
      } else {
        setSuccessToast(`"${req.songTitle}" was removed from the public library and moved back to Staging.`);
      }
    } catch (err: any) {
      setActionError(err.message || 'Publish toggle failed');
    }
  };

  // Audio Playback Controls for Test Stream
  const handleTestStreamPlay = (req: SongRequest) => {
    const audioSource = req.stagingAudioUrl || req.audioUrl;
    if (!audioSource) return;

    // YouTube-embed songs play through the main player (shows the video box)
    if (audioSource.startsWith('youtube:')) {
      audioRef.current?.pause();
      setActivePlayingId(null);
      setIsPlaying(false);
      // Stop the main player so two things never play at once
      if (mainPlayerPlaying) togglePlay();
      setTestPlayerFor((prev) => (prev === req.id ? null : req.id));
      return;
    }

    if (activePlayingId === req.id) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play();
        setIsPlaying(true);
      }
    } else {
      if (audioRef.current) {
        audioRef.current.src = audioSource;
        audioRef.current.play().catch((e) => console.warn('Audio play failed:', e));
        setActivePlayingId(req.id);
        setIsPlaying(true);
      }
    }
  };

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (newTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const formatSeconds = (sec: number) => {
    if (isNaN(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="space-y-6">
      {/* Hidden audio element for Test Stream verification */}
      <audio
        ref={audioRef}
        onTimeUpdate={handleAudioTimeUpdate}
        onEnded={handleAudioEnded}
        onLoadedMetadata={handleAudioTimeUpdate}
      />

      {/* Toast & Error Banners */}
      {successToast && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button
            onClick={() => setSuccessToast(null)}
            className="p-1 hover:bg-emerald-900/40 rounded-lg text-emerald-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="p-1 hover:bg-rose-900/40 rounded-lg text-rose-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 Pipeline Stage Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-slate-900/80 border border-white/10 text-xs">
        <button
          onClick={() => setActivePipelineTab('holding')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activePipelineTab === 'holding'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>1. Holding Queue ({pendingRequests.length})</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-950/30 text-current">
            Gate
          </span>
        </button>

        <button
          onClick={() => setActivePipelineTab('processing')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activePipelineTab === 'processing'
              ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>2. In Conversion ({processingRequests.length})</span>
        </button>

        <button
          onClick={() => setActivePipelineTab('staging')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activePipelineTab === 'staging'
              ? 'bg-purple-500 text-white shadow-md shadow-purple-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <Headphones className="w-4 h-4" />
          <span>3. Staging & Test Stream ({stagingRequests.length})</span>
        </button>

        <button
          onClick={() => setActivePipelineTab('published')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activePipelineTab === 'published'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>4. Published Live ({publishedRequests.length})</span>
        </button>
      </div>

      {/* ================= STAGE 1: HOLDING QUEUE & MANDATORY GATE ================= */}
      {activePipelineTab === 'holding' && (
        <div className="space-y-4">
          {/* Gate Explanation Banner */}
          <div className="p-4 rounded-3xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold text-amber-300">
              <ShieldCheck className="w-4 h-4" />
              <span>Mandatory Admin Review Gate</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              Submissions in this queue are completely hidden from regular users. <strong className="text-white">Zero server downloading or audio conversion has occurred.</strong> The system is waiting entirely for your manual review. You can fix typos in the title and artist below, then click <strong>"Approve & Process"</strong> to prepare the YouTube video for playback.
            </p>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="py-16 text-center rounded-3xl bg-slate-900/60 border border-white/10 space-y-2">
              <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto" />
              <h4 className="text-sm font-bold text-slate-300">Holding Queue is Clear</h4>
              <p className="text-xs text-slate-500">No new user submissions awaiting review.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((req) => {
                const editState = getEditState(req);
                const isProcessingThis = processingId === req.id;
                const isSavingThis = isSavingEdit === req.id;

                return (
                  <div
                    key={req.id}
                    className="p-5 sm:p-6 rounded-3xl bg-slate-900/90 border border-amber-500/20 shadow-xl space-y-4 hover:border-amber-500/40 transition-all"
                  >
                    {/* Header info */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Awaiting Review
                        </span>
                        <span className="text-xs text-slate-400">
                          Submitted by <strong className="text-slate-200">{req.requestedByUsername}</strong>
                        </span>
                        <span className="text-xs text-slate-500">· {new Date(req.createdAt).toLocaleString()}</span>
                      </div>

                      {req.webLink && (
                        <a
                          href={req.webLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Open YouTube Link</span>
                        </a>
                      )}
                    </div>

                    {/* Metadata Editing Form (Fix typos, capitalization, artist info) */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                      {/* Cover Art Preview */}
                      <div className="md:col-span-3 flex flex-col items-center gap-2">
                        <div className="w-28 h-28 rounded-2xl overflow-hidden bg-slate-950 border border-white/10 shadow-lg relative group">
                          <img
                            src={editState.coverUrl}
                            alt="Cover"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80';
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400 text-center">Cover Art Preview</span>
                      </div>

                      {/* Editable Inputs */}
                      <div className="md:col-span-9 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Song Title (Edit Typos & Capitalization) *
                            </label>
                            <input
                              type="text"
                              value={editState.songTitle}
                              onChange={(e) => updateEditField(req.id, 'songTitle', e.target.value, req)}
                              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Artist / Producer Info *
                            </label>
                            <input
                              type="text"
                              value={editState.artist}
                              onChange={(e) => updateEditField(req.id, 'artist', e.target.value, req)}
                              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Cover Art URL
                            </label>
                            <input
                              type="text"
                              value={editState.coverUrl}
                              onChange={(e) => updateEditField(req.id, 'coverUrl', e.target.value, req)}
                              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono text-[11px]"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Target Genre
                            </label>
                            <select
                              value={editState.genre}
                              onChange={(e) => updateEditField(req.id, 'genre', e.target.value, req)}
                              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/15 text-white focus:outline-none focus:border-cyan-400"
                            >
                              <option value="Vibe / Chill">Vibe / Chill</option>
                              <option value="Lo-Fi & Study">Lo-Fi & Study</option>
                              <option value="Synthwave & Retro">Synthwave & Retro</option>
                              <option value="Acoustic & Coffee">Acoustic & Coffee</option>
                              <option value="Ambient & Deep">Ambient & Deep</option>
                              <option value="Anime & Soundtracks">Anime & Soundtracks</option>
                              <option value="Instrumental">Instrumental</option>
                            </select>
                          </div>
                        </div>

                        {req.notes && (
                          <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-[11px] text-slate-400">
                            <strong>User Note:</strong> "{req.notes}"
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons: Save Edits, Approve & Process, Decline */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveMetadata(req)}
                          disabled={isSavingThis}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 text-xs font-semibold transition-all"
                        >
                          <Save className="w-3.5 h-3.5 text-cyan-400" />
                          <span>{isSavingThis ? 'Saving...' : 'Save Edits Only'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDecliningReq(req);
                            setDeclineReason('');
                          }}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 text-xs font-semibold transition-all"
                        >
                          Decline Request
                        </button>
                      </div>

                      {/* Primary Trigger: Approve & Process */}
                      <button
                        type="button"
                        onClick={() => handleApproveAndProcess(req)}
                        disabled={isProcessingThis}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50"
                      >
                        <Upload className="w-4 h-4" />
                        <span>{isProcessingThis ? 'Checking video...' : 'Approve & Process Audio'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= STAGE 2: IN PROCESSING ================= */}
      {activePipelineTab === 'processing' && (
        <div className="space-y-4">
          {processingRequests.length === 0 ? (
            <div className="py-16 text-center rounded-3xl bg-slate-900/60 border border-white/10 space-y-2">
              <Radio className="w-12 h-12 text-slate-600 mx-auto" />
              <h4 className="text-sm font-bold text-slate-300">No Audio Extractions In Flight</h4>
              <p className="text-xs text-slate-500">Approve requests in the Holding Queue to trigger audio conversion.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {processingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-5 rounded-3xl bg-slate-900/90 border border-cyan-500/30 flex items-center justify-between gap-4 animate-pulse"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white truncate">{req.songTitle}</h4>
                      <p className="text-xs text-slate-400">{req.artist}</p>
                      <p className="text-[11px] text-cyan-400 mt-1 font-mono">
                        {req.processingProgress || 'Checking the YouTube link...'}
                      </p>
                    </div>
                  </div>

                  <span className="px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold border border-cyan-400/30">
                    Processing
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= STAGE 3: STAGING STATE & TEST STREAM ================= */}
      {activePipelineTab === 'staging' && (
        <div className="space-y-4">
          <div className="p-4 rounded-3xl bg-purple-950/30 border border-purple-500/30 text-purple-200 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold text-purple-300">
              <Headphones className="w-4 h-4" />
              <span>Staging State & Quality Verification</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              These tracks play through the official YouTube embedded player (nothing is downloaded or stored). <strong className="text-white">Use the "Test Stream" button to check that the video plays.</strong> When satisfied, click the <strong>"Publish"</strong> toggle to activate the track on the public YouSong library!
            </p>
          </div>

          {stagingRequests.length === 0 ? (
            <div className="py-16 text-center rounded-3xl bg-slate-900/60 border border-white/10 space-y-2">
              <Headphones className="w-12 h-12 text-slate-600 mx-auto" />
              <h4 className="text-sm font-bold text-slate-300">No Staged Tracks</h4>
              <p className="text-xs text-slate-500">Processed songs will appear here ready for your audio quality test.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {stagingRequests.map((req) => {
                const ytId = (req.stagingAudioUrl || req.audioUrl || '').match(/^youtube:([A-Za-z0-9_-]{11})/)?.[1] || null;
                const isOpenPreview = testPlayerFor === req.id;
                const isThisPlaying = ytId ? isOpenPreview : activePlayingId === req.id && isPlaying;
                const audioDurationSec = req.duration || duration || 180;

                return (
                  <div
                    key={req.id}
                    className="p-5 sm:p-6 rounded-3xl bg-slate-900/90 border border-purple-500/20 shadow-xl space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      {/* Track Info */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <img
                          src={req.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80'}
                          alt={req.songTitle}
                          className="w-14 h-14 rounded-2xl object-cover shrink-0 border border-white/10 shadow-md"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-bold text-white truncate font-display">{req.songTitle}</h4>
                            <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold">
                              Staged
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{req.artist}</p>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                            <span className="text-cyan-400 font-semibold">{req.genre || 'Vibe / Chill'}</span>
                            <span>·</span>
                            <span>Track Length: <strong className="text-white">{formatSeconds(audioDurationSec)}</strong></span>
                            {req.driveFileId && (
                              <>
                                <span>·</span>
                                <span className="font-mono text-purple-300 text-[10px]">Drive ID: {req.driveFileId.slice(0, 10)}...</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Publish Toggle Button */}
                      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 shrink-0">
                        {(req.stagingAudioUrl || req.audioUrl || '').startsWith('youtube:') && (
                          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!hideVideoFor[req.id]}
                              onChange={(e) => setHideVideoFor((prev) => ({ ...prev, [req.id]: e.target.checked }))}
                              className="rounded border-slate-600"
                            />
                            <span>Hide video from listeners</span>
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(req, true)}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/25 transition-all active:scale-95"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Publish to YouSong</span>
                        </button>
                      </div>
                    </div>

                    {/* Test Stream Player Bar */}
                    <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10 flex flex-col sm:flex-row items-center gap-3 text-xs">
                      {/* Play / Pause */}
                      <button
                        type="button"
                        onClick={() => handleTestStreamPlay(req)}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-all shrink-0 ${
                          isThisPlaying
                            ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30 scale-105'
                            : 'bg-white/[0.08] hover:bg-white/[0.15] text-purple-300'
                        }`}
                        title="Test Stream Track"
                      >
                        {isThisPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>

                      <div className="flex-1 w-full space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span className="flex items-center gap-1.5 text-purple-300 font-bold">
                            <Radio className="w-3 h-3" />
                            <span>{ytId ? (isOpenPreview ? 'Video preview open' : 'Press play to preview the video') : isThisPlaying ? 'Playing...' : 'Ready for Audio Verification'}</span>
                          </span>
                          <span>
                            {ytId ? `Length: ${formatSeconds(audioDurationSec)}` : `${activePlayingId === req.id ? formatSeconds(currentTime) : '0:00'} / ${formatSeconds(audioDurationSec)}`}
                          </span>
                        </div>

                        {/* Seeker (not used for YouTube; the video has its own controls) */}
                        {!ytId && <input
                          type="range"
                          min={0}
                          max={audioDurationSec}
                          step={1}
                          value={activePlayingId === req.id ? currentTime : 0}
                          onChange={(e) => handleSeek(parseFloat(e.target.value))}
                          className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                        />}
                      </div>

                      {/* Stream Direct Link Indicator */}
                      {req.audioUrl && (
                        <a
                          href={ytId ? `https://www.youtube.com/watch?v=${ytId}` : req.audioUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[10px] text-cyan-400 hover:underline flex items-center gap-1 shrink-0"
                          title="Open direct audio stream link"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>{ytId ? 'Open on YouTube' : 'Stream URL'}</span>
                        </a>
                      )}
                    </div>

                    {ytId && isOpenPreview && (
                      <div className="pt-1">
                        <YouTubeTestPlayer
                          videoId={ytId}
                          onDuration={(sec) => {
                            // Save the real length so the published song shows the right time
                            if (Math.abs((req.duration || 0) - sec) >= 2) {
                              adminUpdateRequest(req.id, { duration: sec });
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= STAGE 4: PUBLISHED LIVE LIBRARY ================= */}
      {activePipelineTab === 'published' && (
        <div className="space-y-4">
          <div className="p-4 rounded-3xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold text-emerald-300">
              <CheckCircle2 className="w-4 h-4" />
              <span>Published & Live on YouSong Library</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              These songs have passed admin moderation, and staging verification. They are currently active on the public site library and playable by all listeners.
            </p>
          </div>

          {publishedRequests.length === 0 ? (
            <div className="py-16 text-center rounded-3xl bg-slate-900/60 border border-white/10 space-y-2">
              <CheckCircle2 className="w-12 h-12 text-slate-600 mx-auto" />
              <h4 className="text-sm font-bold text-slate-300">No Published Pipeline Tracks Yet</h4>
              <p className="text-xs text-slate-500">Publish tracks from the Staging tab to see them here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {publishedRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 sm:p-5 rounded-3xl bg-slate-900/90 border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <img
                      src={req.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80'}
                      alt={req.songTitle}
                      className="w-12 h-12 rounded-2xl object-cover shrink-0 border border-white/10"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white truncate">{req.songTitle}</h4>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                          Active Live
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">{req.artist}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                        <span>Genre: <strong className="text-cyan-400">{req.genre || 'Vibe / Chill'}</strong></span>
                        <span>·</span>
                        <span>Length: <strong className="text-white">{formatSeconds(req.duration || 180)}</strong></span>
                        <span>·</span>
                        <span>Published: {req.publishedAt ? new Date(req.publishedAt).toLocaleDateString() : 'Active'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePublish(req, false)}
                      className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-xs font-semibold transition-all"
                    >
                      Unpublish to Staging
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete published track "${req.songTitle}" from YouSong library?`)) {
                          deleteSongRequest(req.id);
                        }
                      }}
                      className="p-2 rounded-xl hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-colors"
                      title="Delete Track"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Decline Note Modal */}
      {decliningReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-sm font-bold text-white font-display">Decline Track Request</h3>
              <button
                onClick={() => setDecliningReq(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-300 mb-2">
                Declining request for <strong className="text-cyan-300">"{decliningReq.songTitle}"</strong> submitted by <strong className="text-white">{decliningReq.requestedByUsername}</strong>.
              </p>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Reason / Note for Listener (Optional)
              </label>
              <textarea
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g. Audio unavailable or duplicate track in library..."
                className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-white/15 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setDecliningReq(null)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await updateSongRequestStatus(decliningReq.id, 'declined', declineReason.trim() || 'Request declined by administrator.');
                  setDecliningReq(null);
                  setSuccessToast(`Declined request for "${decliningReq.songTitle}".`);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-all"
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
