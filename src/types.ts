export type CaseStatus =
  | "gathering"    // powlo is still collecting the brief from the principal
  | "opening"      // brief is complete, powlo is about to open the other thread
  | "awaiting_contact" // the line cannot cold-open; waiting for them to text in
  | "negotiating"  // the other side is talking
  | "needs_you"    // powlo hit a limit only the principal can authorise
  | "agreed"       // the other side committed to something
  | "stalled"      // the other side went quiet or refused
  | "closed";

/** One line of the unified record. Both threads write into the same transcript. */
export interface Turn {
  at: string;
  side: "principal" | "counterparty";
  who: "them" | "powlo";
  text: string;
}

export interface Case {
  id: string;
  createdAt: string;
  updatedAt: string;

  /** Handles are phone numbers on iMessage, space ids in terminal mode. */
  principal: string;
  counterparty?: string;
  counterpartyName?: string;

  /** What the principal actually wants. */
  objective?: string;
  /** Facts the principal supplied that powlo may cite to the other side. */
  facts: string[];
  /** The walk-away line. powlo never goes below this without asking. */
  floor?: string;

  status: CaseStatus;
  headline: string;
  outcome?: string;

  transcript: Turn[];

  /** Space ids, so powlo can find its way back into either thread on restart. */
  principalSpaceId?: string;
  counterpartySpaceId?: string;
  /** Whether the live card has been sent into the principal thread yet. */
  cardSent: boolean;
}

export const isBriefComplete = (c: Case): boolean =>
  Boolean(c.objective && c.counterparty);
