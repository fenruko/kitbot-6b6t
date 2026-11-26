# kitbot-6b6t

Delivers one shulker kit per player on 6b6t. Players whisper `!kit`; the bot sends `/tpa`,
drops the shulker, uses `/kill` to return to its bed and serves the next one.

**Not yet tested on 6b6t.** Do the checks below before opening it to others.

## 1. Set up the bot account (once, with a normal Minecraft client)

1. Join 6b6t on the bot account and `/register` it, then `/login`.
2. Escape spawn: walk until X or Z is past 5000 (`/kill` gives a new spawn spot if stuck).
3. `/tpa YourMain`, accept on your main, so the bot account arrives at your base.
4. Place a bed in the overworld, right-click it, and run `/sethome base`.
5. Put chests or barrels within arm's reach (about 3 blocks) of where you respawn.
6. Fill them with **already packed shulkers**, one shulker per kit.
7. Empty the bot's inventory and armour slots (`/kill` drops everything), then log out.

Suggested kit: armour, sword, food, totems, obsidian, flint and steel.
To restock later, just add shulkers to the chests. No restart needed (use `!resume` if it paused).

Players cannot be reached at spawn: `/tpa` is off until they are past 5000 blocks,
so portal materials in the kit do not help them escape spawn the first time.

## 2. Run it

Needs Node.js 22 or newer and `git` on the host.

    git clone https://github.com/fenruko/kitbot-6b6t
    cd kitbot-6b6t
    cp .env.example .env     # fill in BOT_USERNAME, BOT_PASSWORD, OWNER
    npm start

On a panel host, set the start file to `start.js`. Create `.env` in the file manager.

## Auto update

`npm start` checks GitHub every 60 seconds. On a new commit it waits for the current
delivery to finish, runs `git pull --ff-only`, installs libraries if needed and restarts the bot.

- The folder must be a **git clone**, not an uploaded zip.
- A private repo needs credentials on the host: use a read-only fine-grained token for this
  repo only. Never commit it.
- Do not edit tracked files on the host, or the pull will fail.
- A change to `start.js` itself needs one manual restart.
- If your host already auto-pulls, set `AUTO_UPDATE=false` to avoid two updaters.

## Commands

Players (whisper): `!kit` `!queue` `!leave` `!help`

Owner (whisper or host console): `!status` `!pause` `!resume` `!reset <name>`

Host console lines starting with `/` are sent to the server.

## First run checklist

1. It logs `server: main` and `on main, ready`, and stays for an hour.
2. Whisper `!status` from the owner. If nothing happens, find the
   `unrecognised message format` log line and set `WHISPER_PATTERN` in `.env`.
3. Do one delivery to your own alt, watching the console.
4. Refuse a `/tpa` once and check the kit goes back into the chest.
5. Set `TPA_COOLDOWN` and `HOME_COOLDOWN` to what the bot account really has.

## If it stops

- **Verification link in the log:** 6b6t wants to check the connection. It may need to be
  opened from the same network as the bot, which can be impossible on a shared host.
- **`PAUSED`:** out of kits, bed missing, or it could not get home. Fix it, then `!resume`.
- **Host rules:** LemonHost's terms describe Discord bot hosting. Ask them first.

State (queue, who got a kit) is in `data/state.json`. Back it up if you move hosts.

Run the tests with `npm test`.
