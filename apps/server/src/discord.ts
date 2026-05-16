import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, GuildMember, VoiceChannel, MessageFlags } from 'discord.js';
import { DISCORD_TOKEN, MUSIC_CONTROL_BASE_URL } from './env';
import { joinAndStartSession, leaveSession, getSession, PlayerState } from './music-player';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

async function setupCommands() {
  // Game command
  const gameCommand = new SlashCommandBuilder()
    .setName('game')
    .setDescription('DnD game commands')
    .setDMPermission(true)
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new game')
      .addStringOption(opt => opt
        .setName('type')
        .setDescription('Game type')
        .setRequired(true)
        .addChoices({ name: 'wordle', value: 'wordle' })
      )
      .addStringOption(opt => opt
        .setName('secret')
        .setDescription('The word/number to guess')
        .setRequired(true)
      )
      .addIntegerOption(opt => opt
        .setName('tries')
        .setDescription('Number of allowed guesses')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(20)
      )
    );

  // Music command
  const musicCommand = new SlashCommandBuilder()
    .setName('music')
    .setDescription('DnD session music controls')
    .setDMPermission(false)
    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('Start music in your current voice channel')
    )
    .addSubcommand(sub => sub
      .setName('stop')
      .setDescription('Stop music and leave voice channel')
    );

  // Register in every guild the bot is in (instant, no duplicate)
  for (const guild of client.guilds.cache.values()) {
    try {
      const existing = await guild.commands.fetch();
      if (!existing.find(c => c.name === 'game')) await guild.commands.create(gameCommand);
      if (!existing.find(c => c.name === 'music')) await guild.commands.create(musicCommand);
      console.log(`Registered commands in guild: ${guild.name}`);
    } catch (err) {
      console.error(`Failed to register in guild ${guild.name}:`, err);
    }
  }

  console.log('Slash commands registered');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await setupCommands();
});

// Register commands when joining a new guild
client.on('guildCreate', async (guild) => {
  try {
    const gameCommand = new SlashCommandBuilder()
      .setName('game')
      .setDescription('DnD game commands')
      .setDMPermission(true)
      .addSubcommand(sub => sub
        .setName('create')
        .setDescription('Create a new game')
        .addStringOption(opt => opt
          .setName('type')
          .setDescription('Game type')
          .setRequired(true)
          .addChoices({ name: 'wordle', value: 'wordle' })
        )
        .addStringOption(opt => opt
          .setName('secret')
          .setDescription('The word/number to guess')
          .setRequired(true)
        )
        .addIntegerOption(opt => opt
          .setName('tries')
          .setDescription('Number of allowed guesses')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20)
        )
      );

    const musicCommand = new SlashCommandBuilder()
      .setName('music')
      .setDescription('DnD session music controls')
      .setDMPermission(false)
      .addSubcommand(sub => sub
        .setName('start')
        .setDescription('Start music in your current voice channel')
      )
      .addSubcommand(sub => sub
        .setName('stop')
        .setDescription('Stop music and leave voice channel')
      );

    const existing = await guild.commands.fetch();
    if (!existing.find(c => c.name === 'game')) await guild.commands.create(gameCommand);
    if (!existing.find(c => c.name === 'music')) await guild.commands.create(musicCommand);
    console.log(`Registered commands in new guild: ${guild.name} (${guild.id})`);
  } catch (err) {
    console.error(`Failed to register commands in new guild ${guild.id}:`, err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'game') {
      await handleGameCommand(interaction);
    } else if (interaction.commandName === 'music') {
      await handleMusicCommand(interaction);
    }
  } catch (err) {
    console.error('Error handling interaction:', err instanceof Error ? err.message : err);
  }
});

async function handleGameCommand(interaction: any) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== 'create') return;

  // Defer immediately — gives us 15 min to respond (vs 3 sec without)
  await interaction.deferReply();

  const type = interaction.options.getString('type', true);
  const secret = interaction.options.getString('secret', true);
  const tries = interaction.options.getInteger('tries');

  try {
    const res = await fetch('http://localhost:3000/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, tries: tries ?? undefined })
    });

    if (!res.ok) {
      const text = await res.text();
      await interaction.editReply({ content: `Failed to create game: ${text}` });
      return;
    }

    const game = await res.json() as { id: string; url: string };

    const mode = /^\d+$/.test(secret) ? 'Numbers' : /^[a-zA-Z]+$/.test(secret) ? 'Letters' : 'Mixed';

    const embed = new EmbedBuilder()
      .setTitle('Wordle Game Created!')
      .setColor(0x57F287)
      .addFields(
        { name: 'Mode', value: mode, inline: true },
        { name: 'Tries', value: String(tries ?? 6), inline: true },
        { name: 'Link', value: `https://0x1763.dev${game.url}` }
      )
      .setFooter({ text: 'Share this link with your players!' });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: 'Failed to create game. Is the server running?' });
  }
}

async function handleMusicCommand(interaction: any) {
  const subcommand = interaction.options.getSubcommand();
  const member = interaction.member as GuildMember;

  if (subcommand === 'start') {
    await handleMusicStart(interaction, member);
  } else if (subcommand === 'stop') {
    await handleMusicStop(interaction, member);
  }
}

async function handleMusicStart(interaction: any, member: GuildMember) {
  // Check user is in voice first
  if (!member || !member.voice || !member.voice.channel) {
    await interaction.reply({ content: '❌ You must be in a voice channel to start music!', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const channel = member.voice.channel as VoiceChannel;

  // Check for existing session
  const existing = getSession(channel.guild.id);
  if (existing && existing.adminUserId !== member.id) {
    const adminMember = await channel.guild.members.fetch(existing.adminUserId).catch(() => null);
    if (adminMember && adminMember.voice.channelId === existing.voiceChannelId) {
      await interaction.reply({ content: '❌ Another admin is already controlling music. They must use `/music stop` first.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
  }

  // Reply immediately — this gives us 15 min to do the slow work
  await interaction.reply({ content: '🔌 Joining voice channel...', flags: MessageFlags.Ephemeral }).catch(() => {});

  try {
    const { token, state } = await joinAndStartSession(member, channel);

    const controlUrl = `${MUSIC_CONTROL_BASE_URL}/music?token=${token}`;

    const embed = new EmbedBuilder()
      .setTitle('🎵 Music Session Started')
      .setColor(0x57F287)
      .setDescription(`Joined **${channel.name}**`)
      .addFields(
        { name: 'Control Panel', value: controlUrl },
        { name: 'Controls', value: 'Use the link above to manage the queue, add tracks, and control playback.' }
      )
      .setFooter({ text: 'Use /music stop to end the session' });

    // Send ephemeral reply with the link
    await interaction.editReply({ embeds: [embed] }).catch(() => {});

    // Also send a public message that music has started
    await interaction.followUp({
      content: `🎵 Music session started by <@${member.id}> in **${channel.name}**!`,
    }).catch(() => {});
  } catch (err) {
    console.error('Failed to start music session:', err);
    await interaction.editReply({
      content: `❌ Failed to start music session: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }).catch(() => {});
  }
}

async function handleMusicStop(interaction: any, member: GuildMember) {
  const guildId = interaction.guildId as string;
  const session = getSession(guildId);

  if (!session) {
    await interaction.reply({ content: '❌ No active music session in this server.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const isAdmin = session.adminUserId === member.id;
  const isMod = member.permissions?.has('Administrator') || member.permissions?.has('ManageGuild');

  if (!isAdmin && !isMod) {
    await interaction.reply({ content: '❌ Only the session admin or server moderators can stop the music.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await interaction.reply({ content: '🛑 Leaving voice channel...', flags: MessageFlags.Ephemeral }).catch(() => {});

  try {
    await leaveSession(guildId);
    await interaction.editReply({
      content: '🛑 Music session ended. Left the voice channel.',
    }).catch(() => {});

    // Public notification
    await interaction.followUp({
      content: `🛑 Music session ended by <@${member.id}>.`,
    }).catch(() => {});
  } catch (err) {
    console.error('Failed to stop music session:', err);
    await interaction.editReply({
      content: '❌ Failed to stop music session.',
    }).catch(() => {});
  }
}

export function startBot() {
  if (!DISCORD_TOKEN) {
    console.warn('DISCORD_TOKEN not set, skipping bot login');
    return;
  }
  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Failed to login to Discord:', err);
  });
}
