import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "./config.js";
import type { Case, CaseStatus } from "./types.js";
import { fakeIntake, fakeNegotiate, fakeOpening, fakeRelay } from "./fake.js";

// Constructed on first use, not at import: the OpenAI client throws without a
// key, and the offline simulator has to run without one.
let _client: OpenAI | undefined;
const client = () => (_client ??= new OpenAI({ apiKey: config.openaiKey }));

const HOUSE_RULES = `
You are powlo. You do one thing: you handle a conversation with a third party on
behalf of the person who hired you, over text message.

Hard rules, in order of priority:
1. You never lie. Not about facts, not about authority, not about what you are.
2. You never agree to anything below the principal's stated floor. If the other
   side's offer is below it, or the deal has terms the principal never approved,
   you stop and ask the principal.
3. You never invent facts. You may only assert things the principal told you, or
   things the other side already conceded in this thread.
4. You are brief. This is SMS. Two or three sentences, no letterhead, no bullet
   lists, no "I hope this message finds you well".
5. You are unfailingly polite and completely immovable. Warmth is free; the floor
   is not.

Leave a field null when it does not apply. Do not invent a value to fill it.
`.trim();

/** What powlo decides after the principal texts it. */
export interface IntakeDecision {
  reply: string;
  objective?: string;
  counterparty?: string;
  counterpartyName?: string;
  facts?: string[];
  floor?: string;
  headline?: string;
  readyToOpen: boolean;
}

/** What powlo sends back to the other side once the principal has answered. */
export interface RelayDecision {
  text: string;
  /** A revised walk-away line, when the principal just authorised one. */
  newFloor?: string;
}

/** What powlo decides after the other side texts it. */
export interface NegotiationDecision {
  replyToCounterparty?: string;
  status: CaseStatus;
  headline: string;
  reportToPrincipal?: string;
  outcome?: string;
}

// Structured outputs run in strict mode, where every property must be present.
// Optional values are therefore nullable, and stripped back to undefined below.
const IntakeSchema = z.object({
  reply: z.string().describe("What to text the principal. Short."),
  objective: z.string().nullable().describe("Set only if newly learned."),
  counterparty: z.string().nullable().describe("Phone in +E.164. Only if newly learned."),
  counterpartyName: z.string().nullable(),
  facts: z.array(z.string()).describe("New facts powlo may cite to the other side."),
  floor: z.string().nullable().describe("The walk-away line. Only if newly learned."),
  headline: z.string().nullable().describe("Six-word summary of the case."),
  readyToOpen: z
    .boolean()
    .describe("True only when objective, counterparty and floor are all known."),
});

const OpeningSchema = z.object({ text: z.string() });

const NegotiationSchema = z.object({
  replyToCounterparty: z
    .string()
    .nullable()
    .describe("What to text them. Null when escalating to the principal."),
  status: z.enum(["negotiating", "needs_you", "agreed", "stalled"]),
  headline: z.string().describe("Six-word status for the live card."),
  reportToPrincipal: z.string().nullable().describe("One line on what just moved."),
  outcome: z.string().nullable().describe("The committed terms, when status is agreed."),
});

const RelaySchema = z.object({
  text: z.string(),
  newFloor: z
    .string()
    .nullable()
    .describe("Set only when the principal authorised a new walk-away line."),
});

/** Strict mode hands back nulls; the rest of powlo speaks in undefined. */
function clean<T>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v !== null) out[k] = v;
  }
  return out as T;
}

async function decide<S extends z.ZodType>(args: {
  system: string;
  input: string;
  schema: S;
  name: string;
  model: string;
  effort: "none" | "low" | "medium" | "high";
  fallback: z.infer<S>;
}): Promise<z.infer<S>> {
  try {
    const res = await client().responses.parse({
      model: args.model,
      reasoning: { effort: args.effort },
      instructions: args.system,
      input: args.input,
      text: { format: zodTextFormat(args.schema, args.name) },
    });

    const parsed = res.output_parsed;
    if (parsed == null) {
      console.error("[brain] no parsed output; using fallback");
      return args.fallback;
    }
    return clean(parsed) as z.infer<S>;
  } catch (err) {
    // A dropped turn mid-negotiation is worse than a bland one: fall back rather
    // than leaving either thread hanging.
    console.error("[brain] decision failed:", (err as Error).message);
    return args.fallback;
  }
}

const briefSoFar = (c: Case) =>
  [
    `objective: ${c.objective ?? "(unknown)"}`,
    `other party: ${c.counterparty ?? "(unknown)"}${
      c.counterpartyName ? ` (${c.counterpartyName})` : ""
    }`,
    `floor: ${c.floor ?? "(not set)"}`,
    `facts: ${c.facts.length ? c.facts.join(" | ") : "(none yet)"}`,
  ].join("\n");

export async function intake(c: Case, message: string): Promise<IntakeDecision> {
  if (config.fakeBrain) return fakeIntake(c, message);

  const d = await decide({
    model: config.model,
    effort: "low",
    name: "intake_decision",
    schema: IntakeSchema,
    system: `${HOUSE_RULES}

Right now you are talking to your principal — the person who hired you — to take
the brief. Be quick about it. You need three things before you can start:

  - the objective (what outcome they want)
  - the other party's phone number, in +country format
  - the floor (the worst outcome they would still accept)

INFER, don't interrogate. People state the objective in their first message —
"my landlord is sitting on my 45k deposit" IS the objective: recover the 45k
deposit. Write it into the objective field and move on. Asking someone to restate
something they just told you is the single worst thing you can do here.

Record every concrete detail they give you into facts — amounts, dates, names,
what happened. You will need them to argue the case later.

Keep amounts exactly as the principal wrote them. "35k" stays "35k". Never add a
currency symbol they did not use, and never convert.

Ask for at most ONE still-missing thing per message. The moment you have all
three, set readyToOpen to true and tell them you are opening the thread — do not
ask for permission twice.

What you have so far:
${briefSoFar(c)}`,
    input: message,
    fallback: {
      reply: "Say that again?",
      objective: null,
      counterparty: null,
      counterpartyName: null,
      facts: [],
      floor: null,
      headline: null,
      readyToOpen: false,
    },
  });

  return d as IntakeDecision;
}

export async function openingMessage(c: Case): Promise<{ text: string }> {
  if (config.fakeBrain) return fakeOpening(c);

  const disclosure = config.disclose
    ? `

Your FIRST message must say plainly that you are an automated assistant texting
on your principal's behalf. One short clause, not a paragraph, not an apology.
This is not optional — never imply you are a person.`
    : "";

  return decide({
    model: config.model,
    effort: "low",
    name: "opening_message",
    schema: OpeningSchema,
    system: `${HOUSE_RULES}

You are opening a brand new thread with the other party. They have never heard of
you. Open it: say who you are, who you act for, what this is about, and what you
want them to do. Make it easy to reply — end on a specific question.${disclosure}

The brief:
${briefSoFar(c)}`,
    input: "Write the opening message.",
    fallback: {
      text: `Hi — I am an automated assistant texting on behalf of my client about ${
        c.objective ?? "an open matter"
      }. Is this the right number to sort it out?`,
    },
  });
}

export async function negotiate(c: Case, message: string): Promise<NegotiationDecision> {
  if (config.fakeBrain) return fakeNegotiate(c, message);

  const history = c.transcript
    .slice(-24)
    .map((t) => `[${t.side}/${t.who}] ${t.text}`)
    .join("\n");

  const d = await decide({
    // The one decision that protects the principal's money — worth more thinking
    // than the conversational turns around it.
    model: config.negotiationModel,
    effort: "medium",
    name: "negotiation_decision",
    schema: NegotiationSchema,
    system: `${HOUSE_RULES}

The other party just replied. Decide what to send back, and decide whether this
is still yours to handle.

Set status to "needs_you" and leave replyToCounterparty null when — and only
when — the other side offers something below the floor, demands a term the
principal never approved, disputes a fact you were not given, or asks something
only the principal can answer. Put the question for the principal in
reportToPrincipal.

Set status to "agreed" when they commit to something that meets the floor, and
put the committed terms in outcome.
Set status to "stalled" when they refuse outright.
Otherwise keep status "negotiating".

Always write a one-line reportToPrincipal describing what just moved. The
principal is watching a live card, not the transcript.

The brief:
${briefSoFar(c)}

The conversation so far:
${history || "(this is their first reply)"}`,
    input: `They just said: ${message}`,
    fallback: {
      replyToCounterparty: null,
      status: "needs_you" as const,
      headline: "powlo needs a hand",
      reportToPrincipal: "I could not work out how to answer that one — what should I say?",
      outcome: null,
    },
  });

  return d as NegotiationDecision;
}

/** Relay a principal's instruction mid-negotiation back into the other thread. */
export async function relay(c: Case, instruction: string): Promise<RelayDecision> {
  if (config.fakeBrain) return fakeRelay(c, instruction);

  const history = c.transcript
    .slice(-16)
    .map((t) => `[${t.side}/${t.who}] ${t.text}`)
    .join("\n");

  const d = await decide({
    model: config.model,
    effort: "low",
    name: "relay_decision",
    schema: RelaySchema,
    system: `${HOUSE_RULES}

You paused to ask your principal something. They have now answered. Turn their
answer into the next message to the other party — in your voice, not theirs, and
without quoting them.

If their answer authorises a NEW walk-away line — "take 30k", "I'd accept 25" —
record it in newFloor. That becomes the floor from now on; do not keep enforcing
the old one.

The brief:
${briefSoFar(c)}

The conversation so far:
${history}`,
    input: `The principal says: ${instruction}`,
    fallback: {
      text: "Thanks for waiting — checking one thing and coming right back.",
      newFloor: null,
    },
  });

  return d as RelayDecision;
}
