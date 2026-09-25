// Every slash command the bot registers, in one place.
module.exports = [
  require('./features/announce'),
  require('./features/post'),
  require('./features/events'),
  require('./features/guides'),
  require('./features/setup'),
];
