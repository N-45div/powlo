/**
 * A scripted stand-in for the model, used by the simulator.
 *
 * It is deliberately dumb — regexes, not reasoning. Its only job is to make the
 * router's control flow observable: does the brief complete, does the thread
 * open, does powlo stop and ask when the offer is under the floor.
 */
import type { Case } from "./types.js";
import type { IntakeDecision, NegotiationDecision, RelayDecision } from "./brain.js";

const phone = /\+\d[\d\s-]{7,}/;
const money = /(\d[\d,]*)\s*k\b/i;

export function fakeIntake(c: Case, message: string): IntakeDecision {
  const d: IntakeDecision = { reply: "", readyToOpen: false };

  if (!c.objective) {
    d.objective = message;
    d.headline = "Recover the security deposit";
    d.facts = [message];
    d.reply = "Got it. What's their number, and what's the least you'd settle for?";
    return d;
  }

  const num = phone.exec(message);
  if (num) d.counterparty = num[0].replace(/[\s-]/g, "");
  const name = /name is (\w+)/i.exec(message);
  if (name) d.counterpartyName = name[1];
  const floor = money.exec(message);
  if (floor) d.floor = `${floor[1]}k`;

  if ((d.counterparty ?? c.counterparty) && (d.floor ?? c.floor)) {
    d.readyToOpen = true;
    d.reply = "Right — opening a thread with them now. I'll keep this card updated.";
  } else {
    d.reply = "And their number?";
  }
  return d;
}

export function fakeOpening(c: Case): { text: string } {
  return {
    text:
      `Hi ${c.counterpartyName ?? "there"} — I'm an automated assistant texting on ` +
      `behalf of my client about the ${c.objective ?? "outstanding matter"}. ` +
      `Can you confirm when it'll be returned?`,
  };
}

export function fakeNegotiate(c: Case, message: string): NegotiationDecision {
  if (/who is this/i.test(message)) {
    return {
      replyToCounterparty:
        "An assistant acting for the former tenant of your flat, on the deposit. " +
        "Happy to sort this out over text.",
      status: "negotiating",
      headline: "Explained who I am",
      reportToPrincipal: "They asked who I was. Told them.",
    };
  }

  const offer = money.exec(message);
  const floor = c.floor ? Number(c.floor.replace(/\D/g, "")) : 0;

  if (offer && Number(offer[1]!.replace(/,/g, "")) < floor) {
    return {
      status: "needs_you",
      headline: "Offer is under your floor",
      reportToPrincipal: `They offered ${offer[1]}k, under your ${c.floor} floor. Hold or take it?`,
    };
  }

  if (offer) {
    return {
      status: "agreed",
      headline: "They committed to pay",
      outcome: `${offer[1]}k, transfer Friday`,
      reportToPrincipal: `Done — ${offer[1]}k, transferring Friday.`,
    };
  }

  return {
    replyToCounterparty: "Understood — when can you confirm?",
    status: "negotiating",
    headline: "Still working on them",
    reportToPrincipal: "They replied, nothing firm yet.",
  };
}

export function fakeRelay(_c: Case, instruction: string): RelayDecision {
  const m = money.exec(instruction);
  if (!m) return { text: "Checking with my client — one moment." };
  return {
    text: `My client can come down to ${m[1]}k to close this today, but not below that.`,
    newFloor: `${m[1]}k`,
  };
}
