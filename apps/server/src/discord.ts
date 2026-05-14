import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { DISCORD_TOKEN } from './env';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const command = new SlashCommandBuilder()
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

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // Register globally for future guilds (takes up to 1h)
  await client.application?.commands.create(command);

  // Also register in every guild the bot is in (instant)
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.create(command);
      console.log(`Registered in guild: ${guild.name}`);
    } catch (err) {
      console.error(`Failed to register in guild ${guild.name}:`, err);
    }
  }

  console.log('Slash commands registered');
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'game') return;

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
});

export function startBot() {
  if (!DISCORD_TOKEN) {
    console.warn('DISCORD_TOKEN not set, skipping bot login');
    return;
  }
  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Failed to login to Discord:', err);
  });
}
