import "dotenv/config";

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined ? dflt : /^(1|true|yes|on)$/i.test(v);

export const config = {
  /** "terminal" runs the whole two-party loop locally with no Photon account. */
  channel: (process.env.POWLO_CHANNEL ?? "terminal") as "terminal" | "imessage",

  projectId: process.env.SPECTRUM_PROJECT_ID,
  projectSecret: process.env.SPECTRUM_PROJECT_SECRET,

  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.POWLO_MODEL ?? "claude-opus-5",

  port: Number(process.env.POWLO_PORT ?? 8787),
  publicUrl: (process.env.POWLO_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),

  /** powlo always tells the other side what it is. Non-negotiable by default. */
  disclose: bool(process.env.POWLO_DISCLOSE, true),

  stateFile: process.env.POWLO_STATE ?? ".powlo/cases.json",
};

export function assertReady() {
  if (!config.anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — copy .env.example to .env");
  }
  if (config.channel === "imessage" && !(config.projectId && config.projectSecret)) {
    throw new Error(
      "POWLO_CHANNEL=imessage needs SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET",
    );
  }
}
