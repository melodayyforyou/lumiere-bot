const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');
const { EPHEMERAL, resolveChannel, resolveRole, channelOf, roleOf, postPerms } = require('../util');

const P = PermissionFlagsBits;
const ID_RE = /^\d{17,20}$/;

const command = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Admins: check or prepare the bot for this server.')
  .setDefaultMemberPermissions(P.ManageGuild)
  .addSubcommand((s) => s.setName('check').setDescription('Read-only health check. Changes nothing.'))
  .addSubcommand((s) => s.setName('create-channels').setDescription('Create ONLY the missing timed-events and officer applications channels'))
  .addSubcommand((s) => s.setName('create-roles').setDescription('Create ONLY the missing roles named in config.json (no permissions)'));

const ok = (t) => `✅ ${t}`;
const bad = (t) => `❌ ${t}`;
const warn = (t) => `⚠️ ${t}`;

function check(guild) {
  const me = guild.members.me;
  const out = ['**Channels**'];
  for (const [key, ref] of Object.entries(config.channels)) {
    const { channel, error } = resolveChannel(guild, ref);
    if (!channel) { out.push(bad(`${key}: ${error}`)); continue; }
    const missing = channel.permissionsFor(me).missing(postPerms(channel));
    out.push(missing.length ? bad(`${key} → <#${channel.id}> missing: ${missing.join(', ')}`) : ok(`${key} → <#${channel.id}>`));
  }

  out.push('', '**Roles** (my top role must be above every role I hand out)');
  if (!me.permissions.has(P.ManageRoles)) out.push(bad('I don\'t have **Manage Roles**'));
  const top = me.roles.highest.position;
  const handOut = [
    ['member', config.roles.member], ['applicant', config.roles.applicant],
    ...(config.features.rolePanel ? [
      ...Object.entries(config.classRoles).map(([n, c]) => [n, c.role]),
      ...config.pingRoles.map((p) => [p.label, p.role]),
    ] : []),
  ];
  for (const [label, ref] of handOut) {
    if (!ref) continue;
    const { role, error } = resolveRole(guild, ref);
    if (!role) out.push(bad(`${label}: ${error}`));
    else if (role.position >= top) out.push(bad(`${label} → ${role} is ABOVE my role. Drag my role higher in Server Settings → Roles.`));
    else out.push(ok(`${label} → ${role}`));
  }
  for (const ref of config.roles.officers) {
    const { role, error } = resolveRole(guild, ref);
    out.push(role ? ok(`officer → ${role}`) : bad(`officer "${ref}": ${error}`));
  }

  out.push('', '**Extras**');
  out.push(me.permissions.has(P.ManageEvents) ? ok('Manage Events (Discord calendar events)') : warn('No Manage Events: /event still works, just not in Discord\'s Events calendar'));
  out.push(me.permissions.has(P.MentionEveryone) ? ok('Mention Everyone') : warn('No Mention Everyone: @everyone pings won\'t notify'));
  out.push(config.dates.timeConfirmed ? ok('Launch times confirmed') : warn('Launch times not confirmed: dates are shown without clock time'));
  return out.join('\n');
}

/** Copy the category's permission overwrites so a new channel matches its neighbours. */
function inherit(parent) {
  return parent ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })) : [];
}

function upsert(list, id, allow = [], deny = []) {
  const found = list.find((o) => o.id === id);
  const bits = (arr) => arr.reduce((a, b) => a | b, 0n);
  if (found) {
    found.allow = (BigInt(found.allow) | bits(allow)) & ~bits(deny);
    found.deny = (BigInt(found.deny) | bits(deny)) & ~bits(allow);
  } else list.push({ id, allow: bits(allow), deny: bits(deny) });
  return list;
}

async function createChannels(guild) {
  const me = guild.members.me;
  if (!me.permissions.has(P.ManageChannels)) return bad('I need **Manage Channels** for this (you can remove it again afterwards).');
  const anchor = channelOf(guild, 'announcements');
  const parent = anchor?.parent || null;
  const out = [];
  const botAllow = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];

  if (channelOf(guild, 'events')) out.push(ok('timed-events already exists: left untouched'));
  else if (!config.channels.events || ID_RE.test(config.channels.events)) out.push(warn('channels.events is empty or an ID that doesn\'t exist. Fix config.json first.'));
  else {
    const overwrites = upsert(inherit(parent), guild.roles.everyone.id, [], [P.SendMessages, P.CreatePublicThreads, P.AddReactions]);
    upsert(overwrites, me.id, botAllow);
    const ch = await guild.channels.create({
      name: `⏰｜${config.channels.events}`,
      type: ChannelType.GuildText,
      parent: parent?.id,
      topic: `Automatic ${config.legion.game} event reminders from the bot. Read-only.`,
      permissionOverwrites: overwrites,
      reason: '/setup create-channels',
    });
    if (anchor) await ch.setPosition(anchor.position + 1).catch(() => {});
    out.push(ok(`created ${ch} (read-only for members, same category as announcements)`));
  }

  if (channelOf(guild, 'applicationsReview')) out.push(ok('applications channel already exists: left untouched'));
  else if (!config.channels.applicationsReview || ID_RE.test(config.channels.applicationsReview)) out.push(warn('channels.applicationsReview is empty or a missing ID. Fix config.json first.'));
  else {
    const overwrites = upsert(inherit(parent), guild.roles.everyone.id, [], [P.ViewChannel]);
    upsert(overwrites, me.id, botAllow);
    for (const ref of config.roles.officers) {
      const role = roleOf(guild, ref);
      if (role) upsert(overwrites, role.id, [P.ViewChannel, P.SendMessages, P.ReadMessageHistory]);
    }
    const ch = await guild.channels.create({
      name: `🗂️｜${config.channels.applicationsReview}`,
      type: ChannelType.GuildText,
      parent: parent?.id,
      topic: 'Legion applications land here. Officers only.',
      permissionOverwrites: overwrites,
      reason: '/setup create-channels',
    });
    out.push(ok(`created ${ch} (hidden: only officers + admins can see it)`));
  }
  return out.join('\n');
}

async function createRoles(guild) {
  const me = guild.members.me;
  if (!me.permissions.has(P.ManageRoles)) return bad('I need **Manage Roles**.');
  const wanted = [
    [config.roles.member, null], [config.roles.applicant, null],
    // Class/ping roles belong to the existing bot's panel unless ours is switched on.
    ...(config.features.rolePanel ? [
      ...Object.values(config.classRoles).map((c) => [c.role, null]),
      ...config.pingRoles.map((p) => [p.role, null]),
    ] : []),
  ];
  const out = [];
  const seen = new Set();
  for (const [ref] of wanted) {
    if (!ref || ID_RE.test(ref) || seen.has(ref.toLowerCase())) continue;
    seen.add(ref.toLowerCase());
    if (roleOf(guild, ref)) { out.push(ok(`${ref} exists: left untouched`)); continue; }
    const role = await guild.roles.create({ name: ref, permissions: [], mentionable: false, reason: '/setup create-roles' });
    out.push(ok(`created ${role}`));
  }
  out.push('', 'New roles have **no permissions**. Give channel access to them yourself if needed.');
  return out.join('\n');
}

async function execute(interaction) {
  if (!interaction.member.permissions.has(P.ManageGuild)) {
    return interaction.reply({ content: '🔒 Server admins (Manage Server) only.', flags: EPHEMERAL });
  }
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: EPHEMERAL });
  let text;
  try {
    if (sub === 'check') text = check(interaction.guild);
    else if (sub === 'create-channels') text = await createChannels(interaction.guild);
    else text = await createRoles(interaction.guild);
  } catch (err) {
    text = bad(err.message);
  }
  return interaction.editReply({ content: text.slice(0, 1990), allowedMentions: { parse: [] } });
}

module.exports = { command, execute, check };
