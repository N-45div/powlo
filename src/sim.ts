/**
 * Drives the real router with fake spaces and a scripted brain.
 *
 * This exists to prove the two-thread choreography — who gets which message,
 * when the card updates, when powlo stops and asks — without spending API calls
 * or needing a Photon line. Run it with: npm run sim
 */
import { store } from "./store.js";
import { handleCounterparty, handlePrincipal, registerSpaces, type AnySpace } from "./index.js";
import type { App } from "./channel.js";

const log: string[] = [];

function fakeSpace(id: string, label: string): AnySpace {
  return {
    id,
    async send(content: unknown) {
      const text =
        typeof content === "string"
          ? content
          : `«${(content as { type?: string })?.type ?? "content"}»`;
      log.push(`  ${label} <- ${text}`);
      return { id: `m-${log.length}` };
    },
    async responding<T>(fn: () => Promise<T>) {
      return fn();
    },
  };
}

const you = fakeSpace("chat-1", "YOU     ");
const them = fakeSpace("them-4455", "LANDLORD");

async function main() {
  const app = {} as App;

  console.log("\n=== powlo simulation: security deposit ===\n");

  const say = async (who: "you" | "them", text: string) => {
    log.push(`\n${who === "you" ? "YOU     " : "LANDLORD"} -> ${text}`);
    if (who === "you") {
      // Bind the fake spaces before the turn runs — powlo opens the other thread
      // from inside handlePrincipal, and there is no real Spectrum app here to
      // create one for it.
      const before = store.activeForPrincipal("+15550000001");
      if (before) {
        registerSpaces(before.id, { principal: you, counterparty: them });
        if (!before.counterpartySpaceId) {
          before.counterpartySpaceId = them.id;
          store.save(before);
        }
      }
      await handlePrincipal(app, you, text, "+15550000001");
    } else {
      const c = store.byCounterpartySpace(them.id);
      if (!c) {
        log.push("  (no case bound to that thread yet)");
        return;
      }
      registerSpaces(c.id, { principal: you, counterparty: them });
      await handleCounterparty(c, them, text);
    }
  };

  await say("you", "my old landlord is sitting on my 45k deposit");
  await say("you", "+15550004455, his name is Raghav. i'd take 35k to end it");
  await say("them", "who is this");
  await say("them", "the flat needed painting. i can do 20k");
  await say("you", "fine, take 30k but not a rupee less");
  await say("them", "ok 30k, i'll transfer friday");

  console.log(log.join("\n"));

  const c = store.activeForPrincipal("+15550000001");
  console.log("\n--- final case ---");
  console.log("status  :", c?.status);
  console.log("headline:", c?.headline);
  console.log("outcome :", c?.outcome ?? "(none)");
  console.log("turns   :", c?.transcript.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
