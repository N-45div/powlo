import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import type { Case, CaseStatus } from "./types.js";
import { fakeIntake, fakeNegotiate, fakeOpening, fakeRelay } from "./fake.js";

const client = new Anthropic({ apiKey: config.anthropicKey });

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

async function decide<T extends object>(args: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  toolName: string;
  toolDescription: string;
  schema: Anthropic.Beta.BetaTool["input_schema"];
  effort: "low" | "medium" | "high";
  fallback: T;
}): Promise<T> {
  try {
    // `strict: true` guarantees the arguments validate against the schema, so the
    // negotiation logic never has to defend against a malformed decision object.
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 4000,
      system: args.system,
      output_config: { effort: args.effort },
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.schema,
          strict: true,
        },
      ],
      messages: args.messages,
    });

    for (const block of res.content) {
      if (block.type === "tool_use" && block.name === args.toolName) {
        return block.input as T;
      }
    }

    // The model answered in prose instead of calling the tool. Salvage the text
    // rather than dropping the turn — a silent no-op mid-negotiation is worse
    // than a slightly off-format reply.
    const text = res.content.find((b) => b.type === "text");
    if (text && text.type === "text") {
      return { ...args.fallback, reply: text.text, replyToCounterparty: text.text };
    }
    return args.fallback;
  } catch (err) {
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

export function intake(c: Case, message: string): Promise<IntakeDecision> {
  if (config.fakeBrain) return Promise.resolve(fakeIntake(c, message));
  return decide<IntakeDecision>({
    effort: "low",
    system: `${HOUSE_RULES}

Right now you are talking to your principal — the person who hired you — to take
the brief. Be quick about it. You need three things before you can start:

  - the objective (what outcome they want)
  - the other party's phone number, in +country format
  - the floor (the worst outcome they would still accept)

Ask for at most ONE missing thing per message. Never ask for something they have
already given you. The moment you have all three, set readyToOpen to true and
tell them you are opening the thread — do not ask for permission twice.

What you have so far:
${briefSoFar(c)}`,
    messages: [{ role: "user", content: message }],
    toolName: "respond_to_principal",
    toolDescription: "Reply to the principal and record anything new they told you.",
    schema: {
      type: "object",
      properties: {
        reply: { type: "string", description: "What to text the principal. Short." },
        objective: { type: "string", description: "Set only if newly learned." },
        counterparty: {
          type: "string",
          description: "Phone in +E.164 format. Only if newly learned.",
        },
        counterpartyName: { type: "string", description: "Their name, if given." },
        facts: {
          type: "array",
          items: { type: "string" },
          description: "New facts powlo may cite to the other side.",
        },
        floor: { type: "string", description: "The walk-away line. Only if newly learned." },
        headline: { type: "string", description: "Six-word summary of the case." },
        readyToOpen: {
          type: "boolean",
          description: "True only when objective, counterparty and floor are all known.",
        },
      },
      required: ["reply", "readyToOpen"],
      additionalProperties: false,
    },
    fallback: { reply: "Say that again?", readyToOpen: false },
  });
}

export function openingMessage(c: Case): Promise<{ text: string }> {
  if (config.fakeBrain) return Promise.resolve(fakeOpening(c));
  const disclosure = config.disclose
    ? `

Your FIRST message must say plainly that you are an automated assistant texting
on your principal's behalf. One short clause, not a paragraph, not an apology.
This is not optional — never imply you are a person.`
    : "";

  return decide<{ text: string }>({
    effort: "medium",
    system: `${HOUSE_RULES}

You are opening a brand new thread with the other party. They have never heard of
you. Open it: say who you are, who you act for, what this is about, and what you
want them to do. Make it easy to reply — end on a specific question.${disclosure}

The brief:
${briefSoFar(c)}`,
    messages: [{ role: "user", content: "Write the opening message." }],
    toolName: "send_opening",
    toolDescription: "The first text message to the other party.",
    schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    fallback: {
      text: `Hi — I am an automated assistant texting on behalf of ${c.principal} about ${
        c.objective ?? "an open matter"
      }. Is this the right number to sort it out?`,
    },
  });
}

export function negotiate(c: Case, message: string): Promise<NegotiationDecision> {
  if (config.fakeBrain) return Promise.resolve(fakeNegotiate(c, message));
  const history = c.transcript
    .slice(-24)
    .map((t) => `[${t.side}/${t.who}] ${t.text}`)
    .join("\n");

  return decide<NegotiationDecision>({
    effort: "medium",
    system: `${HOUSE_RULES}

The other party just replied. Decide what to send back, and decide whether this
is still yours to handle.

Set status to "needs_you" and leave replyToCounterparty empty when — and only
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
    messages: [{ role: "user", content: `They just said: ${message}` }],
    toolName: "handle_reply",
    toolDescription: "Decide the response to the other party and the case status.",
    schema: {
      type: "object",
      properties: {
        replyToCounterparty: {
          type: "string",
          description: "What to text them. Omit when escalating to the principal.",
        },
        status: {
          type: "string",
          enum: ["negotiating", "needs_you", "agreed", "stalled"],
        },
        headline: { type: "string", description: "Six-word status for the live card." },
        reportToPrincipal: { type: "string", description: "One line on what just moved." },
        outcome: {
          type: "string",
          description: "The committed terms, when status is agreed.",
        },
      },
      required: ["status", "headline"],
      additionalProperties: false,
    },
    fallback: {
      status: "needs_you" as CaseStatus,
      headline: "powlo needs a hand",
      reportToPrincipal: "I could not work out how to answer that one — what should I say?",
    },
  });
}

/** Relay a principal's instruction mid-negotiation back into the other thread. */
export function relay(c: Case, instruction: string): Promise<RelayDecision> {
  if (config.fakeBrain) return Promise.resolve(fakeRelay(c, instruction));
  const history = c.transcript
    .slice(-16)
    .map((t) => `[${t.side}/${t.who}] ${t.text}`)
    .join("\n");

  return decide<RelayDecision>({
    effort: "low",
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
    messages: [{ role: "user", content: `The principal says: ${instruction}` }],
    toolName: "send_relay",
    toolDescription: "The next message to the other party.",
    schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        newFloor: {
          type: "string",
          description: "Set only when the principal authorised a new walk-away line.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    fallback: { text: "Thanks for waiting — checking one thing and coming right back." },
  });
}
