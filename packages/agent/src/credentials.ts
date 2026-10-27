// Backend-only configuration. No credential store is accessed on import.
export async function readOpenRouterApiKey(): Promise<string> {
  const source = process.env.HARNESS_CREDENTIAL_SOURCE ?? "environment";
  let apiKey: string | null | undefined;

  switch (source) {
    case "environment":
      apiKey = process.env.OPENROUTER_API_KEY;
      break;
    case "keyring": {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      // A separate namespace allows isolated local profiles/qualification without
      // reading or overwriting the normal profile's credential.
      const service =
        process.env.HARNESS_KEYRING_SERVICE ?? "agent-platform-deepagents";
      if (!service.trim())
        throw new Error("HARNESS_KEYRING_SERVICE must not be empty.");
      const entry = new AsyncEntry(service, "openrouter", {
        linux: { store: "secret-service" },
      });
      apiKey = await entry.getPassword();
      break;
    }
    default:
      throw new Error(
        "HARNESS_CREDENTIAL_SOURCE must be environment or keyring.",
      );
  }

  if (!apiKey?.trim()) {
    throw new Error(
      "No OpenRouter API key is available from the selected credential source.",
    );
  }
  return apiKey;
}

/** Called only after the service has authenticated the proposed replacement. */
export async function saveOpenRouterApiKey(apiKey: string): Promise<void> {
  if (process.env.HARNESS_CREDENTIAL_SOURCE !== "keyring")
    throw new Error("Saving credentials requires the keyring source.");
  const { AsyncEntry } = await import("@napi-rs/keyring");
  const service =
    process.env.HARNESS_KEYRING_SERVICE ?? "agent-platform-deepagents";
  if (!service.trim())
    throw new Error("Credential namespace must not be empty.");
  await new AsyncEntry(service, "openrouter", {
    linux: { store: "secret-service" },
  }).setPassword(apiKey);
}
