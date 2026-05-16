import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';

const DATA_DIR = join(import.meta.dir, '../music');
const METADATA_FILE = join(DATA_DIR, 'metadata.json');

// Ensure data dir exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

export interface Track {
  id: string;
  title: string;
  url: string;
  duration: number;
  filename: string;
  category: string;
  addedAt: string; // ISO date
  favorite: boolean;
}

export interface Category {
  id: string;
  name: string;
  trackIds: string[];
}

export interface MusicLibrary {
  tracks: Track[];
  categories: Category[];
}

function loadLibrary(): MusicLibrary {
  try {
    if (existsSync(METADATA_FILE)) {
      const data = readFileSync(METADATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load music metadata, starting fresh:', err);
  }
  return { tracks: [], categories: [] };
}

function saveLibrary(lib: MusicLibrary): void {
  writeFileSync(METADATA_FILE, JSON.stringify(lib, null, 2), 'utf-8');
}

/** Get all tracks */
export function getAllTracks(): Track[] {
  return loadLibrary().tracks;
}

/** Get all categories */
export function getAllCategories(): Category[] {
  return loadLibrary().categories;
}

/** Get tracks in a category */
export function getTracksByCategory(categoryId: string): Track[] {
  const lib = loadLibrary();
  const cat = lib.categories.find(c => c.id === categoryId);
  if (!cat) return [];
  return cat.trackIds
    .map(id => lib.tracks.find(t => t.id === id))
    .filter((t): t is Track => !!t);
}

/** Get a single track by id */
export function getTrack(id: string): Track | undefined {
  return loadLibrary().tracks.find(t => t.id === id);
}

/** Add a track (from download) */
export function addTrack(track: Omit<Track, 'category' | 'addedAt' | 'favorite'> & { category?: string }): Track {
  const lib = loadLibrary();
  const newTrack: Track = {
    id: track.id,
    title: track.title,
    url: track.url,
    duration: track.duration,
    filename: track.filename,
    category: track.category || 'uncategorized',
    addedAt: new Date().toISOString(),
    favorite: false,
  };

  lib.tracks.push(newTrack);

  // Ensure the category exists
  let cat = lib.categories.find(c => c.name === newTrack.category);
  if (!cat) {
    cat = { id: nanoid(8), name: newTrack.category, trackIds: [] };
    lib.categories.push(cat);
  }
  if (!cat.trackIds.includes(newTrack.id)) {
    cat.trackIds.push(newTrack.id);
  }

  saveLibrary(lib);
  return newTrack;
}

/** Add multiple tracks (from playlist download) */
export function addTracks(
  tracks: Omit<Track, 'category' | 'addedAt'>[],
  categoryName: string
): Track[] {
  const lib = loadLibrary();
  const result: Track[] = [];

  let cat = lib.categories.find(c => c.name === categoryName);
  if (!cat) {
    cat = { id: nanoid(8), name: categoryName, trackIds: [] };
    lib.categories.push(cat);
  }

  for (const t of tracks) {
    const newTrack: Track = {
      ...t,
      category: categoryName,
      addedAt: new Date().toISOString(),
      favorite: false,
    };
    lib.tracks.push(newTrack);
    cat.trackIds.push(newTrack.id);
    result.push(newTrack);
  }

  saveLibrary(lib);
  return result;
}

/** Remove a track by id */
export function removeTrack(id: string): boolean {
  const lib = loadLibrary();
  const idx = lib.tracks.findIndex(t => t.id === id);
  if (idx === -1) return false;

  const [track] = lib.tracks.splice(idx, 1);

  // Remove from all categories
  for (const cat of lib.categories) {
    cat.trackIds = cat.trackIds.filter(tid => tid !== id);
  }

  // Remove empty categories
  lib.categories = lib.categories.filter(c => c.trackIds.length > 0);

  saveLibrary(lib);
  return true;
}

/** Rename a category */
export function renameCategory(categoryId: string, newName: string): boolean {
  const lib = loadLibrary();
  const cat = lib.categories.find(c => c.id === categoryId);
  if (!cat) return false;
  cat.name = newName;
  saveLibrary(lib);
  return true;
}

/** Delete a category (doesn't delete tracks) */
export function deleteCategory(categoryId: string): boolean {
  const lib = loadLibrary();
  const idx = lib.categories.findIndex(c => c.id === categoryId);
  if (idx === -1) return false;
  lib.categories.splice(idx, 1);
  saveLibrary(lib);
  return true;
}

/** Move track to a different category */
export function moveTrack(trackId: string, newCategory: string): boolean {
  const lib = loadLibrary();
  const track = lib.tracks.find(t => t.id === trackId);
  if (!track) return false;

  // Remove from old category
  for (const cat of lib.categories) {
    cat.trackIds = cat.trackIds.filter(tid => tid !== trackId);
  }

  track.category = newCategory;

  // Ensure new category exists
  let cat = lib.categories.find(c => c.name === newCategory);
  if (!cat) {
    cat = { id: nanoid(8), name: newCategory, trackIds: [] };
    lib.categories.push(cat);
  }
  cat.trackIds.push(trackId);

  // Remove empty categories
  lib.categories = lib.categories.filter(c => c.trackIds.length > 0);

  saveLibrary(lib);
  return true;
}

/** Toggle favorite status */
export function toggleFavorite(trackId: string): Track | undefined {
  const lib = loadLibrary();
  const track = lib.tracks.find(t => t.id === trackId);
  if (!track) return undefined;
  track.favorite = !track.favorite;
  saveLibrary(lib);
  return track;
}

/** Get all favorite tracks */
export function getFavoriteTracks(): Track[] {
  return loadLibrary().tracks.filter(t => t.favorite);
}

/** Create a new empty category */
export function createCategory(name: string): Category | undefined {
  if (!name.trim()) return undefined;
  const lib = loadLibrary();
  if (lib.categories.find(c => c.name === name.trim())) return undefined;
  const cat = { id: nanoid(8), name: name.trim(), trackIds: [] };
  lib.categories.push(cat);
  saveLibrary(lib);
  return cat;
}
