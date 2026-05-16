import {
  joinVoiceChannel,
  VoiceConnection,
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
import { existsSync } from 'fs';
import { nanoid } from 'nanoid';
import { getTrack, Track, getAllTracks } from './music-store';

const MUSIC_DIR = join(import.meta.dir, '../music/tracks');

export interface QueueItem {
  trackId: string;
  title: string;
  duration: number;
  requestedBy: string;
}

export interface PlayerState {
  guildId: string;
  voiceChannelId: string;
  adminUserId: string;
  controlToken: string;
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number; // always 1.0
  loop: boolean;
  shuffle: boolean;
}

// Active sessions per guild
const sessions = new Map<string, PlayerState>();
const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();
const ffmpegProcesses = new Map<string, any>(); // guildId -> ChildProcess
let seekingGuildId: string | null = null; // suppress auto-advance during seeks
const controlTokens = new Map<string, string>(); // token -> guildId

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

  // Leave any existing session first
  await leaveSession(guildId);

  // Create connection
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // Wait for the connection to be ready (up to 15s)
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch {
    connection.destroy();
    throw new Error('Failed to join voice channel. Make sure the bot has Connect permission and the channel is accessible.');
  }

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
    },
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
    loop: false,
    shuffle: false,
  };

  sessions.set(guildId, state);
  connections.set(guildId, connection);
  players.set(guildId, player);

  // Handle voice state changes
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // Connection is dead, clean up
      cleanupSession(guildId);
    }
  });

  // Handle player state changes
  player.on(AudioPlayerStatus.Idle, () => {
    // Don't auto-advance or clean up ffmpeg ref if we're seeking
    if (seekingGuildId === guildId) {
      seekingGuildId = null;
      return;
    }
    ffmpegProcesses.delete(guildId);
    if (state.loop && state.currentIndex >= 0 && state.currentIndex < state.queue.length) {
      // Re-play the current track
      playTrackInSession(guildId, state.queue[state.currentIndex]);
    } else if (state.queue.length > 0) {
      playNext(guildId);
    } else {
      state.isPlaying = false;
    }
  });

  // Handle player errors
  player.on('error', (error) => {
    console.error(`Audio player error in guild ${guildId}:`, error);
    playNext(guildId);
  });

  return { token, state };
}

export async function leaveSession(guildId: string): Promise<void> {
  const player = players.get(guildId);
  if (player) {
    player.stop();
    players.delete(guildId);
  }

  const ffmpeg = ffmpegProcesses.get(guildId);
  if (ffmpeg) {
    ffmpeg.kill();
    ffmpegProcesses.delete(guildId);
  }

  const connection = connections.get(guildId);
  if (connection) {
    connection.destroy();
    connections.delete(guildId);
  }

  const session = sessions.get(guildId);
  if (session) {
    invalidateToken(session.controlToken);
    sessions.delete(guildId);
  }
}

function cleanupSession(guildId: string): void {
  players.delete(guildId);
  connections.delete(guildId);
  const session = sessions.get(guildId);
  if (session) {
    invalidateToken(session.controlToken);
    sessions.delete(guildId);
  }
}

export function setQueue(guildId: string, trackIds: string[]): void {
  const session = sessions.get(guildId);
  if (!session) return;

  session.queue = trackIds.map(id => {
    const track = getTrack(id);
    return {
      trackId: id,
      title: track?.title || 'Unknown Track',
      duration: track?.duration || 0,
      requestedBy: session.adminUserId,
    };
  });
  session.currentIndex = 0;
}

export function addToQueue(guildId: string, trackId: string): void {
  const session = sessions.get(guildId);
  if (!session) return;

  const track = getTrack(trackId);
  session.queue.push({
    trackId,
    title: track?.title || 'Unknown Track',
    duration: track?.duration || 0,
    requestedBy: session.adminUserId,
  });
}

export function clearQueue(guildId: string): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.queue = [];
  session.currentIndex = -1;
  session.isPlaying = false;

  const player = players.get(guildId);
  if (player) player.stop();
}

export function removeFromQueue(guildId: string, index: number): boolean {
  const session = sessions.get(guildId);
  if (!session || index < 0 || index >= session.queue.length) return false;
  session.queue.splice(index, 1);
  if (session.currentIndex >= index) {
    session.currentIndex--;
  }
  return true;
}

export function playTrackById(guildId: string, trackId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;

  // Find or add to queue
  const existingIdx = session.queue.findIndex(q => q.trackId === trackId);
  if (existingIdx >= 0) {
    session.currentIndex = existingIdx;
  } else {
    const track = getTrack(trackId);
    if (!track) return false;
    session.queue.push({
      trackId,
      title: track.title,
      duration: track.duration,
      requestedBy: session.adminUserId,
    });
    session.currentIndex = session.queue.length - 1;
  }

  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function playNext(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session || session.queue.length === 0) return false;

  if (session.shuffle) {
    // Pick random track
    const nextIdx = Math.floor(Math.random() * session.queue.length);
    session.currentIndex = nextIdx;
  } else {
    session.currentIndex++;
    if (session.currentIndex >= session.queue.length) {
      if (session.loop) {
        session.currentIndex = 0;
      } else {
        session.isPlaying = false;
        return false;
      }
    }
  }

  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function playPrevious(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session || session.queue.length === 0) return false;

  session.currentIndex--;
  if (session.currentIndex < 0) {
    session.currentIndex = session.queue.length - 1;
  }

  return playTrackInSession(guildId, session.queue[session.currentIndex]);
}

export function togglePlayPause(guildId: string): boolean {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  if (!session || !player) return false;

  if (player.state.status === AudioPlayerStatus.Playing) {
    player.pause();
    session.isPlaying = false;
  } else if (player.state.status === AudioPlayerStatus.Paused) {
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
  session.volume = Math.max(0, Math.min(1, volume));
}

export function setLoop(guildId: string, loop: boolean): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.loop = loop;
}

export function setShuffle(guildId: string, shuffle: boolean): void {
  const session = sessions.get(guildId);
  if (!session) return;
  session.shuffle = shuffle;
}

export function seek(guildId: string, position: number): boolean {
  const session = sessions.get(guildId);
  const player = players.get(guildId);
  if (!session || !player || session.queue.length === 0 || session.currentIndex < 0) return false;

  const ffmpeg = ffmpegProcesses.get(guildId);
  if (ffmpeg) {
    ffmpeg.kill();
    ffmpegProcesses.delete(guildId);
  }

  // Set flag — Idle handler will clear it and skip auto-advance
  seekingGuildId = guildId;

  // Don't call player.stop() — it fires Idle async. Just play the new resource.
  // player.play() replaces any currently playing resource.
  return playTrackInSession(guildId, session.queue[session.currentIndex], position);
}

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
    // Use ffmpeg to decode any audio to raw PCM for Discord
    const ffmpegArgs = [
      ...(seekPosition ? ['-ss', String(seekPosition)] : []),
      '-i', filePath,
      ...(seekPosition ? ['-noaccurate_seek'] : []),
      '-f', 's16le',          // raw PCM signed 16-bit little-endian
      '-ar', '48000',         // Discord's sample rate
      '-ac', '2',             // stereo
      '-loglevel', 'error',
      'pipe:1',
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    ffmpegProcesses.set(guildId, ffmpeg);

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });

    resource.volume?.setVolume(session.volume);

    player.play(resource);
    session.isPlaying = true;

    ffmpeg.on('error', (err) => {
      console.error('FFmpeg error:', err);
    });

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) console.error('FFmpeg:', msg);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) console.error(`FFmpeg exited with code ${code}`);
    });

    return true;
  } catch (err) {
    console.error('Failed to play track:', err);
    return false;
  }
}
