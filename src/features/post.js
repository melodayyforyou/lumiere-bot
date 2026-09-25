const { SlashCommandBuilder } = require('discord.js');
const { EPHEMERAL, channelOf, requireOfficer, postPerms } = require('../util');
const registration = require('./registration');
const roles = require('./roles');
const guides = require('./guides');
const events = require('./events');
const config = require('../config');

// Which configured channel each panel goes to.
const TARGETS = {
  registration: 'registration',
  roles: 'legionRoles',
  guides: 'guidebooks',
  countdown: 'events',
};

const command = new SlashCommandBuilder()
  .setName('post')
  .setDescription('Officers: post a bot panel into its channel.')
  .addStringOption((o) => o.setName('panel').setDescription('Which panel').setRequired(true).addChoices(
    { name: 'Registration (Apply button)', value: 'registration' },
    { name: 'Legion roles (class + ping picker)', value: 'roles' },
    { name: 'Guide library (updates the existing post)', value: 'guides' },
    { name: 'Launch countdown (right now)', value: 'countdown' },
  ));

async function execute(interaction) {
  if (!(await requireOfficer(interaction))) return;
  const panel = interaction.options.getString('panel');
  if (panel === 'roles' && !config.features.rolePanel) {
    return interaction.reply({ content: 'ℹ️ The role panel is off because your existing bot already handles class roles in #legion-roles. Set `features.rolePanel` to true in config.json to turn it on.', flags: EPHEMERAL });
  }
  const key = TARGETS[panel];
  const channel = channelOf(interaction.guild, key);
  if (!channel) {
    return interaction.reply({ content: `⚠️ Can't find the \`${key}\` channel. Run \`/setup check\`.`, flags: EPHEMERAL });
  }
  const missing = channel.permissionsFor(interaction.guild.members.me).missing(postPerms(channel));
  if (missing.length) {
    return interaction.reply({ content: `⚠️ I can't post in <#${channel.id}>. Missing: ${missing.join(', ')}`, flags: EPHEMERAL });
  }
  await interaction.deferReply({ flags: EPHEMERAL });

  if (panel === 'guides') {
    const res = await guides.publish(channel, interaction.client.user.id);
    return interaction.editReply(`${res.updated ? '🔄 Updated' : '✅ Posted'} the guide library: ${res.url}`);
  }
  let payload;
  if (panel === 'registration') payload = registration.panel();
  else if (panel === 'roles') payload = roles.panel();
  else payload = { embeds: [events.countdownEmbed(interaction.guild, events.localDate(new Date(), config.timezone))] };
  const msg = await channel.send({ ...payload, allowedMentions: { parse: [] } });
  return interaction.editReply(`✅ Posted: ${msg.url}`);
}

module.exports = { command, execute };
