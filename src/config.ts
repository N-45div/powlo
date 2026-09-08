import "dotenv/config";

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined ? dflt : /^(1|true|yes|on)$/i.test(v);

export const config = {
  /** "terminal" runs the whole two-party loop locally with no Photon account. */
  channel: (process.env.POWLO_CHANNEL ?? "terminal") as "terminal" | "imessage",

  projectId: process.env.SPECTRUM_PROJECT_ID,
  projectSecret: process.env.SPECTRUM_PROJECT_SECRET,

  openaiKey: process.env.OPENAI_API_KEY,

  /** Conversational turns: intake, the opening message, relaying your answer. */
  model: process.env.POWLO_MODEL ?? "gpt-5.6-luna",
  /**
   * The one call that decides whether an offer breaches your floor. Set it to
   * POWLO_MODEL if you'd rather run the whole agent on one model.
   */
  negotiationModel:
    process.env.POWLO_MODEL_NEGOTIATE ?? process.env.POWLO_MODEL ?? "gpt-5.6-terra",

  port: Number(process.env.POWLO_PORT ?? 8787),
  publicUrl: (process.env.POWLO_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),

  /** powlo always tells the other side what it is. Non-negotiable by default. */
  disclose: bool(process.env.POWLO_DISCLOSE, true),

  /** Shown to the principal when the other side has to text in first. */
  lineNumber: process.env.POWLO_LINE ?? "+1 628 264-9335",

  stateFile: process.env.POWLO_STATE ?? ".powlo/cases.json",

  /** Swap the model for scripted decisions, so the router can be tested offline. */
  fakeBrain: bool(process.env.POWLO_FAKE_BRAIN, false),
};

export function assertReady() {
  if (!config.openaiKey && !config.fakeBrain) {
    throw new Error("OPENAI_API_KEY is not set — copy .env.example to .env");
  }
  if (config.channel === "imessage" && !(config.projectId && config.projectSecret)) {
    throw new Error(
      "POWLO_CHANNEL=imessage needs SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET",
    );
  }
}
