require('dotenv').config();
const { Client, Events, GatewayIntentBits } = require('discord.js');
const commands = require('./commands');
const announce = require('./features/announce');
const registration = require('./features/registration');
const roles = require('./features/roles');
const events = require('./features/events');
const setup = require('./features/setup');
const roster = require('./features/roster');
const { EPHEMERAL } = require('./util');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN or GUILD_ID in .env');
  process.exit(1);
}

// Only the Guilds intent: no message reading, no member list scraping.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const byName = new Map(commands.map((c) => [c.command.name, c]));

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const guild = c.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error(`Bot is not in server ${GUILD_ID}. Invite it first (see README).`);
    return;
  }
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.members.fetchMe();
  // Print the same report as /setup check so problems show up in the VPS logs too.
  console.log(setup.check(guild).replace(/<#(\d+)>/g, (m, id) => `#${guild.channels.cache.get(id)?.name || id}`)
    .replace(/<@&(\d+)>/g, (m, id) => `@${guild.roles.cache.get(id)?.name || id}`));
  events.startScheduler(c);
});

// Button/modal/select IDs look like "feature:action:arg".
async function route(interaction) {
  if (interaction.guildId !== GUILD_ID) return;

  if (interaction.isChatInputCommand()) {
    return byName.get(interaction.commandName)?.execute(interaction);
  }
  const [feature, action, arg] = (interaction.customId || '').split(':');

  if (interaction.isButton()) {
    if (feature === 'announce') return announce.handleButton(interaction, action, arg);
    if (feature === 'roster' && action === 'join') return roster.handleJoin(interaction);
    if (feature === 'apply' && action === 'start') return registration.start(interaction);
    if (feature === 'roles' && action === 'ping') return roles.togglePing(interaction, arg);
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'roles:class') {
    return roles.pickClass(interaction);
  }
  if (interaction.isModalSubmit()) {
    if (feature === 'announce') return announce.handleModal(interaction, arg);
    if (interaction.customId === 'apply:modal') return registration.submit(interaction);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await route(interaction);
  } catch (err) {
    console.error(`[${interaction.customId || interaction.commandName}]`, err);
    const msg = { content: `⚠️ Something went wrong: ${err.message}`, flags: EPHEMERAL };
    if (interaction.isRepliable()) {
      (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => {});
    }
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
client.login(DISCORD_TOKEN);
