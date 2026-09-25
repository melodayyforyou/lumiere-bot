const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, ChannelType,
} = require('discord.js');
const config = require('../config');
const templates = require('../../content/templates.json');
const { EPHEMERAL, channelOf, roleOf, requireOfficer, embed, ts, postPerms } = require('../util');

const TEMPLATE_NAMES = Object.keys(templates).filter((k) => !k.startsWith('_'));
const DRAFT_TTL_MS = 30 * 60 * 1000;
const drafts = new Map(); // key -> { channelId, ping, title, body, image, createdAt }

const command = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Officers: write an announcement, preview it, then post it.')
  .addStringOption((o) => o.setName('template').setDescription('Start from a pre-written announcement')
    .addChoices(...TEMPLATE_NAMES.map((n) => ({ name: n, value: n }))))
  .addStringOption((o) => o.setName('ping').setDescription('Who to notify (default: nobody)')
    .addChoices(
      { name: 'Nobody', value: 'none' },
      { name: 'Legion members role', value: 'member' },
      { name: '@here', value: 'here' },
      { name: '@everyone (whole server!)', value: 'everyone' },
    ))
  .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: announcement channel)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

function mentionOf(ref) {
  return ref && ref.id ? `<#${ref.id}>` : '#(not set up)';
}

/** Replace {placeholders} in template text with live dates and channel links. */
function fill(guild, text) {
  const d = config.dates;
  const style = d.timeConfirmed ? 'F' : 'D';
  const values = {
    legion: config.legion.name,
    ea: ts(d.earlyAccess, style),
    ea_relative: ts(d.earlyAccess, 'R'),
    launch: ts(d.launch, style),
    launch_relative: ts(d.launch, 'R'),
    registration: mentionOf(channelOf(guild, 'registration')),
    roles: mentionOf(channelOf(guild, 'legionRoles')),
    guides: mentionOf(channelOf(guild, 'guidebooks')),
    events: mentionOf(channelOf(guild, 'events')),
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

function pingContent(guild, ping) {
  if (ping === 'everyone') return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  if (ping === 'here') return { content: '@here', allowedMentions: { parse: ['everyone'] } };
  if (ping === 'member') {
    const role = roleOf(guild, config.roles.announcementPing);
    if (role) return { content: `<@&${role.id}>`, allowedMentions: { roles: [role.id] } };
  }
  return { allowedMentions: { parse: [] } };
}

function buildEmbed(draft) {
  const e = embed().setTitle(draft.title).setDescription(draft.body).setTimestamp();
  if (draft.image) e.setImage(draft.image);
  return e;
}

async function execute(interaction) {
  if (!(await requireOfficer(interaction))) return;
  const channel = interaction.options.getChannel('channel') || channelOf(interaction.guild, 'announcements');
  if (!channel) {
    return interaction.reply({ content: '⚠️ No announcement channel found. Check `channels.announcements` in config.json, or pick a channel.', flags: EPHEMERAL });
  }
  const tpl = templates[interaction.options.getString('template')] || { title: '', body: '' };
  const key = interaction.id;
  drafts.set(key, { channelId: channel.id, ping: interaction.options.getString('ping') || 'none', createdAt: Date.now() });

  const modal = new ModalBuilder().setCustomId(`announce:modal:${key}`).setTitle('New announcement');
  const title = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short)
    .setMaxLength(256).setRequired(true);
  const body = new TextInputBuilder().setCustomId('body').setLabel('Message').setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000).setRequired(true);
  const image = new TextInputBuilder().setCustomId('image').setLabel('Image URL (optional)')
    .setStyle(TextInputStyle.Short).setRequired(false);
  if (tpl.title) title.setValue(fill(interaction.guild, tpl.title).slice(0, 256));
  if (tpl.body) body.setValue(fill(interaction.guild, tpl.body).slice(0, 4000));
  modal.addComponents([title, body, image].map((i) => new ActionRowBuilder().addComponents(i)));
  return interaction.showModal(modal);
}

async function handleModal(interaction, key) {
  const draft = drafts.get(key);
  if (!draft) return interaction.reply({ content: '⌛ This draft expired. Run /announce again.', flags: EPHEMERAL });
  draft.title = interaction.fields.getTextInputValue('title');
  draft.body = interaction.fields.getTextInputValue('body');
  const image = interaction.fields.getTextInputValue('image').trim();
  draft.image = /^https?:\/\/\S+$/.test(image) ? image : null;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`announce:post:${key}`).setLabel('Post it').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`announce:cancel:${key}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const pingLabel = { none: 'no ping', member: 'legion role ping', here: '@here', everyone: '@everyone' }[draft.ping];
  return interaction.reply({
    content: `**Preview.** Nothing has been posted yet.\nWill post in <#${draft.channelId}> with **${pingLabel}**.`,
    embeds: [buildEmbed(draft)],
    components: [buttons],
    flags: EPHEMERAL,
  });
}

async function handleButton(interaction, action, key) {
  const draft = drafts.get(key);
  if (action === 'cancel' || !draft) {
    drafts.delete(key);
    return interaction.update({ content: draft ? '🗑️ Cancelled. Nothing was posted.' : '⌛ Draft expired.', embeds: [], components: [] });
  }
  const channel = interaction.guild.channels.cache.get(draft.channelId);
  const missing = channel && channel.permissionsFor(interaction.guild.members.me).missing(postPerms(channel));
  if (!channel || missing.length) {
    return interaction.update({ content: `⚠️ I can't post in <#${draft.channelId}>. Missing: ${missing ? missing.join(', ') : 'channel'}`, components: [] });
  }
  const msg = await channel.send({ ...pingContent(interaction.guild, draft.ping), embeds: [buildEmbed(draft)] });
  drafts.delete(key);
  return interaction.update({ content: `✅ Posted: ${msg.url}`, embeds: [], components: [] });
}

setInterval(() => {
  for (const [k, d] of drafts) if (Date.now() - d.createdAt > DRAFT_TTL_MS) drafts.delete(k);
}, 5 * 60 * 1000).unref();

module.exports = { command, execute, handleModal, handleButton, fill };
