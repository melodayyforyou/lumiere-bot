# Handoff: Lumiere Bot → laptop session

For Senz, and for the Claude Code session on the laptop. Read this first.

## Where things stand (2026-09-25)

**Built and pushed (this repo, `main`):**
- **Character registration (2026-09-25, replaces the approval form):** Register my character button in `#registration` → card in `#character-records` (config key `channels.applicationsReview`). Records in `data/characters.json`; re-registering edits the same card. The applicant role is gone.
- **Guide library:** a pinned post in the `guidebooks` forum. Kanon's AION 2 Bible is first. Content lives in `content/guides.json`.
- **Announcements:** `/announce`, which writes, previews, then posts. Templates are in `content/templates.json`.
- **Timed events:** `/event create|list|cancel` posts reminders automatically in `#timed-events`, once, daily or weekly. There's also a daily launch countdown at 20:00 WIB until Oct 5.
- **Setup:** `/setup check` (read-only), `/setup create-channels`, `/setup create-roles` (creates only what's missing).
- **Installer:** `deploy/install-vps.sh` uses its own private Node.js in `.node/` plus a systemd service named `lumiere-bot`.

**Done on 2026-09-25 (laptop session):** Discord app created (bot user "Lumiere AION2", given Administrator by Senz), installed on the VPS as `lumiere-bot`, `config.json` filled with AION2 Division channel IDs and roles (member = AION2 (see below); officers = AION2 Admins, Head Division, Lumiere Council), guide library posted to the `guidebooks` forum.

**Not done yet:**
1. [x] Join gives the **AION2** role (`roles.member`). **AION2 Division** is for verified members and admins hand it out manually after the game releases. Set on the VPS 2026-09-25.
2. [ ] `/setup create-channels` (for `#timed-events`), then `/announce template:recruitment ping:@everyone`.
3. [ ] When NC announces the exact server-open times, update `dates` in `config.json` and set `timeConfirmed: true`.

## Key facts and decisions

- **Game:** AION2. Early Access (Founder's Pack) runs **Sept 30 – Oct 4, 2026**; the global F2P launch is **Oct 5, 2026**. Exact times haven't been announced.
- **Server:** "Lumiere Mmorpg", about 4.9k members, and already established. The bot must never delete, rename or re-permission existing things.
- The server **already has a bot ("Lumiere Mmorpg" app) with a class-selection panel** in `#legion-roles`. That's why our role panel is **off** (`features.rolePanel: false`).
- Lumiere Bot must be a **new** Discord application, not the existing bot's token. `npm run deploy` only adds or updates its own commands and warns if it sees foreign ones.
- The Discord server has **two `general-chat` channels**, so use channel IDs, not names, for anything duplicated.
- Default timezone is `Asia/Jakarta`. Members see all times in their own local time.
- Secrets live only in `.env` on the VPS (gitignored). **This repo is public: never commit tokens, passwords or the VPS IP.**

## VPS cheat sheet

| Task | Command |
|---|---|
| Install / reinstall / update | `cd ~/lumiere-bot && git pull && sudo bash deploy/install-vps.sh` |
| Logs | `journalctl -u lumiere-bot -f` |
| Restart after editing `config.json` or `content/` | `sudo systemctl restart lumiere-bot` |
| Change token/IDs | `rm ~/lumiere-bot/.env` then run the installer again |

## Notes for the laptop Claude Code session

- Senz is non-technical. Explain like a PM, do the typing, and keep the steps short.
- The laptop *can* SSH to the VPS (the cloud session couldn't). Senz gives the IP and login in the session, never in a commit.
- Before installing, look at what's on the VPS (`systemctl list-units --type=service`, `node -v`, `pm2 ls` if present) and leave the existing polybot alone.
- Never paste the bot token into chat. Let Senz type it into the installer prompt.
- Test locally with `npm install && node --check src/*.js src/features/*.js`. There's no test suite; the logic was checked with simulated Discord objects.
- Code map: `src/index.js` (router) · `src/features/*.js` (one file per feature) · `src/time.js` (timezone maths) · `src/store.js` (JSON file in `data/`) · `config.json` + `content/` (everything Senz may edit).
