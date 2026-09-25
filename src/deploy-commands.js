// Registers this bot's slash commands on the Lumiere server only.
// Non-destructive: it adds/updates OUR commands one by one and never
// removes commands it didn't create. Run after install and after changing
// command options:  npm run deploy
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in .env');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
(async () => {
  const existing = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
  const ours = new Set(commands.map((c) => c.command.name));
  const foreign = existing.filter((c) => !ours.has(c.name));
  if (foreign.length) {
    console.warn(`!! This application already has other commands here: ${foreign.map((c) => `/${c.name}`).join(' ')}`);
    console.warn('!! You are probably using the token of an existing bot. Lumiere Bot should be a NEW application.');
    console.warn('!! Leaving those commands untouched.');
  }
  for (const c of commands) {
    // POST with an existing name updates that command in place.
    await rest.post(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: c.command.toJSON() });
    console.log(`Registered /${c.command.name}`);
  }
})().catch((err) => { console.error(err); process.exit(1); });
