# powlo

**An agent that texts the other person for you.**

Every messaging agent talks to *you*. powlo talks to *them*.

You text powlo what you want. It opens a **separate iMessage thread with the other
party** — someone who has never heard of powlo, no app, no signup, no account — works
the conversation on your behalf, and reports back into your thread on a card that
updates in place.

```
   you ──────► powlo ──────► your old landlord
       iMessage        iMessage / SMS / RCS
                              (never signed up for anything)
```

That second arrow is the whole product, and it is the one thing you cannot build
anywhere else. Every other agent platform can only reach people who are already its
users. Photon gives powlo a real line that starts conversations with strangers and
falls back to SMS/RCS when they aren't on iMessage.

---

## What it actually does

1. **Takes the brief.** Objective, the other party's number, and your floor — the
   worst outcome you'd still accept. One question at a time, then it stops asking.
2. **Opens the other thread.** A real DM to a real phone number. Its first message
   always says it's an automated assistant acting for you — see [Disclosure](#disclosure).
3. **Works the conversation.** Answers their questions, holds your position, never
   asserts a fact you didn't give it.
4. **Stops when it hits your limit.** An offer under your floor, a term you never
   approved, a question only you can answer — powlo goes quiet with them and asks
   you. It will not trade away something you didn't authorise.
5. **Reports on a live card.** One bubble in your thread that rewrites itself as the
   other side moves. Your thread never fills up with status updates.

## Photon surface used

| Primitive | Where |
|---|---|
| `im.space.create(user)` — open a DM with a number that never messaged you | [`src/channel.ts`](src/channel.ts) |
| Two concurrent spaces, one agent, one unified transcript | [`src/index.ts`](src/index.ts) |
| `app(url, {live:true})` + `edit()` — live card updated **in place** | [`src/channel.ts`](src/channel.ts) |
| Screen effect (confetti) when a case closes | [`src/channel.ts`](src/channel.ts) |
| Tapback acknowledgement on inbound messages | [`src/channel.ts`](src/channel.ts) |
| `space.responding()` typing indicators on both threads | [`src/index.ts`](src/index.ts) |
| SMS/RCS fallback — the other party needs no iMessage | automatic |
| Terminal provider — the same agent, driven locally | [`src/channel.ts`](src/channel.ts) |

The live card renders through Photon's App-Store-approved Spectrum launcher, so it
needs no Apple developer account.

## Disclosure

powlo's opening message to the other party always states that it is an automated
assistant texting on someone's behalf. This is enforced in the system prompt and is
on by default (`POWLO_DISCLOSE=true`).

An agent that texts strangers on your behalf and lets them believe it's a person is
a worse product and, in several US states, an illegal one. powlo is more effective
when it's straight about what it is — that's the part that makes people answer.

## Run it

### Locally, with no accounts at all

```bash
npm install
npm run sim      # scripted brain, fake threads — proves the routing end to end
```

`npm run sim` needs no API key and no Photon project. It drives the real router with
fake spaces so you can watch powlo take a brief, open the second thread, refuse an
under-floor offer, escalate to you, and close.

### On iMessage

```bash
cp .env.example .env      # fill in the four values
npm start
```

| Variable | Where it comes from |
|---|---|
| `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` | [app.photon.codes](https://app.photon.codes) → project Settings |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `POWLO_PUBLIC_URL` | a public HTTPS tunnel to `POWLO_PORT`, for the live card |

**Use a Cloudflare quick tunnel, not ngrok.** ngrok's free tier serves an
interstitial warning page to browser user-agents, which is what the iMessage card
webview is — the card renders ngrok's warning instead of your case. Verified.

```bash
cloudflared tunnel --url http://localhost:8787   # npm run tunnel
```

Put the `https://….trycloudflare.com` URL it prints into `POWLO_PUBLIC_URL`, then
start powlo. The tunnel must be up first — the card URL is baked in at send time.

**On the Free and Pro plans, every number powlo messages must be registered as a
User on the project** (Dashboard → Users) — that includes the other party. Free
allows 10, which is plenty for a two-party case. The Business plan uses a dedicated
line and drops the allowlist entirely.

If a send fails with `Target not allowed for this project`, that allowlist is why.
[debug.photon.codes](https://debug.photon.codes) reports the exact handle Apple is
sending your iMessage from, which is often not the number you'd expect.

## Always-on deploy (Render)

powlo holds a live connection to the Photon line, so it has to stay running to
receive anything. `render.yaml` is a blueprint — point Render at this repo and it
picks it up.

Set these as environment variables in the Render dashboard (they are `sync: false`,
so they are never committed):

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | your key |
| `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` | from app.photon.codes |
| `POWLO_PUBLIC_URL` | the service's own URL, e.g. `https://powlo.onrender.com` |

`POWLO_PUBLIC_URL` must match the deployed hostname — it is baked into the live
card at send time, and a mismatch renders a dead card. Deploying also removes the
need for a local tunnel entirely.

**Plan matters.** Render's free tier sleeps after ~15 minutes idle; a sleeping
powlo misses inbound texts. `starter` stays up. Free is fine for a demo you
control the timing of, not for a line people actually text.

State lives in `POWLO_STATE` (a JSON file). Without an attached disk it resets on
each deploy, which loses in-flight cases but nothing else.

## Layout

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Routes each inbound message to the right side of the right case |
| [`src/brain.ts`](src/brain.ts) | Intake, opening, negotiation, relay — each a strict-schema decision |
| [`src/channel.ts`](src/channel.ts) | The only module that knows iMessage from terminal |
| [`src/store.ts`](src/store.ts) | Durable cases, so a restart doesn't forget what powlo conceded |
| [`src/web.ts`](src/web.ts) | The page behind the live card |
| [`src/sim.ts`](src/sim.ts) / [`src/fake.ts`](src/fake.ts) | Offline end-to-end simulation |

## Models

powlo splits the work across two tiers of GPT-5.6:

| Call | Model | Why |
|---|---|---|
| intake, opening, relay | `gpt-5.6-luna` | conversational turns, cheap and fast |
| **negotiation** | `gpt-5.6-terra` | the one decision that decides whether an offer breaches your floor |

Override either with `POWLO_MODEL` / `POWLO_MODEL_NEGOTIATE`. Set both to
`gpt-5.6-luna` to run the whole agent on one model.

Every decision is a strict structured output via the Responses API, so the router
never has to defend against a malformed reply.

Built on [Photon Spectrum](https://photon.codes) with GPT-5.6.
