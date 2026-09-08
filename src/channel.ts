import { Spectrum, app as appCard, edit, Emoji } from "spectrum-ts";
import { imessage, effect } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "./config.js";

export type App = Awaited<ReturnType<typeof Spectrum>>;
type AnySpace = { send: (...a: never[]) => unknown } & Record<string, unknown>;

export async function boot(): Promise<App> {
  if (config.channel === "imessage") {
    // The terminal provider is a local dev convenience — on a server it spawns
    // a TUI binary that nothing can ever type into.
    const providers = config.withTerminal
      ? [imessage.config(), terminal.config()]
      : [imessage.config()];
    return Spectrum({
      projectId: config.projectId!,
      projectSecret: config.projectSecret!,
      providers,
    });
  }
  // Terminal-only: no credentials, no Photon account, full loop.
  return Spectrum({ providers: [terminal.config()] });
}

/**
 * Open the thread with the other party.
 *
 * On iMessage this creates a real DM to a real phone number — the whole point of
 * powlo. In terminal mode it opens a second named chat in the TUI so the same
 * two-thread choreography can be driven locally with Ctrl+J / Ctrl+K.
 */
export async function openWith(app: App, handle: string): Promise<AnySpace> {
  if (config.channel === "imessage") {
    const im = imessage(app);
    const user = await im.user(handle);
    return (await im.space.create(user)) as unknown as AnySpace;
  }
  const t = terminal(app);
  return (await t.space.get(`them-${handle.replace(/\D/g, "").slice(-4) || "x"}`)) as unknown as AnySpace;
}

/** A win deserves a screen effect. Other platforms just see the text. */
export async function celebrate(space: AnySpace, text: string) {
  if (config.channel === "imessage") {
    await (space as { send: (c: unknown) => Promise<unknown> }).send(
      effect(text, imessage.effect.message.confetti),
    );
    return;
  }
  await (space as { send: (c: unknown) => Promise<unknown> }).send(`🎉 ${text}`);
}

/** Quiet acknowledgement that powlo heard you, without spending a bubble. */
export async function ack(message: { react?: (e: string) => Promise<unknown> }) {
  try {
    await message.react?.(Emoji.like);
  } catch {
    // platform has no reactions — nothing to do
  }
}

/**
 * The live card. First call sends it; later calls edit the SAME bubble in place,
 * so the principal's thread never fills up with status updates.
 */
export async function upsertCard(
  space: AnySpace,
  url: string,
  existing: unknown | undefined,
): Promise<unknown> {
  const send = (space as { send: (c: unknown) => Promise<unknown> }).send.bind(space);
  const card = appCard(url, { live: true });

  if (existing) {
    await send(edit(card, existing as never));
    return existing;
  }
  return send(card);
}
