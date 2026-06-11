import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { GuildMember, VoiceChannel } from 'discord.js';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';
import { nanoid } from 'nanoid';
import { getTrack, Track, getAllTracks } from './music-store';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const MUSIC_DIR = join(import.meta.dir, '../music/tracks');

export interface QueueItem {
  trackId: string;
  title: string;
  duration: number;
  requestedBy: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  guildId: string;
  voiceChannelId: string;
  adminUserId: string;
  controlToken: string;
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  // Playback position tracking so the web UI can render a self-correcting
  // progress bar. `positionMs` is the offset at the last anchor; while playing,
  // the live position is positionMs + (Date.now() - startedAtMs).
  positionMs: number;
  startedAtMs: number;
}

/** Current playback position of a session in seconds (0 if nothing playing). */
export function getPositionSeconds(s: PlayerState): number {
  // No valid current track -> no meaningful position.
  if (s.currentIndex < 0 || s.currentIndex >= s.queue.length) return 0;
  const base = s.isPlaying ? s.positionMs + (Date.now() - s.startedAtMs) : s.positionMs;
  const secs = Math.max(0, base) / 1000;
  // Clamp to the current track's duration so the bar never overshoots.
  const dur = s.queue[s.currentIndex]?.duration ?? 0;
  return dur > 0 ? Math.min(secs, dur) : secs;
}

const sessions = new Map<string, PlayerState>();
const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();
const ffmpegProcesses = new Map<string, any>();
const resources = new Map<string, any>();
const controlTokens = new Map<string, string>();

// Playback resilience state (not part of the persisted/serialized session).
const playStartedAt = new Map<string, number>();
const failureState = new Map<string, { count: number; first: number; trackId: string }>();
const MAX_FAILURES = 4;
const FAILURE_WINDOW_MS = 10_000;
const FAST_FAIL_MS = 1500;

/** Terminate an ffmpeg child reliably: SIGTERM, then SIGKILL if it lingers. */
function killFfmpeg(proc: any): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try { if (!proc.killed) proc.kill('SIGKILL'); } catch {}
    }, 2000);
  } catch {}
}

/**
 * Record a playback failure for a guild. Returns true once the same track has
 * failed MAX_FAILURES times within FAILURE_WINDOW_MS — the signal to stop
 * instead of respawning ffmpeg in a tight loop (which previously leaked to OOM).
 */
function recordFailure(guildId: string, trackId: string): boolean {
  const now = Date.now();
  const fs = failureState.get(guildId);
  if (!fs || fs.trackId !== trackId || now - fs.first > FAILURE_WINDOW_MS) {
    failureState.set(guildId, { count: 1, first: now, trackId });
    return false;
  }
  fs.count++;
  return fs.count >= MAX_FAILURES;
}

function clearFailures(guildId: string): void {
  failureState.delete(guildId);
}

export function generateControlToken(guildId: string): string {
  const token = nanoid(32);
  controlTokens.set(token, guildId);
  return token;
}

export function validateControlToken(token: string): string | null {
  return controlTokens.get(token) ?? null;
}

export function getSession(guildId: string): PlayerState | undefined {
  return sessions.get(guildId);
}

export function getSessionByToken(token: string): PlayerState | undefined {
  const guildId = controlTokens.get(token);
  if (!guildId) return undefined;
  return sessions.get(guildId);
}

export function invalidateToken(token: string): void {
  controlTokens.delete(token);
}

export async function joinAndStartSession(
  member: GuildMember,
  channel: VoiceChannel,
): Promise<{ token: string; state: PlayerState }> {
  const guildId = channel.guild.id;
  await leaveSession(guildId);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,   // music bot never receives audio; lower bandwidth
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    throw new Error('Failed to join voice channel. Make sure the bot has Connect permission and the channel is accessible.');
  }

  // Pause (the default) when there's no healthy subscriber instead of burning
  // audio into a dead connection — this is what stops the broken-pipe/respawn
  // loop when the voice connection drops.
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  connection.subscribe(player);

  const token = generateControlToken(guildId);
  const state: PlayerState = {
    guildId,
    voiceChannelId: channel.id,
    adminUserId: member.id,
    controlToken: token,
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    volume: 1.0,
    repeatMode: 'off',
    shuffle: false,
    positionMs: 0,
    startedAtMs: 0,
  };

  sessions.set(guildId, state);
  connections.set(guildId, connection);
  players.set(guildId, player);

  // Voice-connection lifecycle, adapted from the official @discordjs/voice
  // music-bot example. This is what keeps playback alive across Discord's
  // periodic forced reconnects and tears the session down cleanly when the
  // connection is genuinely gone (instead of respawning into a dead socket).
  let readyLock = false;
  connection.on('stateChange', async (_old, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
        // Either moved channel (recoverable) or kicked (not). Give it a moment
        // to declare itself before deciding.
        try {
          await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
        } catch {
          try { connection.destroy(); } catch {}
        }
      } else if (connection.rejoinAttempts < 5) {
        // Recoverable network blip — back off and rejoin.
        await wait((connection.rejoinAttempts + 1) * 5_000);
        try { connection.rejoin(); } catch {}
      } else {
        try { connection.destroy(); } catch {}
      }
    } else if (newState.status === VoiceConnectionStatus.Destroyed) {
      // Connection is gone for good — stop playback and clean up.
      const p = players.get(guildId);
      if (p) p.stop(true);
      cleanupSession(guildId);
    } else if (
      !readyLock &&
      (newState.status === VoiceConnectionStatus.Connecting || newState.status === VoiceConnectionStatus.Signalling)
    ) {
      // Must reach Ready within 20s, else give up — covers "stuck in Signalling".
      readyLock = true;
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try { connection.destroy(); } catch {}
        }
      } finally {
        readyLock = false;
      }
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    // Normal play uses no ffmpeg (Opus passthrough); the seek/volume path does,
    // so reap any lingering ffmpeg here defensively.
    const prev = ffmpegProcesses.get(guildId);
    if (prev) killFfmpeg(prev);
    ffmpegProcesses.delete(guildId);

    // An Idle firing almost immediately after play() means the track failed
    // (e.g. a corrupt file), not that it finished — guard against a respawn
    // storm by stopping after repeated fast failures of the same track.
    const item = state.queue[state.currentIndex];
    const elapsed = Date.now() - (playStartedAt.get(guildId) ?? 0);
    if (item && elapsed < FAST_FAIL_MS) {
      if (recordFailure(guildId, item.trackId)) {
        console.error(`Track ${item.trackId} failed ${MAX_FAILURES}x in guild ${guildId}; stopping playback.`);
        state.isPlaying = false;
        clearFailures(guildId);
        return;
      }
    } else {
      clearFailures(guildId);
    }

    if (state.repeatMode === 'one' && state.currentIndex >= 0 && state.currentIndex < state.queue.length) {
      playTrackInSession(guildId, state.queue[state.currentIndex]);
    } else if (state.queue.length > 0) {
      playNext(guildId);
    } else {
      state.isPlaying = false;
    }
  });

  // Log errors only; the Idle transition that follows handles advancing, so we
  // never double-advance.
  player.on('error', (error: any) => {
    console.error(`Audio player error in guild ${guildId}:`, error?.message ?? error);
  });

  return { token, state };
}

export async function leaveSession(guildId: string): Promise<void> {
  const ffmpeg = ffmpegProcesses.get(guildId);
  if (ffmpeg) { killFfmpeg(ffmpeg); ffmpegProcesses.delete(guildId); }

  const player = players.get(guildId);
  if (player) { player.stop(true); players.delete(guildId); }

  const connection = connections.get(guildId);
  if (connection) { try { connection.destroy(); } catch {} connections.delete(guildId); }

  const session = sessions.get(guildId);
  if (session) { invalidateToken(session.controlToken); sessions.delete(guildId); }

  resources.delete(guildId);
  playStartedAt.delete(guildId);
  failureState.delete(guildId);
}

function cleanupSession(guildId: string): void {
  ffmpegProcesses.delete(guildId);
  players.delete(guildId);
  connections.delete(guildId);
  const session = sessions.get(guildId);
  if (session) { invalidateToken(session.controlToken); sessions.delete(guildId); }
  resources.delete(guildId);
  playStartedAt.delete(guildId);
  failureState.delete(guildId);
}

export function setQueue(guildId: string, trackIds: string[]): void {
  const session = sessions.get(guildId);
  if (!session) return;
  // Preserve the currently-playing track across a reorder so audio keeps going
  // and the now-playing highlight stays correct (the queue is rebuilt here but
  // playback is NOT restarted).
  const playingTrackId = session.currentIndex >= 0 ? session.queue[session.currentIndex]?.trackId : undefined;
  session.queue = trackIds.map(id => {
    const track = getTrack(id);
    return { trackId: id, title: track?.title || 'Unknown Track', duration: track?.duration || 0, requestedBy: session.adminUserId };
  });
  if (playingTrackId) {
    const idx = session.queue.findIndex(q => q.trackId === playingTrackId);
    session.currentIndex = idx >= 0 ? idx : (session.queue.length > 0 ? 0 : -1);
  } else {
    session.currentIndex = session.queue.length > 0 ? 0 : -1;
  }
}

export function addToQueue(guildId: string, trackId: string): void {
  const session = sessions.get(guildId);
  if (!session) return;
  const track = getTrack(trackId);
  session.queue.push({ trackId, title: track?.title || 'Unknown Track', duration: track?.duration || 0, requestedBy: session.adminUserId });
}

export function clearQueue(guildId: string): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.queue = [];
  session.currentIndex = -1;
  session.isPlaying = false;
  session.positionMs = 0;
  session.startedAtMs = Date.now();
  const player = players.get(guildId);
  if (player) player.stop();
}

export function removeFromQueue(guildId: string, index: number): boolean {
  const session = sessions.get(guildId);
  if (!session || index < 0 || index >= session.queue.length) return false;
  session.queue.splice(index, 1);
  if (session.currentIndex >= index) session.currentIndex--;
  return true;
}

export function playTrackById(guildId: string, trackId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  const existingIdx = session.queue.findIndex(q => q.trackId === trackId);
  if (existingIdx >= 0) {
    session.currentIndex = existingIdx;
  } else {
    const track = getTrack(trackId);
    if (!track) return false;
    session.queue.push({ trackId, title: track.title, duration: track.duration, requestedBy: session.adminUserId });
    session.currentIndex = session.queue.length - 1;
  }
  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function playNext(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session || session.queue.length === 0) return false;
  if (session.shuffle) {
    session.currentIndex = Math.floor(Math.random() * session.queue.length);
  } else {
    session.currentIndex++;
    if (session.currentIndex >= session.queue.length) {
      if (session.repeatMode === 'all') { session.currentIndex = 0; }
      else { session.isPlaying = false; return false; }
    }
  }
  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function playPrevious(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session || session.queue.length === 0) return false;
  session.currentIndex--;
  if (session.currentIndex < 0) session.currentIndex = session.queue.length - 1;
  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function togglePlayPause(guildId: string): boolean {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  if (!session || !player) return false;
  if (player.state.status === AudioPlayerStatus.Playing) {
    // Freeze the position offset at the moment we pause.
    session.positionMs += Date.now() - session.startedAtMs;
    player.pause();
    session.isPlaying = false;
  } else if (player.state.status === AudioPlayerStatus.Paused) {
    // Re-anchor wall-clock so the position keeps advancing from where it froze.
    session.startedAtMs = Date.now();
    player.unpause();
    session.isPlaying = true;
  } else if (session.queue.length > 0 && session.currentIndex >= 0) {
    return playTrackInSession(guildId, session.queue[session.currentIndex]);
  }
  return true;
}

export function setVolume(guildId: string, volume: number): void {
  const session = sessions.get(guildId);
  if (!session) return;
  const v = Math.max(0, Math.min(1, volume));
  if (v === session.volume) return;
  session.volume = v;
  // The Opus pipeline has no live volume control, so apply the new volume by
  // reloading the current track from its current position (ffmpeg bakes the
  // volume in). The web UI commits volume on release, so this fires once per
  // adjustment rather than on every drag tick.
  if (session.isPlaying && session.currentIndex >= 0) {
    const pos = getPositionSeconds(session);
    playTrackInSession(guildId, session.queue[session.currentIndex], pos);
  }
}

export function setRepeatMode(guildId: string, mode: RepeatMode): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.repeatMode = mode;
}

export function setShuffle(guildId: string, shuffle: boolean): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.shuffle = shuffle;
}

/** Seek to a position (seconds) in the current track. */
export function seek(guildId: string, position: number): boolean {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  if (!session || !player || session.queue.length === 0 || session.currentIndex < 0) return false;
  return playTrackInSession(guildId, session.queue[session.currentIndex], position);
}

/**
 * Core playback. For the common case (playing from the start at full volume) it
 * streams the file's Opus packets straight to Discord with NO ffmpeg and NO
 * re-encoding (StreamType.OggOpus) — the robust, lightweight path. ffmpeg is
 * spawned only when seeking or applying a non-unity volume.
 *
 * The AudioPlayer owns the resource lifecycle: player.play(new) / player.stop()
 * destroy the previous playStream (closing the file handle / Opus demuxer). We
 * additionally track and kill any ffmpeg child ourselves, since the player does
 * not reap a hand-spawned process.
 */
function playTrackInSession(guildId: string, item: QueueItem, seekPosition?: number): boolean {
  const connection = connections.get(guildId);
  const player = players.get(guildId);
  const session = sessions.get(guildId);
  if (!connection || !player || !session) return false;

  const track = getTrack(item.trackId);
  if (!track) return false;

  const filePath = join(MUSIC_DIR, track.filename);
  if (!existsSync(filePath)) {
    console.error(`Track file not found: ${filePath}`);
    return false;
  }

  try {
    // Reap any ffmpeg from a previous seek/volume resource before replacing it.
    const prev = ffmpegProcesses.get(guildId);
    if (prev) { killFfmpeg(prev); ffmpegProcesses.delete(guildId); }

    const seeking = seekPosition !== undefined && seekPosition > 0;
    const needsFfmpeg = seeking || session.volume !== 1;

    let resource;
    if (!needsFfmpeg) {
      // Lossless Opus passthrough — no transcode, no encoder.
      const stream = createReadStream(filePath);
      resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
    } else {
      // Seek and/or volume: let ffmpeg do the work in C and emit Ogg/Opus so we
      // never touch the (fragile, slow) JS Opus encoder. Copy packets when only
      // seeking; re-encode with libopus only when applying a non-unity volume.
      const args: string[] = [];
      if (seeking) args.push('-ss', String(seekPosition));
      args.push('-i', filePath);
      if (session.volume !== 1) {
        args.push('-af', `volume=${session.volume}`, '-c:a', 'libopus', '-b:a', '128k');
      } else {
        args.push('-c:a', 'copy');
      }
      args.push('-f', 'opus', '-loglevel', 'error', 'pipe:1');
      const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      ffmpegProcesses.set(guildId, ffmpeg);
      ffmpeg.on('error', (err) => console.error('FFmpeg error:', err));
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) console.error('FFmpeg:', msg);
      });
      resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
    }

    resources.set(guildId, resource);
    player.play(resource);
    session.isPlaying = true;
    const now = Date.now();
    playStartedAt.set(guildId, now);
    // Anchor the progress position at the seek target (or 0 for a fresh track).
    session.positionMs = (seekPosition ?? 0) * 1000;
    session.startedAtMs = now;
    return true;
  } catch (err) {
    console.error('Failed to play track:', err);
    return false;
  }
}
