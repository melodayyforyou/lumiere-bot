# Lumiere Bot (AION2 legion)

A Discord bot for the **Lumiere** legion, built for your existing server. What it does:

| Feature | Where | Who uses it |
|---|---|---|
| **One-click join**: the recruitment announcement carries a **Join** button. Click it and you get the member role and your name appears on the roster list inside the announcement. Officers see join times with `/roster list`. | `#announcement` | Everyone / officers |
| **Applications (optional, off by default)**: Apply button → 5-question form → officers Accept / Interview / Reject. Only used if you `/post panel:Registration`. | `#registration` → a private officer channel | Everyone / officers |
| **Legion roles**: class and ping picker. **Off by default**, because your existing bot already runs the class panel in `#legion-roles` | `#legion-roles` | Members |
| **Guide library**: curated English guides, with **Kanon's AION 2 Bible** first | `guidebooks` forum, plus `/guides` | Everyone |
| **Announcements**: write → preview → post, with ready-made templates (recruitment, early-access, guides) | `#announcement` | Officers |
| **Timed events**: the bot posts reminders on its own (e.g. 24h / 1h / "starting now"). Events can repeat daily or weekly. There's also a daily launch countdown at 20:00 WIB until Oct 5. | new `#timed-events` channel | Officers schedule, everyone reads |

## Safety rules for your existing server

- The bot **never deletes or renames** channels, roles or messages, and never changes existing permissions.
- It only creates things when an admin explicitly runs `/setup create-channels` or `/setup create-roles`. Even then it creates **only what's missing**, and roles are made with **zero permissions**.
- `/setup check` is read-only. Run it anytime to see what's wrong.
- Pings are **off by default**. Every announcement shows a preview before it posts, and @everyone must be chosen on purpose.
- It doesn't read chat messages (no privileged intents).
- Commands only work on the Lumiere server.

## 1. Create the bot (Discord Developer Portal, about 10 min)

Do this on a computer, logged in to the Discord account that **owns or admins** the Lumiere server.

**A. Create the application**
1. Open https://discord.com/developers/applications and click **New Application** (top right).
2. Name it `Lumiere Bot`, tick the terms box, and click **Create**. Use a new app; don't touch your existing bot's app.
3. You're now on **General Information**. Upload the Lumiere logo as the App Icon (optional).
4. Copy the **Application ID** into a notepad. This is your **CLIENT_ID**.

**B. Set up the bot account**
1. In the left menu, click **Bot**.
2. Set the username and avatar (optional).
3. Click **Reset Token** → **Yes, do it!** → **Copy**, and paste it into your notepad. This is your **DISCORD_TOKEN**.
   - It's shown **only once**. If you lose it, reset it again.
   - **Treat it like a password.** Anyone with it controls the bot. Don't paste it in Discord or share it in chats.
4. Under **Privileged Gateway Intents**, leave **all three switches OFF**. The bot doesn't need them.
5. Leave **Requires OAuth2 Code Grant** OFF.

**C. Stop strangers from adding your bot to their servers (recommended)**
1. In the left menu, click **Installation**, set **Install Link** to **None**, and click **Save**.
2. Go back to **Bot**, turn **Public Bot** OFF, and click **Save**.

**D. Get your Server ID**
1. In the Discord app, go to **User Settings** (gear icon) → **Advanced** and turn on **Developer Mode**.
2. Right-click the **Lumiere Mmorpg** server icon → **Copy Server ID**. Paste it into your notepad. This is your **GUILD_ID**.

**E. Invite the bot to Lumiere**
1. In this link, replace `CLIENT_ID` with your Application ID, then open it in the browser:

   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=335276100624
   ```
2. Pick **Lumiere Mmorpg**, click **Continue** → **Authorize**, and complete the captcha.
3. The link grants: view/send/embed/read history, manage roles, manage events, threads, mention everyone, and manage channels. Manage Channels is only used by `/setup create-channels`, so you can remove it afterwards.

**F. Put the bot's role in the right place (important)**
1. In Discord, go to **Server Settings → Roles**.
2. Find the role named **Lumiere Bot**, which was created automatically.
3. Drag it **above** the member role and the applicant role. Discord only lets a bot give out roles that sit below its own.

You should now have 3 things in your notepad: **Application ID**, **Server ID** and **Bot token**. You'll paste them in the next step.

## 2. Install on your VPS (Ubuntu/Debian)

1. Open your VPS dashboard and click **Web Console**. A terminal opens in your browser.
2. Paste this one line and press Enter:

   ```bash
   cd ~ && (command -v git >/dev/null || sudo apt-get install -y git) && git clone https://github.com/melodayyforyou/lumiere-bot.git && cd lumiere-bot && sudo bash deploy/install-vps.sh
   ```
3. It asks for the 3 things from your notepad: Application ID, Server ID and bot token. The token stays invisible while you paste it; that's normal. Then it does everything else by itself.
4. At the end you should see `active (running)` and a checklist of ✅/❌. Copy that output back to Claude if anything shows ❌.

**It won't disturb other bots on the VPS.** It uses its own private copy of Node.js inside the `lumiere-bot` folder and its own service name (`lumiere-bot`).

> ⚠️ Use a **new** Discord application for this bot. Don't reuse the token of the server's existing bot, or the two programs will fight over the same account. Slash commands are added one by one, and the bot never removes commands it didn't create.

The bot now runs 24/7, restarts itself if it crashes, and starts again when the VPS reboots.

| Task | Command |
|---|---|
| Watch live logs | `journalctl -u lumiere-bot -f` |
| Restart after editing config/content | `sudo systemctl restart lumiere-bot` |
| Update to a new version | `cd ~/lumiere-bot && git pull && sudo bash deploy/install-vps.sh` |
| Stop | `sudo systemctl stop lumiere-bot` |

Scheduled events are saved in `~/lumiere-bot/data/events.json` on the VPS, so they survive restarts. Back it up if you care about it.

## 3. Match it to your server (`config.json`)

Channels and roles can be written as a **name** (e.g. `"legion-roles"`; emoji and the `|` are ignored) or an **ID** (right-click → Copy ID). **Use IDs whenever two channels share a name.** Your server has two `general-chat` channels, for example.

The defaults already match your channel list:

```
announcements      → announcement
registration       → registration
legionRoles        → legion-roles
guidebooks         → guidebooks (forum)
welcome            → legion-chat          (accepted members get welcomed here)
events             → timed-events         (NEW: /setup create-channels makes it)
applicationsReview → legion-applications  (NEW: private officer channel)
```

**You must set:**
- `roles.officers`: the name(s) of your officer/leader roles. People with Manage Server always count as officers.
- `roles.member`: the role accepted members get (e.g. your existing legion role).
- `timezone`: the zone officers type event times in. The default is `Asia/Jakarta`. Members always see times in **their own** local time.
- `dates`: once NC announces exact server-open times, put them in and set `"timeConfirmed": true`.

After editing: `sudo systemctl restart lumiere-bot`, then run `/setup check` in Discord.

## 4. First-day setup in Discord (in this order)

1. `/setup check`: read-only report. Fix anything marked ❌.
2. `/setup create-roles`: creates the member and applicant roles if they're missing. Class roles stay with your existing bot.
3. `/setup create-channels`: creates `#timed-events` (read-only) and `#legion-applications` (officers only) in the AION2 Division category.
4. `/post panel:Registration` → the Apply button in `#registration`.
5. `/post panel:Guide library` → the pinned guide post in `guidebooks`.
6. `/announce template:recruitment ping:@everyone` → edit the text, preview it, post it.
7. `/event create`, e.g. title `Legion meet-up (Early Access)`, date `2026-09-30`, time `20:00`, reminders `1440,60,0`, ping_role `Event Ping`.

## Commands

| Command | Who | What |
|---|---|---|
| `/announce [template] [ping] [channel]` | Officers | Opens a form (prefilled from a template), shows a preview, and posts only after you click **Post it** |
| `/post panel:…` | Officers | Posts the registration, roles, guides or countdown panel. Re-posting guides **updates** the existing post |
| `/event create / list / cancel` | Officers | Timed auto-announcements. `repeat` = once, daily or weekly. `reminders` = minutes before start |
| `/guides` | Everyone | Shows the guide library privately |
| `/roster list / remove` | Officers | Who clicked Join, with join times. `remove` takes someone off the list (their role is left alone) |
| `/setup check / create-channels / create-roles` | Admins | Health check / create only what's missing |

## Editing content without touching code

- **Guides:** `content/guides.json`. Add, remove or reorder links, restart the bot, then `/post panel:Guide library` to update the post.
- **Announcement templates:** `content/templates.json`. Placeholders like `{ea}`, `{launch_relative}` and `{registration}` turn into live dates and channel links.
- **Application questions:** `FIELDS` at the top of `src/features/registration.js`. Discord allows a maximum of 5.

Want to change something? Open this folder in Claude Code and describe the change in plain English, e.g. *"add a 6th guide section for PvP"* or *"ask applicants for their gear score"*.

## Launch facts used (checked 2026-09-25)

- Early Access (Founder's Pack): **Sept 30 – Oct 4, 2026**. Global F2P launch: **Oct 5, 2026**.
- NC hasn't published exact server-open times, so the bot shows **dates only** until you set `timeConfirmed`.
