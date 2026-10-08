# Setup: the steps only you can do

About 20–25 minutes. Do them in order. **Never paste keys or tokens into the Claude chat.** Put them in the files named below; those files are git-ignored.

| # | Step | Unblocks | Time |
|---|---|---|---|
| 1 | Agnes API key | Every AI feature (agent, copy, images) | 3 min |
| 2 | Supabase project + database URL | The real database | 8 min |
| 3 | GitHub repo + token | GitHub plugin, pushing code | 6 min |
| 4 | Restart VS Code | Playwright and GitHub plugins | 1 min |
| 5 | Sign in to the Supabase plugin | Supabase plugin | 2 min |
| 6 | Send Claude the checklist at the end | — | 1 min |

Already done for you: Node and uv are on your login `PATH` (`~/.zprofile`), and the Playwright server is downloaded. It failed only because VS Code was started before that change.

---

## 1. Agnes API key

1. Go to https://platform.agnes-ai.com and sign in.
2. Open **API Keys** and create a new key. Name it `counterpart-hr26`.
3. Open `backend/.env` in VS Code and set:
   ```
   AGNES_API_KEY=paste-the-key-here
   ```
4. Save. Do **not** put this key in `frontend/.env.local` or anywhere starting with `NEXT_PUBLIC_`.

Free plan limits: 10 text requests per minute and 10 images per minute. The app queues requests itself, so you don't need to change anything.

---

## 2. Supabase project and database URL

### 2a. Create the project
1. Go to https://supabase.com/dashboard and choose **New project**.
2. Fill in:
   - **Name:** `counterpart-hr26`
   - **Database password:** click **Generate**, then **save it in your password manager now**. You can't see it again (only reset it).
   - **Region:** `South Asia (Mumbai)`. It's closest to Bengaluru and to the judges.
3. Click **Create new project** and wait about 2 minutes until it says the project is ready.

### 2b. Copy the connection string
1. On the project page, click **Connect** at the top.
2. Choose the **Session pooler** tab (not "Direct connection": that one is IPv6-only and often fails on home and venue Wi-Fi).
3. Copy the URI. It looks like:
   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with the password from 2a.
   If the password contains `@ : / ? # & %` or spaces, generate a new one with only letters and numbers. Encoding special characters is fiddly.
5. In `backend/.env`, replace the existing local `DATABASE_URL` line with:
   ```
   DATABASE_URL=postgresql://postgres.abcdefghijkl:yourpassword@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```

### 2c. (For deployment day) storage keys
Only needed when the app runs on a server instead of your laptop.
1. **Project Settings → API Keys**: copy the **secret** key (older projects call it `service_role`).
2. **Project Settings → Data API**: copy the **Project URL**.
3. Add both to `backend/.env` (backend only, never the frontend):
   ```
   SUPABASE_URL=https://abcdefghijkl.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=paste-the-secret-key
   # switch on later, when deploying:
   # STORAGE_BACKEND=supabase
   ```

### 2d. Create the tables (or let Claude do it)
In a terminal:
```bash
cd ~/Desktop/Hackerring/backend
uv run python -m scripts.migrate
uv run python -m scripts.seed
```
Expected output: `applied: 20261008000000_init.sql`, then a line with `'interactions': 32`.
Check in the Supabase dashboard: **Table Editor** shows 14 tables, and `businesses` has one row, *Kaapi Kone*.

If you'd rather not, tell Claude "the Supabase URL is in .env, run the migrations" and it will do it.

---

## 3. GitHub repository and token

### 3a. Create an empty repository
1. https://github.com/new
2. **Repository name:** `counterpart-hr26`. **Private.**
3. Leave **README, .gitignore and license unticked** (the project already has them).
4. Click **Create repository** and copy its URL, e.g. `https://github.com/<you>/counterpart-hr26`.

### 3b. Create a fine-grained token
1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Name:** `claude-code-hr26`. **Expiration:** 30 days.
3. **Repository access:** *Only select repositories* → `counterpart-hr26`.
4. **Repository permissions:**
   - Contents: **Read and write**
   - Pull requests: **Read and write**
   - Issues: **Read and write**
   - Metadata: Read-only (selected automatically)
5. **Generate token** and copy it (it starts with `github_pat_`).

### 3c. Give the token to Claude Code (not to the chat)
The GitHub plugin reads the environment variable `GITHUB_PERSONAL_ACCESS_TOKEN`.
1. In a terminal:
   ```bash
   open -e ~/.zprofile
   ```
2. Add this line at the bottom, with your token, and save:
   ```bash
   export GITHUB_PERSONAL_ACCESS_TOKEN="github_pat_paste-yours-here"
   ```
3. Make the file readable only by you:
   ```bash
   chmod 600 ~/.zprofile
   ```

---

## 4. Restart VS Code

Plugins read the environment only when VS Code starts.
1. Quit VS Code completely with **Cmd+Q**. Closing the window is not enough.
2. Open VS Code again from the Dock or Spotlight, then open the Claude Code panel.

---

## 5. Sign in to the Supabase plugin

1. In the Claude Code panel, type `/mcp` and press Enter.
2. Select **plugin:supabase:supabase** → **Authenticate**.
3. A browser tab opens. Sign in to Supabase, pick the organisation that contains `counterpart-hr26`, and approve.
4. Back in `/mcp`, check that all three show as connected:
   - `plugin:supabase:supabase`: connected
   - `plugin:github:github`: connected
   - `plugin:playwright:playwright`: connected

### If something still fails

| Symptom | Fix |
|---|---|
| playwright: `Executable not found in $PATH: npx` | VS Code was not fully quit. Cmd+Q and reopen. Check that `zsh -lc 'which npx'` prints a path. |
| playwright connects but says a browser is missing | Ask Claude to "install the Playwright browser". It can run that itself. |
| github: `Authorization header is badly formatted` | The token line is missing from `~/.zprofile`, has a typo, or VS Code was not restarted. Check with `zsh -lc 'echo ${GITHUB_PERSONAL_ACCESS_TOKEN:0:11}'`; it should print `github_pat_`. |
| github: 401 / 403 | Token expired or not given access to the repository. Regenerate it (3b). |
| migrate: `could not translate host name` or a timeout | You used the Direct connection string. Use the **Session pooler** one (2b). |
| migrate: `password authentication failed` | Wrong password, or special characters in it. Reset it in **Project Settings → Database** using only letters and numbers. |

---

## 6. Send Claude this checklist

Copy, fill in, and send. **Don't include any keys.**

```
Setup done:
- [ ] Agnes key is in backend/.env
- [ ] Supabase DATABASE_URL is in backend/.env   (migrations run by me / please run them)
- [ ] /mcp shows supabase, github, playwright connected
- GitHub repo URL: https://github.com/<you>/counterpart-hr26
- OK to make the first commit and push to main? yes / no
- Optional: deploy target you prefer (Railway / Render / Fly / not yet)
```

## What Claude does next, once you send it

1. Run the migrations and seed on Supabase (if you didn't), then use the Supabase plugin to check the tables and run its security advisor (RLS on all 14 tables).
2. Run the first live Agnes agent run: check tool calling, Kannada and Hindi quality, and the JSON reliability of generation and the meaning check. Record the run as the labelled demo fallback.
3. Use Playwright to click through the golden demo path in a real browser and fix anything that breaks.
4. Make the first commit and push to your GitHub repository (only if you said yes).
