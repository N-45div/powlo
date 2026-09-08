import { pathToFileURL } from "node:url";
import { assertReady, config } from "./config.js";
import { store } from "./store.js";
import { intake, negotiate, openingMessage, relay } from "./brain.js";
import { ack, boot, celebrate, openWith, upsertCard, type App } from "./channel.js";
import { caseUrl, startWeb } from "./web.js";
import type { Case } from "./types.js";

export type AnySpace = { id: string; send: (c: unknown) => Promise<unknown>;
                         responding: <T>(fn: () => Promise<T>) => Promise<T> };

/** Live handles that can't be serialised: space objects and the card message. */
const live = new Map<string, { principal?: AnySpace; counterparty?: AnySpace; card?: unknown }>();
const handles = (id: string) => {
  let h = live.get(id);
  if (!h) live.set(id, (h = {}));
  return h;
};

/** Bind already-open spaces to a case. Used on restart and by the simulator. */
export function registerSpaces(
  caseId: string,
  spaces: { principal?: AnySpace; counterparty?: AnySpace },
) {
  Object.assign(handles(caseId), spaces);
}

async function counterpartySpace(app: App, c: Case): Promise<AnySpace | undefined> {
  const h = handles(c.id);
  if (h.counterparty) return h.counterparty;
  if (!c.counterparty) return undefined;
  // Restarted mid-case — re-open the thread rather than losing the negotiation.
  h.counterparty = (await openWith(app, c.counterparty)) as unknown as AnySpace;
  c.counterpartySpaceId = h.counterparty.id;
  store.save(c);
  return h.counterparty;
}

async function refreshCard(c: Case) {
  const h = handles(c.id);
  if (!h.principal) return;
  try {
    h.card = await upsertCard(h.principal, caseUrl(c), h.card);
    if (!c.cardSent) {
      c.cardSent = true;
      store.save(c);
    }
  } catch (err) {
    console.error("[card] update failed:", (err as Error).message);
  }
}

/** The moment powlo stops talking to you and starts talking to them. */
async function openTheThread(app: App, c: Case) {
  const h = handles(c.id);
  c.status = "opening";
  store.save(c);
  await refreshCard(c);

  const them = await counterpartySpace(app, c);
  if (!them) {
    c.status = "needs_you";
    store.save(c);
    await h.principal?.send("I don't have a working number for them — what is it?");
    return;
  }

  const { text } = await them.responding(() => openingMessage(c));

  try {
    await them.send(text);
  } catch (err) {
    // Shared lines cannot open a thread with someone who has not texted first.
    // Park the case rather than dropping it: the moment they do text in, the
    // router matches their number to this case and the negotiation starts.
    console.error("[powlo] cold open refused:", (err as Error).message);
    c.status = "awaiting_contact";
    c.headline = "Waiting for them to make contact";
    store.save(c);
    await refreshCard(c);
    await h.principal?.send(
      `I can't open a thread with ${c.counterpartyName ?? "them"} from this line — ` +
        `they have to text it first. Ask them to text ${config.lineNumber}, ` +
        `and I'll take it from there.`,
    );
    return;
  }

  store.append(c, { side: "counterparty", who: "powlo", text });
  c.status = "negotiating";
  store.save(c);
  await refreshCard(c);
}

/** They finally texted in on a case that was parked. Open with them now. */
async function greetParkedCounterparty(c: Case, space: AnySpace) {
  registerSpaces(c.id, { counterparty: space });
  c.counterpartySpaceId = space.id;
  const { text } = await space.responding(() => openingMessage(c));
  await space.send(text);
  store.append(c, { side: "counterparty", who: "powlo", text });
  c.status = "negotiating";
  c.headline = "Thread open with them";
  store.save(c);
  await refreshCard(c);
  await handles(c.id).principal?.send(
    `${c.counterpartyName ?? "They"} just made contact — I've opened with them.`,
  );
}

export async function handlePrincipal(app: App, space: AnySpace, text: string, sender: string) {
  let c = store.activeForPrincipal(sender);
  if (!c) c = store.create(sender, space.id);

  const h = handles(c.id);
  h.principal = space;
  c.principalSpaceId = space.id;
  store.append(c, { side: "principal", who: "them", text });

  // Mid-negotiation: powlo asked you something, this is the answer.
  if (c.status === "needs_you" && c.counterparty) {
    const them = await counterpartySpace(app, c);
    if (them) {
      const r = await space.responding(() => relay(c!, text));
      const out = r.text;
      // A newly authorised floor replaces the old one, or powlo would keep
      // escalating offers the principal has already accepted.
      if (r.newFloor) c.floor = r.newFloor;
      await them.send(out);
      store.append(c, { side: "counterparty", who: "powlo", text: out });
      c.status = "negotiating";
      c.headline = "Back to them with your answer";
      store.save(c);
      await refreshCard(c);
      await space.send("Sent. I'll come back to you.");
      return;
    }
  }

  const d = await space.responding(() => intake(c!, text));

  if (d.objective) c.objective = d.objective;
  if (d.counterparty) c.counterparty = d.counterparty;
  if (d.counterpartyName) c.counterpartyName = d.counterpartyName;
  if (d.floor) c.floor = d.floor;
  if (d.headline) c.headline = d.headline;
  // The model restates the whole fact list each turn, so merge rather than append.
  if (d.facts?.length) c.facts = [...new Set([...c.facts, ...d.facts])];
  store.save(c);

  await space.send(d.reply);
  store.append(c, { side: "principal", who: "powlo", text: d.reply });

  if (d.readyToOpen && c.status === "gathering") await openTheThread(app, c);
}

export async function handleCounterparty(c: Case, space: AnySpace, text: string) {
  const h = handles(c.id);
  h.counterparty = space;
  store.append(c, { side: "counterparty", who: "them", text });

  const d = await space.responding(() => negotiate(c, text));

  if (d.replyToCounterparty) {
    await space.send(d.replyToCounterparty);
    store.append(c, { side: "counterparty", who: "powlo", text: d.replyToCounterparty });
  }

  c.status = d.status;
  c.headline = d.headline;
  if (d.outcome) c.outcome = d.outcome;
  store.save(c);

  if (h.principal && d.reportToPrincipal) {
    if (d.status === "agreed") {
      await celebrate(h.principal, d.reportToPrincipal);
    } else {
      await h.principal.send(d.reportToPrincipal);
    }
    store.append(c, { side: "principal", who: "powlo", text: d.reportToPrincipal });
  }

  await refreshCard(c);
}

async function main() {
  assertReady();
  startWeb();

  const app = await boot();
  console.log(`[powlo] up on ${config.channel}`);
  if (config.channel === "terminal") {
    console.log("[powlo] you are chat-1. powlo opens the other side as its own chat.");
    console.log("[powlo] Ctrl+N new chat · Ctrl+J / Ctrl+K to switch threads");
  }

  for await (const [rawSpace, message] of app.messages) {
    if (message.direction === "outbound") continue;
    if (message.content.type !== "text") continue;

    const space = rawSpace as unknown as AnySpace;
    const text = message.content.text.trim();
    if (!text) continue;

    const sender = message.sender?.id ?? space.id;

    try {
      const existing =
        store.byCounterpartySpace(space.id) ??
        (message.sender?.id ? store.byCounterpartyHandle(message.sender.id) : undefined);

      if (existing) {
        await ack(message);
        if (existing.status === "awaiting_contact") {
          await greetParkedCounterparty(existing, space);
        } else {
          await handleCounterparty(existing, space, text);
        }
      } else {
        await ack(message);
        await handlePrincipal(app, space, text, sender);
      }
    } catch (err) {
      console.error("[powlo] turn failed:", err);
      await space.send("Something broke on my side — say that again?").catch(() => {});
    }
  }
}

// Only boot when run directly — the simulator imports the handlers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
