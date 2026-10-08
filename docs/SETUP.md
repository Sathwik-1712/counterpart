# Setup: what's left for you

**Never paste keys, tokens or passwords into the Claude chat.** The steps below keep them out of it.

| Item | Status |
|---|---|
| Agnes API key in `backend/.env` | Done |
| Supabase project (Mumbai) | Done |
| Supabase plugin signed in | Done |
| Playwright plugin | Done |
| Git: remote set to the hackathon repo, first commit made | Done (by Claude) |
| **A. Database password** | **You: about 3 minutes** |
| **B. Push the code to GitHub** | **You: about 2 minutes** |
| Storage keys (old step 2c) | Not needed now; only when deploying, and Claude will guide you then |
| GitHub plugin | Not needed; see the end of this page |

---

## A. Database password

The password in `backend/.env` is not the one Supabase has, so the app can't connect. Set a fresh one:

1. Open https://supabase.com/dashboard and click your project.
2. Click **Project Settings** (gear icon, bottom left), then **Database**.
3. Find **Database password** and click **Reset database password**.
4. Click **Generate a password**, then click **Copy** next to it. Keep this tab open.
5. Click **Reset password** to save it in Supabase.
6. In VS Code, open a terminal: menu **Terminal → New Terminal**.
7. Paste these two lines and press Enter:
   ```bash
   cd ~/Desktop/Hackerring/backend
   ~/.local/bin/uv run python -m scripts.set_db_password
   ```
8. When it asks for the password, press **Cmd+V** and then **Enter**. Nothing appears while you paste; that's normal, because the password is hidden.
9. You should see **Connected to Supabase. Saved to backend/.env.**
   - If it says *wrong password*, the reset hadn't saved yet. Wait 30 seconds and run step 7 again.

The command handles special characters and the URL formatting for you. You don't need to edit `.env` by hand.

---

## B. Push the code to GitHub

You'll use VS Code's built-in GitHub sign-in, so you won't need a token.

1. Make sure you're signed in to github.com in your browser with the account that is a member of **hackering-2-0**.
2. In VS Code, open the **Source Control** panel: the branch icon on the left bar, or **Ctrl+Shift+G**.
3. Click **Publish Branch** (or **Sync Changes**).
4. If VS Code says *"The extension 'GitHub' wants to sign in using GitHub"*, click **Allow**. In the browser, click **Continue** and **Authorize Visual Studio Code**, then come back to VS Code.
5. To check it worked, open https://github.com/hackering-2-0/HR2-AI-C06057AE. You should see `backend/`, `frontend/`, `docs/` and the README.

| If you see | Do this |
|---|---|
| "Updates were rejected" or "fetch first" | The repo already had a file in it (for example a README from the organisers). Don't force anything; tell Claude, and it will merge them. |
| "Repository not found" or 403 | Your GitHub account isn't in the hackering-2-0 organisation yet, or the org needs to approve VS Code. Ask your team lead or the organisers, then retry step 3. |
| No Publish button | Tell Claude; it will check the git state. |

---

## Then tell Claude

Send something like:

```
A done (password saved), B done (pushed) / B failed with: <message>
```

Claude will then:
1. Create the 14 tables on Supabase, load the demo café, and run Supabase's security check.
2. Do the first live Agnes run and save it as the labelled demo fallback.
3. Click through the full demo in a real browser with Playwright and fix anything that breaks.
4. Commit and push those changes.

---

## About the GitHub plugin (optional, you can skip it)

`/mcp` shows *plugin:github: Authorization header is badly formatted*. That error is harmless. It only means the plugin has no token, and pushing code works without it. To hide the error, type `/mcp`, pick **plugin:github:github** and choose **Disable**.

You only need the plugin if you later want Claude to open pull requests or issues on GitHub for you. If so, ask, and Claude will walk you through it.
