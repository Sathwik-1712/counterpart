# Counterpart: where it stands and how we build on it

Written 9 Oct 2026, about 2 am, after the first live runs.

## Is this a demo?

No. It is a working product core with a weak surface.

- **Real:** the database, the agent picking its own tools, locking the offer facts, the fact guard, approvals, QR and counter-code tracking, the Bayesian experiments, and the activity log. All of it runs on Supabase, and 28 automated tests cover it.
- **Synthetic, and labelled as such in the app:**
  - the café (Kaapi Kone)
  - its 32 customer reviews
  - its 3 past campaigns
- **Not built yet:** posting to Instagram or WhatsApp. Meta's APIs need a verified business account, which we can't get in a hackathon. Instead, the owner taps "Share" and the phone's share sheet opens with the finished post and its tracking link. Scans and redemptions are then measured for real.

The parts that win or lose the demo are exactly the ones that are weak right now:
- how it looks
- how good the posts are
- whether it ever says something untrue

The rest of this document is the plan to fix those three without rebuilding the core.

## What the live runs showed

| Problem | What we saw | Root cause |
|---|---|---|
| UI looks generic | Text-heavy screens. Posts are text on blank tiles. | We designed screens, not the product the owner sees, which is the posts. |
| Instagram posts are bland | No picture on any post. Copy is generic ("step into Kaapi Kone"). | The image tool exists, but the agent never calls it. Nothing places the offer text onto a photo. The copy prompt has no examples or strong hooks. |
| Hallucinations | It invented offer dates ("12 to 30 October") and a "DM us for the code" step that doesn't exist. Its Kannada had made-up words, "night" for pm, and "cancellation" for off. | The model fills gaps the owner left. The meaning check is optional and run by the same model that wrote the text. Agnes's Kannada is weak. |
| Agnes reliability | Arguments in the wrong format, replies that weren't JSON, announcing a step instead of doing it. | Agnes has no JSON mode, and its tool calling is loose. Several workarounds are already in. |

Already fixed during the live runs:
- a translation check before locking, plus a spelling check for Kannada and Hindi
- a built-in list of banned claims in English, Kannada and Hindi
- one automatic fix-up pass when the guard blocks a piece
- a nudge when the agent announces a step instead of doing it
- error recovery, so a failed run says so instead of hanging
- the agent resumes after the owner approves

## The plan

The architecture stays as it is. It was built so the model could be swapped and the guard rails could be tightened, and that is what the fixes need.

### 1. Models: Gemini first, and the checker is never the writer

The model router already maps roles (reasoning, generation, verification, image) to providers. Gemini's API works the same way as the code we already have, so switching is mostly configuration.

| Role | Main | Fallback | Why |
|---|---|---|---|
| Reasoning (the agent) | Gemini Flash | Agnes | More reliable tool calling, plus real JSON output that is guaranteed to match our format, which ends the "reply wasn't JSON" failures. |
| Generation (copy) | Gemini Flash | Agnes | Better Kannada and Hindi; same JSON guarantee. |
| Verification (meaning check) | **A different model from the writer** (Gemini Pro, or Agnes) | — | A model checking its own work is lenient; we saw that live. |
| Image | Gemini image model if billing is on, otherwise Agnes Image | the other one | Free tiers for image generation seem to be zero or very small, so check the AI Studio quota page before relying on one. |

Saved model outputs stay as the demo fallback, labelled "Saved output", in case the venue Wi-Fi or a quota fails on stage.

### 2. Hallucinations: make inventing things impossible, not just discouraged

1. **Track where each fact came from.** Every offer fact is marked either *from the owner* (it appears in the brief or a later message) or *assumed by Counterpart*. Numbers and dates are compared against the owner's own words by rule, not by the model. The facts screen highlights assumed facts, and they can't be locked until the owner confirms each one. That turns "invented dates" into "Counterpart suggested 12 to 30 Oct; confirm?".
2. **Only real calls to action.** The system tells the writer which customer actions actually exist: show the code at the counter, scan the QR code, tap the link. A call to action outside that list, like "DM for the code", is blocked by rule.
3. **The meaning check always runs.** After generation, every piece is automatically checked by the independent model before the owner sees it. Pieces that fail stay blocked and show the reason.
4. **Kannada and Hindi:** keep the spelling check and the translation check. A Kannada speaker on the team edits the offer wording once per campaign: the agent drafts it, a person corrects it, and the checks run again. This is also how a real owner would work. The offer wording is short and reused everywhere, so correcting it once fixes every piece.

### 3. Posts that look like posts

1. **Every Instagram post, story and poster gets a picture automatically.** The image model draws a photo with no text in it, styled to the brand (steel tumbler, banana leaf, morning light).
2. **The system writes the offer onto the picture.** It renders the exact locked wording in brand fonts, so the offer text is never drawn by the image model and can't be misspelt or changed. Three or four layouts per channel, with real Kannada and Devanagari fonts.
3. **Owner photos as a starting point (optional).** The owner can upload a few real photos of the menu, and the image model uses them as a reference so the food looks like theirs.
4. **Better copy.**
   - A few strong example posts for the brand go into the prompt.
   - Sharper angles to write from: exam-week rescue, "your usual table", queue-free hours.
   - The writer drafts two hooks per piece and keeps the stronger one.
   - A ban on AI clichés.
5. **Preview the real thing.** Posts are shown at true size and look like an Instagram feed or a WhatsApp chat. They can be downloaded as a PNG or shared with one tap.

### 4. UI redesign with the taste skills

The installed skills are in `.claude/skills/`. We'll mainly use `redesign-existing-projects` and `design-taste-frontend`.

**Design read:** a mobile-first operations app for a busy café owner who glances at it between orders. It should feel calm and trustworthy, using a real design language built from the café's own colours. The posts are the hero, not the dashboard.

Settings for the skill's three dials: variance 5, motion 4, density 4. It's a work tool, not a landing page.

What changes:
- **Look:**
  - New palette. The current warm paper and espresso colours are a family the skill specifically bans.
  - One accent colour.
  - A font swap, with matching Kannada and Devanagari fonts.
  - Phosphor icons instead of Lucide.
- **Structure:**
  - Mobile-first navigation (bottom tabs on phones, a slim rail on desktop) instead of a dashboard sidebar.
  - Today becomes one clear "next thing to do" card plus the approval queue.
  - A campaign reads top to bottom: Offer → Posts (large visual previews) → Results.
- **Feel:**
  - Loading skeletons.
  - Proper empty and error states.
  - Press feedback on buttons.
  - Short, purposeful motion.
- **Kept:** the receipt-roll activity log is the one distinctive element, re-styled to fit the new design.

### 5. Making the demo safe

- A "Reset demo" control that reloads the café data in one click.
- Saved model outputs for the full golden path, replayed only if a live call fails, and labelled as saved.
- Deploy so the judges can scan a QR code on stage: backend on Railway or Render, frontend on Vercel, both pointing at the existing Supabase project.

## Order of work

Assuming about 20 hours remain (the build started on 8 Oct). Adjust if the deadline differs.

| # | Work | Time | Why this order |
|---|---|---|---|
| 1 | Switch to Gemini; checker on a different model; meaning check always runs | 1.5 h | Every later step depends on reliable model output. |
| 2 | Fact provenance and the list of real calls to action | 2 h | Removes the hallucinations judges would catch. |
| 3 | Visual posts: picture plus system-rendered text, true-size previews, share and download | 4 h | The biggest visible improvement. |
| 4 | UI redesign, screen by screen (Today, Campaign, Counter, QR landing page first) | 5 h | Done after the posts exist, so the posts are what we design around. |
| 5 | Kannada wording editor; copy-quality pass | 1.5 h | Small, high-trust gains. |
| 6 | Saved demo run, Reset demo, deploy, rehearse the golden path twice | 3 h | Never demo something that hasn't been rehearsed. |
| | Buffer | 3 h | Something always breaks. |

## What stays the same

- **Locked facts.** Offer facts are versioned and fixed once locked, enforced by the database. Copy refers to facts through placeholders, never by typing the values.
- **Approvals.** Anything customers see, and any change to the offer, needs the owner's approval.
- **Measurement.** Tracking codes and QR codes with real counting of scans, claims and redemptions. Small-sample Bayesian experiments.
- **The activity log**, recording everything the owner, agent and customers did.
- **Secrets.** Keys stay on the server only.

These are what answer the judges' "why not just ChatGPT?". The model is a replaceable part; the system is what guarantees the owner never publishes a wrong offer, and what measures whether a campaign brought people in.

## What we need from you

1. **A Gemini API key.**
   - Create it at https://aistudio.google.com/apikey and put it in `backend/.env` as `GEMINI_API_KEY=...`. Never paste it in chat.
   - Tell us whether billing is on. That decides which model draws the pictures.
2. **A Kannada speaker** who can spend 10 minutes per campaign checking the offer wording. Or say if the demo should lead in English and Hindi instead.
3. **The deadline**, so the time boxes above can be adjusted.
4. **Optional: 3 to 5 real café or food photos** to use as image references.
5. **Push the code** (VS Code → Source Control → Publish Branch).
