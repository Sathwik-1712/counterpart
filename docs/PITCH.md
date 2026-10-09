# Counterpart: the pitch

**HR26 Agnes AI India Hackathon · HR26-AI-02 Marketing Campaigns · Agentic AI track**

> **The marketing employee behind your counter.** A shop owner says the offer in their own words. Counterpart writes it down, makes the posts in English, Kannada and Hindi, checks every word against what the owner approved, gives each post its own link and QR code, and counts who actually walks in.

---

## 1. The problem

India has about 63 million micro, small and medium businesses (MSME ministry estimate; check the latest figure before quoting): cafés, bakeries, salons, gyms, clinics, kirana stores. Their marketing is a WhatsApp forward and a handwritten board.

- **No time.** The owner is behind the counter all day. Marketing happens at 11 pm, if at all.
- **No skills or budget.** An agency is too expensive. A freelancer disappears.
- **Generic AI makes it worse.** ChatGPT writes "Elevate your evenings, indulge in our exquisite offerings!" It sounds fake, it invents prices and dates, and its Kannada is often wrong.
- **No idea what worked.** A post goes out and nobody knows whether it brought a single customer in.

The real risk isn't a boring post. It's a post that promises "free coffee all day" when the offer was 15% off from 4 to 7 pm. That costs the owner money and trust.

## 2. The solution

Counterpart behaves like an employee, not a chatbot. Every campaign goes through the same five steps, and the app always shows which step a campaign is on and what the owner does next.

| Step | Who | What happens |
|---|---|---|
| **1. Brief** | Owner | Types or **speaks** the idea (English, ಕನ್ನಡ, हिन्दी): "15% off filter coffee and dosa, weekdays 4 to 7, for students." |
| **2. Offer** | AI drafts, owner **locks** | The offer is written down as structured facts in every language. Each translation is read back into English, the margin is checked against real menu costs, and anything the AI assumed (like dates) is flagged. Nothing goes further until the owner locks it. |
| **3. Posts** | AI writes, a *different* AI checks, owner approves | Instagram posts, stories, counter posters and WhatsApp messages, per audience and language, with **real photos of the business**. A rule-based guard blocks any number, claim or robotic phrase the owner didn't approve. |
| **4. Share** | Owner | Each approved post gets its own link and QR code: one-tap WhatsApp send, a ready Instagram caption, and a printable QR for the counter. |
| **5. Results** | Counted | Link opened → code claimed → **redeemed at the counter**. A/B tests show which message brought people in, and the learnings feed the next campaign. |

## 3. How it meets the brief

The official HR26-AI-02 text isn't saved in the repo. This table maps what a marketing-campaign agent is expected to do. **Before the pitch, paste the official requirement list here and check each line.**

| Expected capability | How Counterpart does it | Where |
|---|---|---|
| Understand the business | Onboarding: products and prices, languages, website. The brand voice is drafted for the owner to edit. Customer reviews are read for themes. | `/onboarding`, Brand, Customers |
| Plan a campaign | The agent sets goal, audience, channel and language, picks angles, and checks margin and break-even before any discount is locked. | `set_campaign_plan`, `evaluate_offer` |
| Generate content | Headlines and messages per channel and language, in the brand's voice, with real business photos matched to each post. An AI picture is only a labelled fallback. | `generate_copy`, `photos.py` |
| Multilingual, local | Writes natively in English, Kannada and Hindi (not word-for-word translation), with spelling and translation checks. | Fact guard L1/L2, wording check |
| Accuracy and safety | Locked offer facts, a deterministic guard, an independent AI meaning check, and owner approval before anything reaches customers. | §5 |
| Distribution | Per-post links, QR codes, WhatsApp share, Instagram caption, printable counter poster, downloadable PNG. | Share step |
| Measurement | Opens, claims and in-store redemptions per post; conversion per campaign; a dashboard sorted by results. | Campaigns, Results, Counter |
| Optimisation | Bayesian A/B tests (small-sample friendly) with priors from the business's own history; learnings are recorded and reused. | `stats.py`, experiments |
| Agentic behaviour | One agent picks among **17 tools** itself, works through prioritised findings, asks for approval only when needed, and resumes after the owner decides. | `agent/runtime.py` |

## 4. The AI team

Five roles, each with one job and its own model chain. **The model that writes a post never checks it.**

| Agent | Job | Models (in order) |
|---|---|---|
| **Planner** | Reads the situation, decides the next step, calls tools | Gemini 3.5 Flash-Lite → backups |
| **Writer** | Headlines and messages, natively per language | Gemini 3.6 Flash → backups |
| **Checker** | Independent meaning check: every promise against the locked facts | Gemini 3.5 Flash → backups (never the writer's) |
| **Photo reader** | Captions the business's own photos once, so each post gets the best real match | Gemini Flash-Lite (vision) |
| **Picture maker** | Only when a business has no photos: an AI picture, always labelled | Agnes Image 2.5 Flash |

**It keeps working on free tiers.** A model router fails over in milliseconds when a model is busy, out of quota or hanging, and rests that model. The order is: Gemini → a second Gemini key from another project → Groq → Cerebras → **Agnes** (all free, no card). Every call is tagged with the business, campaign and task, and shown live on the **AI team** page.

## 5. Why not just use ChatGPT?

The model is a replaceable part. The **system** is the product.

1. **Locked offer facts.** The writer never types a price, time or date. It writes `{{discount}}`, and the system fills in the owner-approved wording. The database refuses edits to a locked offer; changing it means locking a new version.
2. **A three-layer guard on every post.**
   - **L1:** any number the AI typed itself, and broken Kannada or Devanagari letters.
   - **L2:** missing facts, forbidden claims ("free", "unlimited", "delivery", "DM us"), brand-banned words, and **machine-sounding phrases** ("elevate", "indulge", "nestled", long dashes).
   - **L3:** an independent model checks the meaning.
   - Blocked posts get one automatic repair round, using the guard's exact reasons.
3. **Owner in control.** Anything customers see, and any offer change, becomes an approval in the owner's inbox.
4. **Real attribution.** Every post has its own code. When staff type a code on the Counter screen, the sale is counted for the exact post that brought the customer in.
5. **It learns.** A/B results become learnings with evidence, and the next campaign uses them.
6. **Everything is logged.** Every step by owner, agent and customer is in an append-only ledger (the "work log").

## 6. What makes it feel human, not AI

- **The voice comes from the owner.** Brand voice is plain words a regular would hear at the counter. Generated copy that sounds like an agency or an AI is *blocked by rule*, not just discouraged in a prompt.
- **Real photos of the business**, from the owner's phone or the business website (SSRF-guarded import), auto-captioned and matched to each post.
- **Each business gets its own colours.** Eight themes (Filter coffee, Banana leaf, Kumkum, Rose, Monsoon, Saffron, Charcoal, Counter book) are picked automatically from the brand palette and type of business, or chosen on the Brand page. The whole app and the posts recolour.
- **A copyright watermark.** A faint "© Business name" is tiled across each post photo, plus a clear corner mark. It survives downloads, so others can't easily lift the pictures. It can be switched off.
- **A design language from the shop counter**: bill-book rules, ballpoint-blue for the AI's work, highlighter-yellow for "needs you", signboard type. One font family (Anek) covers English, Kannada and Hindi.

## 6b. Culture, not just language

Festivals and cultural context are built in, and hand-checked rather than generated:
- **Covered:** Dasara (Karnataka's Nadahabba), Kannada Rajyotsava, Deepavali, Christmas, New Year, Sankranti, Ugadi, Gowri-Ganesha, Eid and Holi.
- **For each festival:**
  - the greeting written natively in English, ಕನ್ನಡ and हिन्दी (e.g. "ದಸರಾ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು", "दशहरा की हार्दिक शुभकामनाएँ"), plus sayings such as "ಎಳ್ಳು ಬೆಲ್ಲ ತಿಂದು ಒಳ್ಳೆ ಮಾತಾಡಿ" for Sankranti;
  - the customs people actually follow (bombe habba, Ayudha Puja at the shop, Vijayadashami new beginnings, Lakshmi Puja on account books);
  - post angles that fit;
  - what to avoid (e.g. no meat imagery in Navaratri posts, no daytime food promos to people fasting in Ramzan).
- **Where it shows up:**
  - The agent sees festivals coming up in the next month and plans around them.
  - The writer gets the festival's greetings and customs whenever a campaign names it (in any script) or runs during it.
  - Today shows "Festivals coming up" cards.
  - The campaign page shows festival notes.
  - The optimisation tips flag "Dasara starts in 2 days".
- Every greeting passes the same Kannada and Devanagari spelling guard as the posts.

## 7. Product tour (demo script, about 4 minutes)

1. **Sign in → "Try the demo business"** (Kaapi Kone, a Jayanagar café). Point out the business's own colours.
2. **Today:** the yellow "things need you" block, the notepad. **Speak** a brief in Kannada or English. → *Start campaign.*
3. **Campaign page:** the five-step bar and the "Next" line. The agent banner shows it working live (open **AI team** to see the Planner, Writer and Checker and the models each one used).
4. **Offer:** read-back translations, the margin check, an "assumed" flag. → **Lock**.
5. **Posts:** real photos, the watermark, the "Matches the locked offer" seal. Open **Edit post**, type "Elevate your break — indulge!!" and show the live *"Sounds machine-written"* warning. Try "30% off" and show it gets blocked. → **Approve all**.
6. **Share:** one-tap WhatsApp, caption, QR. Scan the QR with a phone (the landing page claims a code).
7. **Counter:** type the code → redeemed. **Campaigns** and **Results** update: opened → claimed → redeemed, conversion, best post.
7b. **Performance** (on the campaign page; on the demo, click "Simulate a week of customers", which is labelled as simulated):
   - the funnel with stage rates;
   - "How to do better" tips with one-tap "Ask Counterpart to do it" (e.g. "Kannada converts 1.7x better than English", "Dasara starts in 2 days", "Most people open links around 6 pm");
   - the day-by-day chart and best time to post;
   - breakdowns by channel, language and audience;
   - every post ranked.
8. **A/B test:** "chance each version is better", what happened, and how much more data is needed.
9. **Brand:** switch the theme live, toggle the watermark, show the "never sounds like a robot" rules.

**Have ready:** a phone for the QR scan, the deployed URL, and the demo reset.

## 8. Metrics we track

| Stage | Metric | How it's measured |
|---|---|---|
| Reach | Posts live | Approved posts, each with a tracking code |
| Interest | Links opened | Visits to `/r/<code>` (QR scan or link tap) |
| Intent | Codes claimed | "Get my code" taps on the landing page |
| Sales | Redeemed at the counter | Staff type the code on the Counter screen |
| Efficiency | Conversion | Redeemed ÷ opened, per post, campaign and business |
| Learning | Chance best, expected loss | Bayesian A/B per experiment, with the business's own history as prior |
| Timing | Opens and redemptions by day and by hour | Outcome timestamps (IST) |
| Mix | Conversion by channel, language and audience | Grouped per post |
| Quality | Guard pass rate, repairs, owner edits | Ledger, per post |
| Cost | Model calls, tokens, list-price cost | Router call log (the AI team page) |

## 9. Architecture

```
Browser (Next.js 15, React 19, Tailwind 4)
   │  httpOnly session cookies, no keys or tokens in the page
Next server: proxy + Supabase Auth session
   │
FastAPI (Python 3.12), a modular monolith
   ├─ agent/      runtime (policy gate, budgets, timeouts), 17 tools, situation detectors, prompts
   ├─ domain/     facts + guard (L1/L2), audit (L3), stats (Bayesian), economics, impact
   ├─ providers/  role router: Gemini · Groq · Cerebras · Agnes, failover, rest, record/replay
   ├─ photos.py   website import (SSRF-safe), uploads, vision captions, deterministic matching
   └─ services.py every business rule, shared by API and agent
   │
Supabase: Postgres (16 tables, RLS on, immutability trigger), Auth, Storage
```

- **Deploy-ready:** the backend Dockerfile and `render.yaml` (Render), the frontend on Vercel, and Supabase in Mumbai. See `docs/DEPLOY.md`.
- **Multi-tenant:** email/password accounts. Every route checks membership; another business's data returns 404.
- **Tested:** 51 backend tests, including an end-to-end loop (brief → facts → lock gate → copy → guard blocks → publish → scan → claim → redeem → experiment → "Sunday only" marks exactly the affected posts stale). Lint clean, production build passes.

## 10. Running cost

| Item | Cost for a pilot |
|---|---|
| Models | ₹0 on the free tiers of Gemini, Groq, Cerebras and Agnes, with automatic failover. Paid Gemini Flash is fractions of a rupee per campaign. |
| Database, auth, storage | Supabase free tier |
| Hosting | Render and Vercel free or hobby tiers |
| Photos | Owner uploads and website import, free. Google Maps photos are optional and need a billing account. |

## 11. Business model (proposal, prices not validated)

- **Free:** 2 campaigns a month, 1 business, watermark always on.
- **₹499 per month per business:** unlimited campaigns, all languages, A/B tests, staff counter logins, watermark optional.
- **Agencies and chains:** many businesses under one login (already supported by the business switcher).

## 12. Honest limits and what's next

| Today | Next |
|---|---|
| Posting is one tap (WhatsApp share, caption copy, download). Direct auto-posting needs Meta business verification. | Instagram Graph API and WhatsApp Business API once verified |
| Kannada and Hindi are checked by rule and by back-translation, but model quality varies | Owner-corrected phrasebook per business; an Indic-specialised model in the chain |
| Counter screen uses the owner's login | Staff logins with redeem-only access |
| No password reset email yet | Supabase reset flow |
| Kaapi Kone's past campaigns and reviews are synthetic and labelled so in the app. Live scans and redemptions are real. | Pilot with 3 to 5 real shops |
| Watermark is drawn on the post, not stored in the original photo | Server-side stamped originals |

## 13. Likely judge questions

- **"Isn't this a GPT wrapper?"** No. Take the model out and the locked facts, the guard, the approvals, the attribution codes, the experiments and the ledger still run. The model fills in sentences; the system decides what's allowed and measures what worked.
- **"What stops it hallucinating a price?"** It can't type one. Values come only from locked slots, and any digit the model types is blocked (L1).
- **"How do you know it worked?"** A per-post code redeemed at the counter, not likes.
- **"What if the AI provider goes down?"** The router fails over across four free providers in milliseconds. Saved outputs are replayed only as a last resort, and are labelled.
- **"Why would a shop owner trust it?"** Nothing reaches customers without the owner's approval, and every action is in the work log.

---

*Repo map: `README.md` (setup), `CLAUDE.md` (architecture and invariants), `docs/APPROACH.md` (design decisions), `docs/DEPLOY.md` (deploy).*
