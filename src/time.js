// Timezone maths without extra libraries: officers type "2026-10-05 20:00"
// in the legion's timezone, and we store everything as UTC.

/** Offset (ms) between UTC and `timeZone` at a given instant. */
function offsetMs(timeZone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock time in `timeZone` -> Date (UTC). */
function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - offsetMs(timeZone, guess));
  // Second pass handles DST changes between the guess and the real instant.
  return new Date(guess.getTime() - offsetMs(timeZone, first));
}

/** Parse "YYYY-MM-DD" + "HH:MM" in a timezone. Returns Date or null. */
function parseLocal(dateStr, timeStr, timeZone) {
  const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((dateStr || '').trim());
  const t = /^(\d{1,2})[:.](\d{2})$/.exec((timeStr || '').trim());
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  return zonedToUtc(y, mo, da, h, mi, timeZone);
}

/** Weekday (0=Sun) and Y/M/D of an instant as seen in `timeZone`. */
function localDay(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd };
}

/**
 * Next time a weekly schedule fires after `from`.
 * days: array of 0-6 (0=Sunday) or empty for every day; time: "HH:MM".
 */
function nextOccurrence({ days, time, timezone }, from = new Date()) {
  const [h, m] = time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const probe = new Date(from.getTime() + i * 86400000);
    const { y, m: mo, d, wd } = localDay(probe, timezone);
    if (days && days.length && !days.includes(wd)) continue;
    const at = zonedToUtc(y, mo, d, h, m, timezone);
    if (at > from) return at;
  }
  return null;
}

module.exports = { parseLocal, nextOccurrence, zonedToUtc };
