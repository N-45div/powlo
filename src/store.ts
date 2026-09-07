import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import type { Case, Turn } from "./types.js";

/**
 * Cases live in one JSON file. A texting agent is idle almost all the time and
 * restarts between messages during development, so the transcript has to survive
 * the process — losing it mid-negotiation would make powlo forget what it already
 * conceded to the other side.
 */
class Store {
  private cases = new Map<string, Case>();

  constructor() {
    try {
      const raw = readFileSync(config.stateFile, "utf8");
      for (const c of JSON.parse(raw) as Case[]) this.cases.set(c.id, c);
    } catch {
      // no state yet
    }
  }

  private flush() {
    mkdirSync(dirname(config.stateFile), { recursive: true });
    writeFileSync(config.stateFile, JSON.stringify([...this.cases.values()], null, 2));
  }

  create(principal: string, principalSpaceId: string): Case {
    const now = new Date().toISOString();
    const c: Case = {
      id: randomUUID().slice(0, 8),
      createdAt: now,
      updatedAt: now,
      principal,
      principalSpaceId,
      facts: [],
      status: "gathering",
      headline: "New case",
      transcript: [],
      cardSent: false,
    };
    this.cases.set(c.id, c);
    this.flush();
    return c;
  }

  get(id: string): Case | undefined {
    return this.cases.get(id);
  }

  /** The case a principal is currently working on — the most recent open one. */
  activeForPrincipal(principal: string): Case | undefined {
    return [...this.cases.values()]
      .filter((c) => c.principal === principal && c.status !== "closed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  /** Route an inbound counterparty message back to its case. */
  byCounterpartySpace(spaceId: string): Case | undefined {
    return [...this.cases.values()].find((c) => c.counterpartySpaceId === spaceId);
  }

  byCounterpartyHandle(handle: string): Case | undefined {
    return [...this.cases.values()]
      .filter((c) => c.counterparty === handle && c.status !== "closed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  all(): Case[] {
    return [...this.cases.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  save(c: Case) {
    c.updatedAt = new Date().toISOString();
    this.cases.set(c.id, c);
    this.flush();
  }

  append(c: Case, turn: Omit<Turn, "at">) {
    c.transcript.push({ ...turn, at: new Date().toISOString() });
    this.save(c);
  }
}

export const store = new Store();
