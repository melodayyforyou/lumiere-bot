const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../config');
const { EPHEMERAL, channelOf, roleOf, isOfficer, embed, ts } = require('../util');

const CLASS_LIST = Object.keys(config.classRoles).join(' / ');
const COLORS = { pending: 0xf1c40f, accepted: 0x2ecc71, rejected: 0xe74c3c, hold: 0x3498db };

const FIELDS = [
  { id: 'ign', label: 'In-game name (or planned name)', style: TextInputStyle.Short, max: 40 },
  { id: 'class', label: 'Main class you plan to play', style: TextInputStyle.Short, max: 60, placeholder: CLASS_LIST.slice(0, 100) },
  { id: 'access', label: 'Early Access (Founder) or Oct 5 launch?', style: TextInputStyle.Short, max: 60, placeholder: 'e.g. Early Access, Founder\'s Pack bought' },
  { id: 'schedule', label: 'Timezone & usual play hours', style: TextInputStyle.Short, max: 100, placeholder: 'e.g. GMT+7, weekdays 20:00-01:00' },
  { id: 'about', label: 'MMO experience & why Lumiere?', style: TextInputStyle.Paragraph, max: 1000, placeholder: 'Played AION 1? Other MMOs? What do you want from the legion?' },
];

/** The panel members click in #registration. Posted with /post registration. */
function panel() {
  const e = embed()
    .setTitle(`📝 Apply to ${config.legion.name} for ${config.legion.game}`)
    .setDescription([
      `Early Access opens ${ts(config.dates.earlyAccess, config.dates.timeConfirmed ? 'F' : 'D')} (${ts(config.dates.earlyAccess, 'R')}).`,
      'Apply now so you\'re in the legion on day one.',
      '',
      '**How it works**',
      '1. Click **Apply** and fill in the short form (2 minutes).',
      '2. Officers review applications daily.',
      '3. You\'ll get a DM with the result. Keep DMs from server members open.',
      '4. Once accepted, pick your class in the roles channel.',
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('apply:start').setLabel('Apply').setEmoji('⚜️').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [e], components: [row] };
}

function hasRole(member, ref) {
  const role = roleOf(member.guild, ref);
  return role && member.roles.cache.has(role.id);
}

async function start(interaction) {
  if (hasRole(interaction.member, config.roles.member)) {
    return interaction.reply({ content: `You're already in ${config.legion.name}! ⚜️`, flags: EPHEMERAL });
  }
  if (hasRole(interaction.member, config.roles.applicant)) {
    return interaction.reply({ content: '⏳ Your application is already with the officers. You\'ll get a DM when it\'s reviewed.', flags: EPHEMERAL });
  }
  if (!channelOf(interaction.guild, 'applicationsReview')) {
    return interaction.reply({ content: '⚠️ Applications aren\'t set up yet. Please tell an officer.', flags: EPHEMERAL });
  }
  const modal = new ModalBuilder().setCustomId('apply:modal').setTitle(`${config.legion.name} application`);
  modal.addComponents(FIELDS.map((f) => {
    const input = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style)
      .setMaxLength(f.max).setRequired(true);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    return new ActionRowBuilder().addComponents(input);
  }));
  return interaction.showModal(modal);
}

function reviewButtons(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`apply:accept:${userId}`).setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`apply:hold:${userId}`).setLabel('Interview / Hold').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`apply:reject:${userId}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

async function submit(interaction) {
  const reviewChannel = channelOf(interaction.guild, 'applicationsReview');
  if (!reviewChannel) return interaction.reply({ content: '⚠️ Applications aren\'t set up yet. Please tell an officer.', flags: EPHEMERAL });

  const { user, member } = interaction;
  const e = embed()
    .setColor(COLORS.pending)
    .setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL() })
    .setTitle('New application: PENDING')
    .setDescription(`<@${user.id}> (${user.id})\nAccount created ${ts(user.createdAt, 'R')} • joined server ${ts(member.joinedAt, 'R')}`)
    .addFields(FIELDS.map((f) => ({ name: f.label, value: interaction.fields.getTextInputValue(f.id) || '-' })))
    .setTimestamp();

  await reviewChannel.send({ embeds: [e], components: [reviewButtons(user.id)], allowedMentions: { parse: [] } });

  const applicant = roleOf(interaction.guild, config.roles.applicant);
  if (applicant) await member.roles.add(applicant, 'Submitted legion application').catch(() => {});

  return interaction.reply({ content: '✅ Application sent! Officers will review it and you\'ll get a DM with the result.', flags: EPHEMERAL });
}

async function dm(user, text) {
  try { await user.send(text); return true; } catch { return false; }
}

/** Update the review card: new colour/status, decision line, buttons disabled when final. */
function markReviewed(message, userId, status, officer, reason) {
  const e = embed().setColor(COLORS[status]);
  const old = message.embeds[0];
  if (old.author) e.setAuthor({ name: old.author.name, iconURL: old.author.iconURL });
  e.setTitle(`Application: ${status.toUpperCase()}`).setDescription(old.description).setTimestamp(old.timestamp ? new Date(old.timestamp) : null);
  const fields = old.fields.filter((f) => f.name !== 'Decision');
  fields.push({ name: 'Decision', value: `${status} by <@${officer.id}> ${ts(new Date(), 'R')}${reason ? `\nReason: ${reason}` : ''}` });
  e.addFields(fields);
  return { embeds: [e], components: [reviewButtons(userId, status !== 'hold')] };
}

async function review(interaction, action, userId) {
  if (!isOfficer(interaction.member)) return interaction.reply({ content: '🔒 Officers only.', flags: EPHEMERAL });
  const guild = interaction.guild;

  if (action === 'reject') {
    const modal = new ModalBuilder().setCustomId(`apply:rejectmodal:${userId}`).setTitle('Reject application');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason (sent to the applicant)').setStyle(TextInputStyle.Paragraph)
        .setRequired(false).setMaxLength(500),
    ));
    return interaction.showModal(modal);
  }

  // DMs and role changes can take a moment; acknowledge the click first.
  await interaction.deferUpdate();
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return interaction.editReply(markReviewed(interaction.message, userId, 'rejected', interaction.user, 'Applicant left the server'));
  }

  if (action === 'hold') {
    await dm(member.user, `👋 A ${config.legion.name} officer wants to chat about your application. Watch your DMs or ping <@${interaction.user.id}>.`);
    return interaction.editReply(markReviewed(interaction.message, userId, 'hold', interaction.user));
  }

  // accept
  const memberRole = roleOf(guild, config.roles.member);
  const applicantRole = roleOf(guild, config.roles.applicant);
  try {
    if (memberRole) await member.roles.add(memberRole, `Application accepted by ${interaction.user.tag}`);
    if (applicantRole) await member.roles.remove(applicantRole, 'Application accepted');
  } catch (err) {
    return interaction.followUp({ content: `⚠️ Couldn't change roles: ${err.message}\nMy bot role must sit **above** the member/applicant roles in Server Settings → Roles.`, flags: EPHEMERAL });
  }
  const rolesChannel = channelOf(guild, 'legionRoles');
  const dmOk = await dm(member.user, `⚜️ Welcome to **${config.legion.name}**! Your application was accepted.${rolesChannel ? ` Pick your class in <#${rolesChannel.id}>.` : ''}`);
  const welcome = channelOf(guild, 'welcome');
  if (welcome) {
    await welcome.send({
      content: `⚜️ Welcome <@${member.id}> to **${config.legion.name}**!${rolesChannel ? ` Grab your class role in <#${rolesChannel.id}>.` : ''}`,
      allowedMentions: { users: [member.id] },
    }).catch(() => {});
  }
  const update = markReviewed(interaction.message, userId, 'accepted', interaction.user, dmOk ? null : '(could not DM the applicant: DMs closed)');
  return interaction.editReply(update);
}

async function rejectSubmit(interaction, userId) {
  if (!isOfficer(interaction.member)) return interaction.reply({ content: '🔒 Officers only.', flags: EPHEMERAL });
  const reason = interaction.fields.getTextInputValue('reason').trim();
  await interaction.deferUpdate();
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member) {
    const applicantRole = roleOf(interaction.guild, config.roles.applicant);
    if (applicantRole) await member.roles.remove(applicantRole, 'Application rejected').catch(() => {});
    await dm(member.user, `Thanks for applying to **${config.legion.name}**. Unfortunately we can't accept your application right now.${reason ? `\nReason: ${reason}` : ''}`);
  }
  return interaction.editReply(markReviewed(interaction.message, userId, 'rejected', interaction.user, reason || null));
}

module.exports = { panel, start, submit, review, rejectSubmit };
