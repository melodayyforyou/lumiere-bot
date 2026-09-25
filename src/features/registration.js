const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const config = require('../config');
const store = require('../store');
const { EPHEMERAL, channelOf, roleOf, embed, ts } = require('../util');

// Character registration: no approval step. A member clicks "Register my
// character", fills in a short form, and the bot files a card in the records
// channel (config.channels.applicationsReview) for officers. Re-registering
// updates the same card instead of making a new one.

const CLASS_LIST = Object.keys(config.classRoles).join(' / ');

const FIELDS = [
  { id: 'ign', label: 'In-game name (or the one you plan to use)', style: TextInputStyle.Short, max: 40 },
  { id: 'class', label: 'Main class', style: TextInputStyle.Short, max: 60, placeholder: CLASS_LIST.slice(0, 100) },
  { id: 'access', label: 'Early Access (Founder) or Oct 5 launch?', style: TextInputStyle.Short, max: 60, placeholder: 'e.g. Early Access, Founder\'s Pack bought' },
  { id: 'schedule', label: 'Timezone & usual play hours', style: TextInputStyle.Short, max: 100, placeholder: 'e.g. GMT+7, weekdays 20:00-01:00' },
  { id: 'notes', label: 'About you (optional)', style: TextInputStyle.Paragraph, max: 1500, required: false, placeholder: 'Veteran of AION 1 / AION2 KR-TW? Alt classes? Looking for a static? PvP or PvE? Say hi.' },
];

const load = () => store.load('characters', {});   // { userId: { ...answers, name, at, messageId } }
const save = (d) => store.save('characters', d);

/** The panel members click in #registration. Posted with /post registration. */
function panel() {
  const e = embed()
    .setTitle(`📝 Register your ${config.legion.game} character`)
    .setDescription([
      `Joined ${config.legion.name}? Now tell us who you'll be in Atreia.`,
      '',
      '**Why bother?** So on launch night the officers can sort parties, spot missing healers and know who\'s online when. Takes 60 seconds. No approval, no waiting.',
      '',
      '**What we ask**',
      '🏷️ Your in-game name',
      '⚔️ Your main class',
      '🎟️ Early Access or launch day',
      '🕒 Timezone and when you usually play',
      '',
      `Early Access opens ${ts(config.dates.earlyAccess, 'R')}. Changed your mind about your class? Click again and your record updates.`,
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('apply:start').setLabel('Register my character').setEmoji('📝').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [e], components: [row] };
}

async function start(interaction) {
  if (!channelOf(interaction.guild, 'applicationsReview')) {
    return interaction.reply({ content: '⚠️ Registration isn\'t set up yet. Please tell an officer.', flags: EPHEMERAL });
  }
  const existing = load()[interaction.user.id];
  const modal = new ModalBuilder().setCustomId('apply:modal').setTitle(existing ? 'Update your character' : `${config.legion.name} character`);
  modal.addComponents(FIELDS.map((f) => {
    const input = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style)
      .setMaxLength(f.max).setRequired(f.required !== false);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    if (existing && existing[f.id]) input.setValue(String(existing[f.id]).slice(0, f.max)); // pre-fill on update
    return new ActionRowBuilder().addComponents(input);
  }));
  return interaction.showModal(modal);
}

function card(user, member, record, updated) {
  return embed()
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTitle(`${updated ? '🔄 Updated' : '🆕 New'} character: ${record.ign}`)
    .setDescription(`<@${user.id}> • joined server ${ts(member.joinedAt, 'R')}`)
    .addFields(FIELDS.filter((f) => record[f.id]).map((f) => ({ name: f.label.replace(' (optional)', ''), value: record[f.id], inline: f.id !== 'notes' })))
    .setTimestamp();
}

async function submit(interaction) {
  const records = channelOf(interaction.guild, 'applicationsReview');
  if (!records) return interaction.reply({ content: '⚠️ Registration isn\'t set up yet. Please tell an officer.', flags: EPHEMERAL });

  const { user, member } = interaction;
  const all = load();
  const previous = all[user.id];
  const record = { name: member.displayName, at: new Date().toISOString(), messageId: previous?.messageId || null };
  for (const f of FIELDS) record[f.id] = interaction.fields.getTextInputValue(f.id).trim();

  // Registering counts as joining: hand out the member role if they don't have it yet.
  const role = roleOf(interaction.guild, config.roles.member);
  if (role && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Registered a character').catch((e) => console.error('[registration] role add', e.message));

  const payload = { embeds: [card(user, member, record, Boolean(previous))], allowedMentions: { parse: [] } };
  let msg = null;
  if (previous?.messageId) msg = await records.messages.fetch(previous.messageId).then((m) => m.edit(payload)).catch(() => null);
  if (!msg) msg = await records.send(payload);
  record.messageId = msg.id;
  all[user.id] = record;
  save(all);

  const cls = record.class ? ` A **${record.class}** named **${record.ign}**.` : '';
  const line = previous ? `🔄 Record updated.${cls} Officers have the new version.` : `📝 Registered!${cls} The officers can see you now. Wings up on launch night. ⚜️`;
  await interaction.reply({ content: line, flags: EPHEMERAL });

  // Public shout-out in the same channel so #registration feels alive. Names are shown, nobody is pinged.
  const total = Object.keys(all).length;
  await interaction.channel?.send({ content: shoutOut(user.id, record, total, Boolean(previous)), embeds: [publicCard(user, record)], allowedMentions: { parse: [] } }).catch(() => {});
}

/** The profile everyone sees in #registration (same info as the officer card, friendlier layout). */
function publicCard(user, record) {
  const e = embed()
    .setAuthor({ name: record.ign, iconURL: user.displayAvatarURL() })
    .addFields(
      { name: '⚔️ Class', value: record.class || '-', inline: true },
      { name: '🎟️ Playing from', value: record.access || '-', inline: true },
      { name: '🕒 Online', value: record.schedule || '-', inline: true },
    );
  if (record.notes) e.setDescription(record.notes.slice(0, 1500));
  return e;
}

/** Pick a class emoji from config.classRoles by loose name match, else a generic one. */
function classEmoji(name) {
  const key = Object.keys(config.classRoles).find((k) => String(name).toLowerCase().includes(k.toLowerCase()));
  return key ? config.classRoles[key].emoji : '⚔️';
}

const SHOUTS = [
  (who, what) => `${what} ${who} just enlisted as a **{class}**. Atreia trembles.`,
  (who, what) => `${what} A wild **{class}** appeared: ${who} is on the books.`,
  (who, what) => `${what} ${who} locked in **{class}**. Bold choice. We respect it.`,
  (who, what) => `${what} ${who} registered a **{class}**. The roster gets stronger.`,
  (who, what) => `${what} Welcome ${who}, our newest **{class}**. Someone tell the healers.`,
];

function shoutOut(userId, record, total, updated) {
  const who = `<@${userId}>`;
  const what = classEmoji(record.class);
  const cls = record.class || 'mystery class';
  if (updated) return `🔄 ${who} switched things up: now playing **${cls}** as **${record.ign}**.`;
  const pick = SHOUTS[total % SHOUTS.length](who, what).replace('{class}', cls);
  const milestone = total % 10 === 0 ? ` 🎉 That's **${total}** Daevas registered!` : ` (${total} registered)`;
  return `${pick}${milestone}`;
}

module.exports = { panel, start, submit, load };
