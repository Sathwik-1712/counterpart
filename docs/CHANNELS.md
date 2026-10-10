# Connect WhatsApp and Instagram

**Cost:** free. No card needed.
**Time:** about 20 minutes. New Meta developer accounts may have to wait about an hour before they can create an app.

You'll copy **5 values** from Meta's website. Then one command does the rest.

| # | Value | Looks like |
|---|---|---|
| 1 | App ID | `1234567890123456` |
| 2 | App secret | 32 letters and digits |
| 3 | Phone number ID | `1029384756...` (a long number, not a phone number) |
| 4 | WhatsApp token | starts with `EAA` |
| 5 | Instagram token | starts with `IGAA` (optional) |

Keep a notes file open and paste each value into it as you go.

> Meta renames buttons sometimes. If a button isn't there, pick the closest match.

---

## Step 1. Create the app

Go to **developers.facebook.com → My Apps → Create app**. The wizard has five screens:

1. **App details:** name it `Counterpart` and add your email. Press **Next**.
2. **Use cases:** tick **Connect with customers through WhatsApp**. If **Manage messaging and content on Instagram** can also be ticked, tick it. Press **Next**.
3. **Business:** pick your business portfolio, or press **Create a business portfolio** and fill it in. It's free, and testing doesn't need verification. Press **Next**.
4. **Requirements:** nothing to do. Press **Next**.
5. **Overview:** press **Create app** and enter your Facebook password.

---

## Step 2. WhatsApp: values 3 and 4

You should now be on **Connect on WhatsApp → Quickstart**. If you're somewhere else, open the left menu, go to **Use cases**, and press **Customize** next to WhatsApp.

1. Press **Start using the API**. The **API Setup** page opens.
2. At the top, pick the WhatsApp Business Account. Meta usually creates a test one for you.
3. Press **Generate access token**, then **Continue**. Tick your WhatsApp account and press **Save**.
   Copy the token that starts with `EAA`. **That's value 4.**
4. Under **From** there's a test number (`+1 555 …`). Under it is **Phone number ID**.
   Copy that ID. **That's value 3.**
5. Under **To**, press **Manage phone number list → Add phone number**. Enter your own number with `+91`, then type the 5-digit code WhatsApp sends you.
6. Pick your number in **To** and press **Send message**. A "Hello World" message arrives on WhatsApp. Reply **hi**.

Skip the Webhook / Configuration page. The command sets that up for you.

---

## Step 3. App ID and secret: values 1 and 2

1. In the left menu, go to **App settings → Basic**.
2. Copy **App ID**. **That's value 1.**
3. Next to **App secret**, press **Show**, then enter your password. Copy it. **That's value 2.**

---

## Step 4. Instagram: value 5 (optional, can be done later)

**Make your account professional (on your phone):**
In Instagram, go to **Profile → ☰ → Account type and tools → Switch to professional account**, then pick **Creator** or **Business**. If it's already professional, skip this.

**Add Instagram to the app:**

1. In the left menu, go to **Use cases → Add use case → Manage messaging and content on Instagram → Add**.
   If Meta won't allow it, create a second app with only this use case. That works fine.
2. Press **Customize** next to it, then choose **API setup with Instagram login**. Don't choose the "Facebook login" option.

**Invite yourself as a tester:**

3. In the left menu, go to **App roles → Roles → Add People → Instagram Tester**. Type your Instagram username and press **Add**.
4. On a computer, open **instagram.com → Settings → Website permissions → Apps and websites → Tester invites**, then press **Accept**.

**Get the token:**

5. Back in the dashboard, go to **API setup with Instagram login → Generate access tokens → Add account**. Log in and press **Allow**.
6. Press **Generate token** and tick **I understand**. Copy the token that starts with `IGAA`. **That's value 5.**

---

## Step 5. Run the command

First make sure Counterpart is running and your business has at least one approved post.

```sh
cd ~/Desktop/Hackerring/backend
uv run python -m scripts.go_live
```

- Paste each value when it asks.
- Secrets stay hidden while you type. That's normal.
- No Instagram yet? Press **Enter** at that question.

It worked if every line starts with ✓:

```
✓ Meta app: Counterpart
✓ WhatsApp token now lasts 60 days
✓ WhatsApp number: +1 555 ...
✓ WhatsApp Business Account found
✓ Instagram: @yourname
✓ Connected to your business: <your business>
✓ Public address: https://....trycloudflare.com
✓ Webhook registered with Meta
```

- **A line starts with ✗:** it says which value is wrong. Fix that value and run the command again with `--reset` at the end.
- **Keep this window open.** Closing it takes WhatsApp offline.
- **After restarting the computer:** run the same command again. It won't ask anything.
- **Adding Instagram later:** run it with `--reset`.

---

## Step 6. Try it on your phone

1. In Counterpart, open **Results**, then **Copy link** on a post. Open the link on your phone.
2. Tap **Get it on WhatsApp** and send the message. The bot replies with your personal code.
3. In Counterpart, open **Counter**, enter the code and press **Redeem**.
4. WhatsApp asks for 1–5 stars. Reply something like `4 great coffee`. It appears on the **Customers** page.
5. Instagram: on a live post, press **Post to Instagram**. Reach and likes appear under **Performance** within a few hours.

---

## Good to know

**What's free**
- Messages customers send you, and your replies within 24 hours.
- Posting to Instagram and reading its numbers.

**What costs money (optional)**
- Messaging someone who hasn't written in the last 24 hours costs about ₹0.86 per message. It also needs a Meta-approved template.

**Test limits**
- The test WhatsApp number only talks to the 5 numbers you add in Step 2.
- Only Instagram accounts invited as testers can connect.
- Real customers need Meta business verification and app review.

**If the command says the webhook wasn't registered**
1. In the dashboard, go to **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** paste the link the command printed.
3. **Verify token:** run `grep WHATSAPP_VERIFY_TOKEN backend/.env` and paste the value after the `=`.
4. Press **Verify and save**. Then press **Manage** and subscribe to **messages**.

**Security**
- Meta signs every webhook message with your app secret, and anything unsigned is refused.
- Tokens stay in `backend/.env` and the database, never in the browser.
- A customer who sends **STOP** gets no more messages. **START** turns them back on.
