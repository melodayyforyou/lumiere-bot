const { EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const config = require('./config');

const EPHEMERAL = MessageFlags.Ephemeral;
const ID_RE = /^\d{17,20}$/;

// Channel names in this server carry emoji prefixes ("📜 | announcement"),
// so match on the bare name after stripping everything but letters/digits/dashes.
const bare = (name) => name.toLowerCase().replace(/[^a-z0-9-]/g, '');

/**
 * Resolve a configured channel (ID or name). Returns { channel, error }.
 * Never guesses: two channels with the same name (e.g. two "general-chat")
 * is an error that tells the officer to use the ID instead.
 */
function resolveChannel(guild, ref) {
  if (!ref) return { channel: null, error: 'not configured' };
  if (ID_RE.test(ref)) {
    const channel = guild.channels.cache.get(ref);
    return channel ? { channel } : { channel: null, error: `no channel with ID ${ref}` };
  }
  const matches = guild.channels.cache.filter((c) => bare(c.name) === bare(ref));
  if (matches.size === 1) return { channel: matches.first() };
  if (matches.size > 1) {
    return { channel: null, error: `${matches.size} channels are named "${ref}" — put the channel ID in config.json instead` };
  }
  return { channel: null, error: `no channel named "${ref}"` };
}

function resolveRole(guild, ref) {
  if (!ref) return { role: null, error: 'not configured' };
  if (ID_RE.test(ref)) {
    const role = guild.roles.cache.get(ref);
    return role ? { role } : { role: null, error: `no role with ID ${ref}` };
  }
  const matches = guild.roles.cache.filter((r) => r.name.toLowerCase() === ref.toLowerCase());
  if (matches.size === 1) return { role: matches.first() };
  if (matches.size > 1) return { role: null, error: `${matches.size} roles are named "${ref}" — use the role ID` };
  return { role: null, error: `no role named "${ref}"` };
}

const channelOf = (guild, key) => resolveChannel(guild, config.channels[key]).channel;
const roleOf = (guild, ref) => resolveRole(guild, ref).role;

function isOfficer(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return config.roles.officers.some((ref) => {
    const role = roleOf(member.guild, ref);
    return role && member.roles.cache.has(role.id);
  });
}

async function requireOfficer(interaction) {
  if (isOfficer(interaction.member)) return true;
  await interaction.reply({ content: '🔒 Officers only.', flags: EPHEMERAL });
  return false;
}

function embed() {
  const e = new EmbedBuilder().setColor(config.legion.color);
  if (config.legion.logoUrl) e.setThumbnail(config.legion.logoUrl);
  return e.setFooter({ text: `${config.legion.name} • ${config.legion.game}` });
}

// Discord renders <t:unix:F> in each reader's own timezone.
function ts(date, style = 'F') {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

// Permissions the bot needs to post in a given channel type.
function postPerms(channel) {
  const base = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.EmbedLinks];
  if (channel.type === ChannelType.GuildForum) {
    return [...base, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads];
  }
  return [...base, PermissionFlagsBits.SendMessages];
}

module.exports = { EPHEMERAL, resolveChannel, resolveRole, channelOf, roleOf, isOfficer, requireOfficer, embed, ts, postPerms };
