# kitbot-6b6t

Delivers one shulker kit per player on 6b6t. Players whisper `!kit`; the bot sends `/tpa`,
drops the shulker, uses `/kill` to return to its bed and serves the next one.

**Not yet tested on 6b6t.** The portal building and elytra flight have never run on a real server.

## 1. First-time setup (the bot does it)

Register the bot account once with a normal client (`/register`), then put it in `.env` and start it.
All commands below are whispers from `OWNER`: `/w BotName !command`.

1. Send the bot a `/tpa`. It accepts (if it does not, whisper `!accept`).
2. Drop it the setup kit, loose or as one shulker, then whisper `!go`. It needs:
   1 elytra, 16+ firework rockets, 28+ obsidian, flint and steel.
   2+ totems, 4+ golden apples. Also give it a diamond or netherite pickaxe, and spares.
3. It builds a portal, flies the nether to x = 2100, builds a second portal and exits.
4. It sends you `/tpa`. Accept it with the bot's name, standing by your bed.
5. It clicks the nearest bed and runs `/sethome base`.

Always on: auto respawn, a totem kept in the off hand, gapples eaten below 7 hearts.
`/kill` drops everything, so while the bot carries any gear it returns with `/home` instead.
Empty its inventory and off hand if you prefer `/kill`.

In the nether it flies slowly, keeps away from walls and lava, and lands to recover when hurt.
This reduces the risk but cannot remove it, so do not give it gear you cannot lose.

Then fill chests within about 3 blocks of the respawn spot with
**already packed shulkers**, one per kit.

Setup commands: `!stage` `!accept` `!go` `!retry` `!skip` (finish a stage by hand) `!setup` (start over).
A bot that is already set up: type `!skip` in the host console until it says `done`.

Suggested player kit: armour, sword, food, totems, obsidian, flint and steel.
Players cannot be reached at spawn: `/tpa` is off until they are past 5000 blocks.

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
