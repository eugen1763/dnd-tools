import { Elysia, t } from 'elysia';
import {
  getAllTracks,
  getAllCategories,
  getTracksByCategory,
  getTrack,
  addTrack,
  addTracks,
  removeTrack,
  renameCategory,
  deleteCategory,
  moveTrack,
  toggleFavorite,
  getFavoriteTracks,
  createCategory,
  Track,
} from './music-store';
import {
  getSessionByToken,
  joinAndStartSession,
  leaveSession,
  playTrackById,
  playNext,
  playPrevious,
  togglePlayPause,
  setVolume,
  setRepeatMode,
  setShuffle,
  seek,
  getPositionSeconds,
  RepeatMode,
  setQueue,
  addToQueue,
  clearQueue,
  removeFromQueue,
  PlayerState,
  validateControlToken,
  getSession,
} from './music-player';
import { downloadVideo, downloadPlaylist, DownloadResult, parseYouTubeUrl } from './youtube';
import { join } from 'path';
import { nanoid } from 'nanoid';

const MUSIC_DIR = join(import.meta.dir, '../music/tracks');

// Download progress tracking
interface DownloadJob {
  id: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  progress: number;
  message: string;
  trackTitle?: string;
  trackCount?: number;
  currentTrack?: number;
  error?: string;
  type: 'video' | 'playlist';
  timestamp: number;
}

const downloadJobs = new Map<string, DownloadJob>();

function cleanStaleJobs() {
  const now = Date.now();
  for (const [id, job] of downloadJobs) {
    if (now - job.timestamp > 30 * 60 * 1000) downloadJobs.delete(id);
  }
}

function createJob(type: 'video' | 'playlist', msg: string): string {
  cleanStaleJobs();
  const id = nanoid(16);
  downloadJobs.set(id, { id, status: 'queued', progress: 0, message: msg, type, timestamp: Date.now() });
  return id;
}

function updateJob(id: string, upd: Partial<DownloadJob>) {
  const job = downloadJobs.get(id);
  if (job) Object.assign(job, upd, { timestamp: Date.now() });
}

/** Parse yt-dlp percentage from stderr */
function parseProgressPct(text: string): number | null {
  const m = text.match(/(\d+\.?\d*)%/);
  return m ? parseFloat(m[1]) : null;
}

async function runDownload(jobId: string, url: string, category: string | undefined, isPlaylist: boolean) {
  updateJob(jobId, { status: 'downloading', progress: 0, message: 'Starting download...' });
  try {
    if (isPlaylist) {
      const result = await downloadPlaylist(url, (idx, total, title) => {
        updateJob(jobId, { progress: Math.round((idx / total) * 100), message: `Downloading ${idx}/${total}`, trackTitle: title || undefined, trackCount: total, currentTrack: idx });
      });
      const tracks = addTracks(result.tracks.map(t => ({ id: t.id, title: t.title, url: t.url, duration: t.duration, filename: t.filename, favorite: false })), category || result.playlistTitle || 'Playlists');
      updateJob(jobId, { status: 'completed', progress: 100, message: `Downloaded ${tracks.length} tracks`, trackCount: tracks.length });
    } else {
      const result = await downloadVideo(url, (line) => {
        const pct = parseProgressPct(line);
        if (pct !== null) updateJob(jobId, { status: 'downloading', progress: Math.round(pct), message: pct < 100 ? `Downloading... ${Math.round(pct)}%` : 'Processing audio...' });
      });
      addTrack({ id: result.id, title: result.title, url: result.url, duration: result.duration, filename: result.filename, category: category || 'uncategorized' });
      updateJob(jobId, { status: 'completed', progress: 100, message: `Downloaded "${result.title}"`, trackTitle: result.title });
    }
  } catch (err) {
    updateJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err), message: 'Download failed' });
  }
}

function trackToResponse(t: Track)  {
  return {
    id: t.id,
    title: t.title,
    url: t.url,
    duration: t.duration,
    category: t.category,
    addedAt: t.addedAt,
    favorite: t.favorite,
  };
}

function sessionToResponse(s: PlayerState) {
  return {
    guildId: s.guildId,
    voiceChannelId: s.voiceChannelId,
    adminUserId: s.adminUserId,
    queue: s.queue,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    volume: s.volume,
    repeatMode: s.repeatMode,
    shuffle: s.shuffle,
    position: getPositionSeconds(s),
  };
}

export const musicApi = new Elysia({ prefix: '/api/music' })
  // === Session Control ===

  // Get state (by token in header)
  .get('/state', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'Invalid or expired control token' };
    return { ok: true, state: sessionToResponse(session) };
  })

  // === Library ===

  // Get all tracks
  .get('/tracks', () => {
    return { ok: true, tracks: getAllTracks().map(trackToResponse) };
  })

  // Get all categories
  .get('/categories', () => {
    const categories = getAllCategories().map(c => ({
      id: c.id,
      name: c.name,
      trackCount: c.trackIds.length,
    }));
    return { ok: true, categories };
  })

  // Get tracks by category
  .get('/categories/:id/tracks', ({ params: { id } }) => {
    const tracks = getTracksByCategory(id);
    if (tracks.length === 0) {
      const cat = getAllCategories().find(c => c.id === id);
      if (!cat) return { error: 'Category not found' };
    }
    return { ok: true, tracks: tracks.map(trackToResponse) };
  })

  // Get single track
  .get('/tracks/:id', ({ params: { id } }) => {
    const track = getTrack(id);
    if (!track) return { error: 'Track not found' };
    return { ok: true, track: trackToResponse(track) };
  })

  // === Download & Add ===

  // Start a download (returns job ID for progress polling)
  .post('/download', async ({ body, headers }) => {
    const { url, category } = body as { url: string; category?: string };
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    if (!url) return { error: 'Missing url' };

    try {
      const parsed = parseYouTubeUrl(url);
      const isPlaylist = parsed.type === 'playlist';
      const jobId = createJob(isPlaylist ? 'playlist' : 'video', 'Starting download...');
      runDownload(jobId, url, category || undefined, isPlaylist); // fire & forget
      return { ok: true, jobId, type: isPlaylist ? 'playlist' : 'track' };
    } catch (err) {
      return { error: `Failed to start download: ${err instanceof Error ? err.message : String(err)}` };
    }
  })

  // Poll download progress
  .get('/download/progress/:jobId', ({ params: { jobId } }) => {
    const job = downloadJobs.get(jobId);
    if (!job) return { error: 'Job not found' };
    return { ok: true, job: { id: job.id, status: job.status, progress: job.progress, message: job.message, trackTitle: job.trackTitle, trackCount: job.trackCount, currentTrack: job.currentTrack, error: job.error, type: job.type } };
  })

  // === Queue Management ===

  // Set entire queue
  .post('/queue', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { trackIds } = body as { trackIds: string[] };
    if (!Array.isArray(trackIds)) return { error: 'trackIds must be an array' };

    setQueue(session.guildId, trackIds);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Add to queue
  .post('/queue/add', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { trackId } = body as { trackId: string };
    if (!trackId) return { error: 'Missing trackId' };

    addToQueue(session.guildId, trackId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Remove from queue
  .delete('/queue/:index', ({ params: { index }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const idx = parseInt(index, 10);
    if (isNaN(idx)) return { error: 'Invalid index' };

    removeFromQueue(session.guildId, idx);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Clear queue
  .post('/queue/clear', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    clearQueue(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // === Playback Control ===

  // Play specific track
  .post('/play', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { trackId } = body as { trackId?: string };
    if (trackId) {
      playTrackById(session.guildId, trackId);
    } else if (session.queue.length > 0) {
      // Resume from current position
      togglePlayPause(session.guildId);
    }

    return { ok: true, state: sessionToResponse(session) };
  })

  // Play/pause toggle
  .post('/pause', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    togglePlayPause(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Next track
  .post('/next', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    playNext(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Previous track
  .post('/previous', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    playPrevious(session.guildId);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Set volume
  .post('/volume', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { volume } = body as { volume: number };
    if (typeof volume !== 'number' || volume < 0 || volume > 1) {
      return { error: 'Volume must be between 0 and 1' };
    }

    setVolume(session.guildId, volume);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Set repeat mode. Body may specify { mode: 'off'|'all'|'one' }; with no body
  // it cycles off -> all -> one -> off.
  .post('/loop', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const requested = (body as { mode?: string } | undefined)?.mode;
    let next: RepeatMode;
    if (requested && modes.includes(requested as RepeatMode)) {
      next = requested as RepeatMode;
    } else {
      next = modes[(modes.indexOf(session.repeatMode) + 1) % modes.length];
    }
    setRepeatMode(session.guildId, next);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Toggle shuffle
  .post('/shuffle', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    setShuffle(session.guildId, !session.shuffle);
    return { ok: true, state: sessionToResponse(session) };
  })

  // Seek to position in current track
  .post('/seek', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { position } = body as { position: number };
    if (typeof position !== 'number' || position < 0) return { error: 'Invalid position' };

    const ok = seek(session.guildId, position);
    if (!ok) return { error: 'Failed to seek' };
    return { ok: true, state: sessionToResponse(session) };
  })

  // === Track Management ===

  // Delete a track
  .delete('/tracks/:id', ({ params: { id }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const track = getTrack(id);
    if (!track) return { error: 'Track not found' };

    // Remove from filesystem
    const { unlinkSync, existsSync } = require('fs');
    const filePath = join(MUSIC_DIR, track.filename);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (err) {
      console.error('Failed to delete track file:', err);
    }

    removeTrack(id);
    return { ok: true };
  })

  // Move track to category
  .post('/tracks/:id/move', ({ params: { id }, body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { category } = body as { category: string };
    if (!category) return { error: 'Missing category' };

    moveTrack(id, category);
    return { ok: true };
  })

  // Toggle favorite
  .post('/tracks/:id/favorite', ({ params: { id }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const track = toggleFavorite(id);
    if (!track) return { error: 'Track not found' };
    return { ok: true, track: trackToResponse(track) };
  })

  // Get favorites
  .get('/tracks/favorites', ({ headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };

    return { ok: true, tracks: getFavoriteTracks().map(trackToResponse) };
  })

  // Create category
  .post('/categories/create', ({ body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { name } = body as { name: string };
    if (!name) return { error: 'Missing name' };

    const cat = createCategory(name);
    if (!cat) return { error: 'Category already exists or invalid name' };
    return { ok: true, category: cat };
  })

  // Rename category
  .post('/categories/:id/rename', ({ params: { id }, body, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    const { name } = body as { name: string };
    if (!name) return { error: 'Missing name' };

    renameCategory(id, name);
    return { ok: true };
  })

  // Delete category (tracks survive, become uncategorized)
  .delete('/categories/:id', ({ params: { id }, headers }) => {
    const token = headers['x-control-token'];
    if (!token) return { error: 'Missing x-control-token header' };
    const session = getSessionByToken(token);
    if (!session) return { error: 'No active session' };

    // Move all tracks in this category to uncategorized
    const tracks = getTracksByCategory(id);
    for (const track of tracks) {
      moveTrack(track.id, 'uncategorized');
    }
    deleteCategory(id);
    return { ok: true };
  });
