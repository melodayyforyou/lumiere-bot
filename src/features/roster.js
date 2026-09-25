const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const store = require('../store');
const { EPHEMERAL, roleOf, requireOfficer, embed, ts } = require('../util');

// One-click recruitment: a "Join" button on the recruitment announcement.
// Clicking it gives the member role, saves the person in data/roster.json and
// rewrites the roster list on the announcement itself so everyone sees it grow.

const FIELD_TITLE = '⚜️ Roster';
const MAX_EMBED_CHARS = 5800;   // Discord allows 6000 for the whole embed
const MAX_FIELD_CHARS = 1000;   // Discord allows 1024 per field
const MAX_FIELDS = 20;          // Discord allows 25; keep a few spare

function load() {
  return store.load('roster', { members: [], messages: [] });
}
function save(data) {
  store.save('roster', data);
}

/** The Join button row. `disabled` is used for the preview so nobody clicks it there. */
function joinRow(count = 0, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('roster:join').setLabel(`Join ${config.legion.name}`).setEmoji('⚜️')
      .setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('roster:count').setLabel(`${count} joined`).setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}

/** Rebuild an announcement embed with the current roster list appended as fields. */
function withRoster(sourceEmbed, members) {
  const e = EmbedBuilder.from(sourceEmbed);
  const fields = (e.data.fields || []).filter((f) => !f.name.startsWith(FIELD_TITLE));
  // Discord counts the text of title, description, footer, author and every field name/value.
  const d = e.data;
  const baseChars = [d.title, d.description, d.footer?.text, d.author?.name, ...fields.flatMap((f) => [f.name, f.value])]
    .reduce((n, s) => n + (s ? s.length : 0), 0);
  const headerChars = (MAX_FIELDS + 1) * (FIELD_TITLE.length + 20); // room for every field header + "…and N more"
  const budget = MAX_EMBED_CHARS - baseChars - headerChars;

  const chunks = [];
  let current = [];
  let currentLen = 0;
  let used = 0;
  let shown = 0;
  for (const m of members) {
    const line = `${shown + 1}. ${m.name}`;
    if (chunks.length >= MAX_FIELDS || used + line.length + 1 > budget) break;
    if (currentLen + line.length + 1 > MAX_FIELD_CHARS) {
      chunks.push(current); current = []; currentLen = 0;
    }
    current.push(line); currentLen += line.length + 1; used += line.length + 1; shown++;
  }
  if (current.length) chunks.push(current);

  const header = `${FIELD_TITLE} (${members.length})`;
  if (!members.length) {
    fields.push({ name: header, value: '_Nobody yet. Be the first!_' });
  } else {
    chunks.forEach((lines, i) => fields.push({ name: i === 0 ? header : `${FIELD_TITLE} (continued)`, value: lines.join('\n') }));
    if (shown < members.length) fields.push({ name: `${FIELD_TITLE} (continued)`, value: `…and ${members.length - shown} more` });
  }
  return e.setFields(fields);
}

/** Called by /announce after it posts an announcement that carries the Join button. */
function register(message) {
  const data = load();
  if (!data.messages.some((m) => m.messageId === message.id)) {
    data.messages.push({ channelId: message.channelId, messageId: message.id });
    save(data);
  }
}

/** Refresh the roster list on every announcement that carries the button. */
async function refreshMessages(guild, data) {
  const keep = [];
  for (const ref of data.messages) {
    try {
      const channel = guild.channels.cache.get(ref.channelId);
      const msg = await channel.messages.fetch(ref.messageId);
      await msg.edit({ embeds: [withRoster(msg.embeds[0], data.members)], components: [joinRow(data.members.length)], allowedMentions: { parse: [] } });
      keep.push(ref);
    } catch {
      // The announcement was deleted; forget it so we stop trying.
    }
  }
  data.messages = keep;
}

async function handleJoin(interaction) {
  const data = load();
  const { member, user } = interaction;
  if (data.members.some((m) => m.id === user.id)) {
    return interaction.reply({ content: `You're already on the ${config.legion.name} roster! ⚜️`, flags: EPHEMERAL });
  }

  // Give the member role first. If it fails the click is still recorded, and the log says why.
  const role = roleOf(interaction.guild, config.roles.member);
  let roleNote = '';
  if (role && !member.roles.cache.has(role.id)) {
    await member.roles.add(role, `Joined ${config.legion.name} via the recruitment announcement`)
      .catch((err) => { roleNote = ` (I couldn't give you the ${role.name} role: ${err.message})`; console.error('[roster] role add failed', err.message); });
  }

  data.members.push({ id: user.id, name: member.displayName, at: new Date().toISOString() });
  register(interaction.message);
  save(data);

  // Rewrite the announcement the button sits on, then any other copies.
  await interaction.update({ embeds: [withRoster(interaction.message.embeds[0], data.members)], components: [joinRow(data.members.length)], allowedMentions: { parse: [] } });
  const others = { ...data, messages: data.messages.filter((m) => m.messageId !== interaction.message.id) };
  await refreshMessages(interaction.guild, others);
  data.messages = [...others.messages, { channelId: interaction.message.channelId, messageId: interaction.message.id }];
  save(data);

  return interaction.followUp({ content: `⚜️ Welcome to ${config.legion.name}! You're #${data.members.length} on the roster.${roleNote}`, flags: EPHEMERAL });
}

const command = new SlashCommandBuilder()
  .setName('roster')
  .setDescription('Officers: see or edit who clicked Join on the recruitment announcement.')
  .addSubcommand((s) => s.setName('list').setDescription('Show the roster with join times (only you see it)'))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove someone from the roster (does not remove their role)')
    .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)));

async function execute(interaction) {
  if (!(await requireOfficer(interaction))) return;
  const data = load();
  const sub = interaction.options.getSubcommand();

  if (sub === 'remove') {
    const target = interaction.options.getUser('user');
    const before = data.members.length;
    data.members = data.members.filter((m) => m.id !== target.id);
    if (data.members.length === before) return interaction.reply({ content: `${target.username} isn't on the roster.`, flags: EPHEMERAL });
    save(data);
    await interaction.deferReply({ flags: EPHEMERAL });
    await refreshMessages(interaction.guild, data);
    save(data);
    return interaction.editReply(`🗑️ Removed **${target.username}**. ${data.members.length} left on the roster. Their role was not touched.`);
  }

  if (!data.members.length) return interaction.reply({ content: 'Nobody has joined yet.', flags: EPHEMERAL });
  const lines = data.members.map((m, i) => `${i + 1}. <@${m.id}> — ${m.name} — joined ${ts(m.at, 'R')}`);
  const pages = [];
  let page = '';
  for (const l of lines) {
    if (page.length + l.length + 1 > 3900) { pages.push(page); page = ''; }
    page += `${l}\n`;
  }
  if (page) pages.push(page);
  const embeds = pages.slice(0, 10).map((p, i) => embed()
    .setTitle(i === 0 ? `${FIELD_TITLE} (${data.members.length})` : `${FIELD_TITLE} (continued)`)
    .setDescription(p));
  return interaction.reply({ embeds, flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

module.exports = { command, execute, handleJoin, joinRow, withRoster, register, load };
