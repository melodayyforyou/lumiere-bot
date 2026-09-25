const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));

config.legion.color = parseInt(String(config.legion.color || '#C9A227').replace('#', ''), 16);
config.roles.officers = [].concat(config.roles.officers || []).filter(Boolean);
config.pingRoles = config.pingRoles || [];
config.roles.communityPing = [].concat(config.roles.communityPing || []).filter(Boolean);
config.features = { rolePanel: false, ...config.features };
config.timezone = config.timezone || 'UTC';

try {
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
} catch {
  throw new Error(`config.json: "${config.timezone}" is not a valid timezone (use names like Asia/Jakarta, Europe/Berlin)`);
}

module.exports = config;
