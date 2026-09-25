const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('../config');
const { EPHEMERAL, roleOf, embed } = require('../util');

const CLASSES = Object.entries(config.classRoles);
const NONE = '__none__';

/** The self-service panel in #legion-roles. Posted with /post roles. */
function panel() {
  const e = embed()
    .setTitle('🔖 Legion roles')
    .setDescription([
      '**Main class:** pick from the menu. Choosing a new one replaces the old one.',
      '**Pings:** click a button to switch that notification on or off.',
      '',
      ...CLASSES.map(([name, c]) => `${c.emoji} **${name}**: ${c.position}`),
    ].join('\n'));

  const select = new StringSelectMenuBuilder()
    .setCustomId('roles:class')
    .setPlaceholder('Choose your main class')
    .addOptions(
      ...CLASSES.map(([name, c]) => ({ label: name, value: name, description: c.position, emoji: c.emoji })),
      { label: 'Remove my class role', value: NONE, emoji: '✖️' },
    );
  const rows = [new ActionRowBuilder().addComponents(select)];

  const buttons = config.pingRoles.slice(0, 5).map((p, i) => new ButtonBuilder()
    .setCustomId(`roles:ping:${i}`).setLabel(p.label).setEmoji(p.emoji).setStyle(ButtonStyle.Secondary));
  if (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons));
  return { embeds: [e], components: rows };
}

function friendlyError(err) {
  return `⚠️ I couldn't change your roles (${err.message}). An officer needs to move my bot role above the class/ping roles.`;
}

async function pickClass(interaction) {
  const choice = interaction.values[0];
  const member = interaction.member;
  const all = CLASSES.map(([, c]) => roleOf(interaction.guild, c.role)).filter(Boolean);
  const target = choice === NONE ? null : roleOf(interaction.guild, config.classRoles[choice]?.role);
  if (choice !== NONE && !target) {
    return interaction.reply({ content: `⚠️ The ${choice} role doesn't exist yet. Please tell an officer.`, flags: EPHEMERAL });
  }
  const toRemove = all.filter((r) => r.id !== target?.id && member.roles.cache.has(r.id));
  try {
    if (toRemove.length) await member.roles.remove(toRemove, 'Class role change');
    if (target && !member.roles.cache.has(target.id)) await member.roles.add(target, 'Class role pick');
  } catch (err) {
    return interaction.reply({ content: friendlyError(err), flags: EPHEMERAL });
  }
  const c = config.classRoles[choice];
  return interaction.reply({
    content: target ? `${c.emoji} You're now a **${choice}** (${c.position}).` : 'Class role removed.',
    flags: EPHEMERAL,
  });
}

async function togglePing(interaction, index) {
  const ping = config.pingRoles[Number(index)];
  const role = ping && roleOf(interaction.guild, ping.role);
  if (!role) return interaction.reply({ content: '⚠️ That role doesn\'t exist yet. Please tell an officer.', flags: EPHEMERAL });
  const has = interaction.member.roles.cache.has(role.id);
  try {
    if (has) await interaction.member.roles.remove(role, 'Ping role toggle');
    else await interaction.member.roles.add(role, 'Ping role toggle');
  } catch (err) {
    return interaction.reply({ content: friendlyError(err), flags: EPHEMERAL });
  }
  return interaction.reply({ content: has ? `🔕 ${ping.label} off.` : `🔔 ${ping.label} on.`, flags: EPHEMERAL });
}

module.exports = { panel, pickClass, togglePing };
