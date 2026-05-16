export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const MUSIC_CONTROL_BASE_URL = process.env.MUSIC_CONTROL_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`;
export const GAME_BASE_URL = process.env.GAME_BASE_URL || `http://localhost:${process.env.PORT || '3000'}`;
