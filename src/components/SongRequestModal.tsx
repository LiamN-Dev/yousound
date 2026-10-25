import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { storage } from '../services/storage';
import {
  X,
  Music,
  Send,
  Sparkles,
  Link as LinkIcon,
  CheckCircle2,
  Clock,
  XCircle,
  ListPlus,
  Image as ImageIcon,
  ShieldCheck,
  Headphones,
  ExternalLink,
  Radio,
  Lightbulb,
  Bug,
} from 'lucide-react';

interface SongRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_COVERS = [
  {
    name: 'Lo-fi Study',
    url: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=500&auto=format&fit=crop&q=80',
  },
  {
    name: 'Synthwave Sunset',
    url: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80',
  },
  {
    name: 'Vinyl Mood',
    url: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=500&auto=format&fit=crop&q=80',
  },
  {
    name: 'Neon Cyber',
    url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80',
  },
  {
    name: 'Coffee Chill',
    url: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=500&auto=format&fit=crop&q=80',
  },
];

const BUG_AREAS = ['Library', 'Playlists', 'Favorites', 'Chat', 'Music player / video', 'Requests', 'Login / account', 'Admin panel', 'Other'];

const FeedbackForm: React.FC<{ kind: 'feature' | 'bug' }> = ({ kind }) => {
  const { currentUser } = useAuth();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [area, setArea] = useState(BUG_AREAS[0]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const isBug = kind === 'bug';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !details.trim()) {
      setNotice({ ok: false, text: 'Please fill in both the title and the details.' });
      return;
    }
    setSending(true);
    setNotice(null);
    const res = await storage.submitFeedback({
      type: kind,
      title: title.trim(),
      details: details.trim(),
      area: isBug ? area : undefined,
      userId: currentUser?.id,
      username: currentUser?.username,
    });
    setSending(false);
    if (res.success) {
      setTitle('');
      setDetails('');
      setNotice({
        ok: true,
        text: isBug
          ? 'Thanks! Your bug report was sent to the admins.'
          : 'Thanks! Your feature idea was sent to the admins.',
      });
    } else {
      setNotice({ ok: false, text: res.error || 'Something went wrong. Please try again.' });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-cyan-500/20 text-xs text-slate-300">
        {isBug
          ? 'Something broken or acting weird? Tell us what happened and where. The more detail, the faster it can be fixed.'
          : 'Have an idea that would make YouSong better? Describe it and an admin will take a look.'}
      </div>

      {notice && (
        <div
          className={`p-3 rounded-2xl border text-xs ${
            notice.ok
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-200'
          }`}
        >
          {notice.text}
        </div>
      )}

      {isBug && (
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Where did it happen?</label>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
          >
            {BUG_AREAS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">
          {isBug ? 'Short summary *' : 'Feature name *'}
        </label>
        <input
          type="text"
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isBug ? 'e.g. Chat messages will not send' : 'e.g. Add a sleep timer'}
          className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">
          {isBug ? 'What happened? What did you expect? *' : 'Describe the idea *'}
        </label>
        <textarea
          rows={5}
          maxLength={4000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={
            isBug
              ? 'Steps: 1) I opened Chat  2) I typed a message  3) I pressed send. It said...'
              : 'What should it do, and how would you use it?'
          }
          className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-y"
          required
        />
      </div>

      <button
        type="submit"
        disabled={sending}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 transition-all"
      >
        <Send className="w-3.5 h-3.5" />
        {sending ? 'Sending...' : isBug ? 'Send Bug Report' : 'Send Feature Idea'}
      </button>
    </form>
  );
};

export const SongRequestModal: React.FC<SongRequestModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, songRequests, submitSongRequest } = useAuth();
  const [mode, setMode] = useState<'song' | 'feature' | 'bug'>('song');
  const [activeTab, setActiveTab] = useState<'submit' | 'my-requests'>('submit');

  // Form fields as requested:
  // YouTube link, cover art image address, initial guess for title, initial guess for artist
  const [webLink, setWebLink] = useState('');
  const [coverUrl, setCoverUrl] = useState(PRESET_COVERS[0].url);
  const [songTitle, setSongTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('Vibe / Chill');
  const [notes, setNotes] = useState('');

  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const userRequests = songRequests.filter((r) =>
    currentUser ? r.requestedByUserId === currentUser.id : r.requestedByUsername === 'Guest User'
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!/(?:youtube\.com|youtu\.be)\//i.test(webLink.trim())) {
      setFeedback('Please provide a valid YouTube link.');
      return;
    }
    if (!songTitle.trim()) {
      setFeedback('Please provide your initial guess for the song title.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitSongRequest({
        songTitle: songTitle.trim(),
        artist: artist.trim() || 'Unknown Artist',
        webLink: webLink.trim(),
        coverUrl: coverUrl.trim() || PRESET_COVERS[0].url,
        genre: genre.trim(),
        notes: notes.trim() || undefined,
        requestType: 'song',
      });

      setWebLink('');
      setSongTitle('');
      setArtist('');
      setNotes('');
      setFeedback('Your song request was successfully placed into the Holding Queue. An admin will review and approve it before audio processing begins.');
      setActiveTab('my-requests');
    } catch (err: any) {
      setFeedback(err.message || 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl max-h-[92vh] overflow-y-auto text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white font-display">
                  YouSong Requests
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Moderated
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Request a song, suggest a site feature, or report a bug.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* What do you want to send? */}
        <div className="grid grid-cols-3 gap-2 mb-5 text-xs">
          {([
            { id: 'song', label: 'Song', Icon: Music },
            { id: 'feature', label: 'Site Feature', Icon: Lightbulb },
            { id: 'bug', label: 'Report a Bug', Icon: Bug },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold border transition-all ${
                mode === id
                  ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {mode !== 'song' ? (
          <FeedbackForm key={mode} kind={mode} />
        ) : (
          <>
        {/* Tab Switcher */}
        <div className="flex p-1 rounded-2xl bg-slate-950 border border-slate-800 mb-5 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('submit')}
            className={`flex-1 py-2 rounded-xl font-semibold transition-all ${
              activeTab === 'submit'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Submit Song Request
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('my-requests')}
            className={`flex-1 py-2 rounded-xl font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'my-requests'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>My Submissions</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-white">
              {userRequests.length}
            </span>
          </button>
        </div>

        {feedback && (
          <div className="mb-4 p-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-xs flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <span>{feedback}</span>
          </div>
        )}

        {activeTab === 'submit' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Holding Queue Security Notice */}
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-cyan-500/20 text-xs text-slate-300 space-y-1">
              <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-[11px]">
                <ShieldCheck className="w-4 h-4" />
                <span>Human Moderation & Holding Queue</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Your request enters a private holding queue. It stays hidden from other users until an administrator reviews it and publishes it.
              </p>
            </div>

            {/* 1. YouTube Link */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-rose-400" />
                <span>YouTube Link *</span>
              </label>
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                value={webLink}
                onChange={(e) => setWebLink(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                required
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                The link that will be extracted and converted into a clean .mp3 upon admin approval.
              </span>
            </div>

            {/* 2. Initial Guess for Title & Artist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Initial Guess: Song Title *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Midnight City"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Initial Guess: Artist / Channel
                </label>
                <input
                  type="text"
                  placeholder="e.g. M83"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>

            {/* 3. Cover Art Image Address */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Cover Art Image Address *</span>
                </label>
                <span className="text-[10px] text-slate-500">Preset or direct image URL</span>
              </div>

              <div className="flex gap-3 items-center mb-2.5">
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-950 border border-white/10 shrink-0 shadow-inner">
                  <img
                    src={coverUrl || PRESET_COVERS[0].url}
                    alt="Cover Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = PRESET_COVERS[0].url;
                    }}
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="url"
                    placeholder="https://example.com/artwork.jpg"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                    required
                  />
                </div>
              </div>

              {/* Quick Preset Selector */}
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COVERS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setCoverUrl(preset.url)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                      coverUrl === preset.url
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Genre & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Genre / Mood
                </label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500 transition-colors"
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

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Listener Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Timestamp 0:30, high quality version"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>

            {/* Submit Footer */}
            <div className="pt-3 flex items-center justify-between border-t border-slate-800">
              <span className="text-[11px] text-slate-400">
                Submitting as: <strong className="text-cyan-400">{currentUser ? currentUser.username : 'Guest User'}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Submitting to Queue...' : 'Submit to Holding Queue'}</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            {userRequests.length === 0 ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <ListPlus className="w-10 h-10 opacity-30 mx-auto" />
                <p className="text-xs">You have not submitted any track requests yet.</p>
              </div>
            ) : (
              userRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3.5 rounded-2xl border border-slate-800 bg-slate-950/70 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <img
                      src={req.coverUrl || PRESET_COVERS[0].url}
                      alt={req.songTitle}
                      className="w-12 h-12 rounded-xl object-cover shrink-0 border border-white/10"
                    />
                    <div className="space-y-1 min-w-0">
                      <div className="font-bold text-white truncate text-sm">
                        {req.songTitle}
                      </div>
                      {req.artist && (
                        <p className="text-[11px] text-slate-400">
                          {req.artist}
                        </p>
                      )}
                      {req.webLink && (
                        <a
                          href={req.webLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>YouTube Source</span>
                        </a>
                      )}
                      {req.adminNote && (
                        <div className="mt-1 p-2 rounded-lg bg-blue-950/60 border border-blue-800/40 text-[11px] text-blue-300">
                          <strong>Admin Feedback:</strong> {req.adminNote}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {req.status === 'pending' && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-800/50">
                        <Clock className="w-3 h-3" />
                        Holding Queue (Review Gate)
                      </span>
                    )}
                    {req.status === 'processing' && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-cyan-300 bg-cyan-950/40 px-2.5 py-1 rounded-full border border-cyan-800/50 animate-pulse">
                        <Radio className="w-3 h-3" />
                        Being Checked
                      </span>
                    )}
                    {req.status === 'staging' && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-purple-300 bg-purple-950/40 px-2.5 py-1 rounded-full border border-purple-800/50">
                        <Headphones className="w-3 h-3" />
                        In Staging (Testing)
                      </span>
                    )}
                    {req.status === 'published' && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-800/50">
                        <CheckCircle2 className="w-3 h-3" />
                        Live in YouSong Library
                      </span>
                    )}
                    {req.status === 'declined' && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-400 bg-rose-950/40 px-2.5 py-1 rounded-full border border-rose-800/50">
                        <XCircle className="w-3 h-3" />
                        Declined
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
};
