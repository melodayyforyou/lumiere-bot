const { ChannelType, SlashCommandBuilder } = require('discord.js');
const guides = require('../../content/guides.json');
const { EPHEMERAL, embed } = require('../util');

const command = new SlashCommandBuilder()
  .setName('guides')
  .setDescription('Show the Lumiere guide library (only you can see it).');

function sectionEmbed(section) {
  return embed()
    .setTitle(section.name)
    .setDescription(section.guides.map((g) => `**[${g.title}](${g.url})**\nby ${g.creator}. ${g.note}`).join('\n\n'));
}

function message() {
  const intro = embed().setTitle(guides.title).setDescription(guides.intro);
  return { embeds: [intro, ...guides.sections.slice(0, 9).map(sectionEmbed)], allowedMentions: { parse: [] } };
}

async function execute(interaction) {
  return interaction.reply({ ...message(), flags: EPHEMERAL });
}

/**
 * Post (or refresh) the guide library. Re-running it edits the bot's existing
 * post instead of stacking duplicates in the channel.
 */
async function publish(channel, botId) {
  const payload = message();
  if (channel.type === ChannelType.GuildForum) {
    const active = await channel.threads.fetchActive();
    const archived = await channel.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
    const existing = [...active.threads.values(), ...archived.threads.values()]
      .find((t) => t.parentId === channel.id && t.ownerId === botId && t.name === guides.title);
    if (existing) {
      if (existing.archived) await existing.setArchived(false);
      const starter = await existing.fetchStarterMessage();
      await starter.edit(payload);
      return { url: existing.url, updated: true };
    }
    // Some forums require a tag on every post; use the first one if so.
    const requireTag = channel.flags?.has?.('RequireTag');
    const thread = await channel.threads.create({
      name: guides.title,
      message: payload,
      appliedTags: requireTag && channel.availableTags.length ? [channel.availableTags[0].id] : [],
    });
    await thread.pin().catch(() => {}); // pins the post to the top of the forum when allowed
    return { url: thread.url, updated: false };
  }
  const recent = await channel.messages.fetch({ limit: 50 });
  const existing = recent.find((m) => m.author.id === botId && m.embeds[0]?.title === guides.title);
  if (existing) {
    await existing.edit(payload);
    return { url: existing.url, updated: true };
  }
  const msg = await channel.send(payload);
  return { url: msg.url, updated: false };
}

module.exports = { command, execute, publish };
