const {
  SlashCommandBuilder, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const config = require('../config');
const store = require('../store');
const { parseLocal, nextOccurrence, zonedToUtc } = require('../time');
const { EPHEMERAL, channelOf, roleOf, requireOfficer, embed, ts, postPerms } = require('../util');

const cfg = config.events || {};
const DEFAULT_REMINDERS = cfg.defaultReminders || [60, 15, 0];
const GRACE_MS = (cfg.lateGraceMinutes ?? 15) * 60000;

// data/events.json -> { nextId, events: [...], lastCountdown: "YYYY-MM-DD" }
let state = store.load('events', { nextId: 1, events: [], lastCountdown: null });
const persist = () => store.save('events', state);

const command = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Officers: timed announcements that the bot posts automatically.')
  .addSubcommand((s) => s.setName('create').setDescription('Schedule an event with automatic reminders')
    .addStringOption((o) => o.setName('title').setDescription('e.g. Legion meet-up, Ludra run').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD, e.g. 2026-09-30').setRequired(true))
    .addStringOption((o) => o.setName('time').setDescription(`HH:MM, 24h, in ${config.timezone} unless you set timezone`).setRequired(true))
    .addStringOption((o) => o.setName('details').setDescription('What, where, what to bring').setMaxLength(1000))
    .addStringOption((o) => o.setName('repeat').setDescription('Repeat the event (default: once)')
      .addChoices({ name: 'Once', value: 'none' }, { name: 'Every day', value: 'daily' }, { name: 'Every week', value: 'weekly' }))
    .addStringOption((o) => o.setName('reminders').setDescription(`Minutes before start, comma separated (default ${DEFAULT_REMINDERS.join(',')})`))
    .addRoleOption((o) => o.setName('ping_role').setDescription('Role to ping in each reminder (e.g. Raid Ping)'))
    .addBooleanOption((o) => o.setName('ping_everyone').setDescription('Ping @everyone instead (use sparingly)'))
    .addStringOption((o) => o.setName('timezone').setDescription('IANA name, e.g. Europe/Berlin, America/New_York')))
  .addSubcommand((s) => s.setName('list').setDescription('Show upcoming scheduled events'))
  .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a scheduled event')
    .addIntegerOption((o) => o.setName('id').setDescription('Event number from /event list').setRequired(true)));

function parseReminders(text) {
  if (!text) return DEFAULT_REMINDERS;
  const mins = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (mins.some((m) => !Number.isInteger(m) || m < 0 || m > 10080)) return null;
  return [...new Set(mins)].sort((a, b) => b - a);
}

function describe(ev) {
  const repeat = ev.repeat ? ` • repeats ${ev.repeat.days.length ? 'weekly' : 'daily'} at ${ev.repeat.time} ${ev.repeat.timezone}` : '';
  return `**#${ev.id} ${ev.title}**: ${ts(ev.startsAt, 'F')} (${ts(ev.startsAt, 'R')})${repeat}\nreminders: ${ev.reminders.map((m) => (m ? `${m}m` : 'start')).join(', ')}`;
}

async function create(interaction) {
  const o = interaction.options;
  const timezone = o.getString('timezone') || config.timezone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch {
    return interaction.reply({ content: `⚠️ "${timezone}" isn't a timezone I know. Try Asia/Jakarta or Europe/Berlin.`, flags: EPHEMERAL });
  }
  const startsAt = parseLocal(o.getString('date'), o.getString('time'), timezone);
  if (!startsAt) return interaction.reply({ content: '⚠️ Use date `YYYY-MM-DD` and time `HH:MM` (24h), e.g. `2026-09-30` + `20:00`.', flags: EPHEMERAL });
  if (startsAt <= new Date()) return interaction.reply({ content: `⚠️ That time (${ts(startsAt, 'F')}) is in the past.`, flags: EPHEMERAL });
  const reminders = parseReminders(o.getString('reminders'));
  if (!reminders) return interaction.reply({ content: '⚠️ Reminders must be minutes like `1440,60,15,0`.', flags: EPHEMERAL });
  if (!channelOf(interaction.guild, 'events')) {
    return interaction.reply({ content: '⚠️ No timed-events channel yet. An admin can run `/setup create-channels`.', flags: EPHEMERAL });
  }

  const repeatMode = o.getString('repeat') || 'none';
  const time = o.getString('time').trim().replace('.', ':').padStart(5, '0');
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .indexOf(new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(startsAt));
  const ev = {
    id: state.nextId++,
    title: o.getString('title'),
    details: o.getString('details') || '',
    startsAt: startsAt.toISOString(),
    reminders,
    // Reminders whose moment already passed (e.g. "60 min before" on an event 10 min away) are skipped.
    sent: reminders.filter((m) => startsAt.getTime() - m * 60000 <= Date.now()),
    ping: o.getBoolean('ping_everyone') ? 'everyone' : (o.getRole('ping_role')?.id || null),
    repeat: repeatMode === 'none' ? null : { days: repeatMode === 'weekly' ? [weekday] : [], time, timezone },
    createdBy: interaction.user.id,
    discordEventId: null,
  };

  // One-off events also appear in Discord's own Events calendar (top of the channel list).
  let note = '';
  if (cfg.createDiscordEvents && !ev.repeat) {
    try {
      const se = await interaction.guild.scheduledEvents.create({
        name: ev.title,
        scheduledStartTime: startsAt,
        scheduledEndTime: new Date(startsAt.getTime() + 60 * 60000),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: `${config.legion.game}: in game` },
        description: ev.details || undefined,
      });
      ev.discordEventId = se.id;
    } catch (err) {
      note = `\n(Not added to Discord's Events calendar: ${err.message}. Give the bot "Manage Events" if you want that.)`;
    }
  }
  state.events.push(ev);
  persist();
  return interaction.reply({ content: `✅ Scheduled.\n${describe(ev)}${note}`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
}

async function list(interaction) {
  const upcoming = [...state.events].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const lines = upcoming.map(describe);
  if (cfg.dailyCountdown?.enabled) lines.unshift(`🔁 Daily launch countdown at ${cfg.dailyCountdown.time} ${config.timezone} (until launch day)`);
  return interaction.reply({
    content: lines.length ? lines.join('\n\n').slice(0, 1900) : 'Nothing scheduled. Use `/event create`.',
    flags: EPHEMERAL,
    allowedMentions: { parse: [] },
  });
}

async function cancel(interaction) {
  const id = interaction.options.getInteger('id');
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return interaction.reply({ content: `No event #${id}.`, flags: EPHEMERAL });
  state.events = state.events.filter((e) => e.id !== id);
  persist();
  if (ev.discordEventId) await interaction.guild.scheduledEvents.delete(ev.discordEventId).catch(() => {});
  return interaction.reply({ content: `🗑️ Cancelled #${id} ${ev.title}.`, flags: EPHEMERAL });
}

async function execute(interaction) {
  if (!(await requireOfficer(interaction))) return;
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return create(interaction);
  if (sub === 'list') return list(interaction);
  return cancel(interaction);
}

// ---------------------------------------------------------------- scheduler

function pingFor(guild, ping) {
  if (ping === 'everyone') return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  if (ping && guild.roles.cache.has(ping)) return { content: `<@&${ping}>`, allowedMentions: { roles: [ping] } };
  return { allowedMentions: { parse: [] } };
}

function reminderEmbed(ev, minutes) {
  const e = embed().setTimestamp(new Date(ev.startsAt));
  if (minutes === 0) e.setTitle(`🔔 ${ev.title}: starting now!`);
  else e.setTitle(`⏰ ${ev.title}`).addFields({ name: 'Starts', value: `${ts(ev.startsAt, 'R')}\n${ts(ev.startsAt, 'F')}` });
  if (ev.details) e.setDescription(ev.details);
  return e;
}

async function send(channel, payload) {
  const missing = channel.permissionsFor(channel.guild.members.me).missing(postPerms(channel));
  if (missing.length) {
    console.warn(`[events] cannot post in #${channel.name}: missing ${missing.join(', ')}`);
    return false;
  }
  await channel.send(payload);
  return true;
}

async function runEvents(guild, channel, now) {
  let changed = false;
  for (const ev of [...state.events]) {
    const start = new Date(ev.startsAt).getTime();
    const due = ev.reminders.filter((m) => !ev.sent.includes(m) && now >= start - m * 60000);
    if (due.length) {
      // Post only the latest due reminder, and only if it isn't stale: after
      // downtime we don't want a burst of old "starts in 60 minutes" posts.
      const m = Math.min(...due);
      if (now - (start - m * 60000) <= GRACE_MS) {
        await send(channel, { ...pingFor(guild, ev.ping), embeds: [reminderEmbed(ev, m)] }).catch((e) => console.error('[events]', e.message));
      }
      ev.sent.push(...due);
      changed = true;
    }
    if (now >= start && ev.sent.length >= ev.reminders.length) {
      if (ev.repeat) {
        ev.startsAt = nextOccurrence(ev.repeat, new Date(start + 60000)).toISOString();
        ev.sent = [];
      } else {
        state.events = state.events.filter((e) => e.id !== ev.id);
      }
      changed = true;
    }
  }
  return changed;
}

function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function countdownEmbed(guild, today) {
  const d = config.dates;
  const style = d.timeConfirmed ? 'F' : 'D';
  const eaDays = daysBetween(today, localDate(new Date(d.earlyAccess), config.timezone));
  const launchDays = daysBetween(today, localDate(new Date(d.launch), config.timezone));
  const phrase = (n, what) => (n > 1 ? `${n} days until ${what}` : n === 1 ? `${what} is TOMORROW` : `${what} is TODAY`);
  const title = eaDays >= 0 ? phrase(eaDays, 'Early Access') : phrase(launchDays, 'global launch');
  const ann = channelOf(guild, 'announcements');
  const guides = channelOf(guild, 'guidebooks');
  return embed()
    .setTitle(`⏳ ${config.legion.game}: ${title}`)
    .setDescription([
      eaDays >= 0 ? `**Early Access (Founder's Pack):** ${ts(d.earlyAccess, style)}` : null,
      `**Global launch:** ${ts(d.launch, style)}`,
      '',
      ann ? `Not in ${config.legion.name} yet? Hit **Join** on the recruitment post in <#${ann.id}>. One click.` : null,
      guides ? `Prep with the guides in <#${guides.id}>. Start with Kanon's Bible.` : null,
    ].filter((l) => l !== null).join('\n'));
}

async function runCountdown(guild, channel, now) {
  const dc = cfg.dailyCountdown;
  if (!dc?.enabled) return false;
  const today = localDate(now, config.timezone);
  if (state.lastCountdown === today) return false;
  if (today > localDate(new Date(config.dates.launch), config.timezone)) return false;
  const [y, m, d] = today.split('-').map(Number);
  const [h, mi] = dc.time.split(':').map(Number);
  const due = zonedToUtc(y, m, d, h, mi, config.timezone).getTime();
  if (now < due || now - due > GRACE_MS) return false;
  state.lastCountdown = today;
  await send(channel, { embeds: [countdownEmbed(guild, today)], allowedMentions: { parse: [] } }).catch((e) => console.error('[countdown]', e.message));
  return true;
}

let running = false;
async function tick(client) {
  if (running) return;
  running = true;
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    const channel = guild && channelOf(guild, 'events');
    if (!channel) return;
    const now = Date.now();
    const a = await runEvents(guild, channel, now);
    const b = await runCountdown(guild, channel, now);
    if (a || b) persist();
  } catch (err) {
    console.error('[scheduler]', err);
  } finally {
    running = false;
  }
}

function startScheduler(client) {
  tick(client);
  setInterval(() => tick(client), 30 * 1000);
}

module.exports = { command, execute, startScheduler, countdownEmbed, localDate };
