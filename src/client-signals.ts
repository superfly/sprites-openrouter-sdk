const OPENROUTER_AGENT = "openrouter";

/**
 * Cooperatively identify Sprites traffic created through this adapter.
 *
 * The foundational Sprites SDK detects client signals once, so this module is
 * evaluated from the package entry point before application code constructs a
 * Sprites client. An explicit declaration from an outer harness or the user is
 * always authoritative.
 */
export function declareOpenRouterInvocation(): void {
  process.env.FLY_INVOKED_BY ??= OPENROUTER_AGENT;
}

declareOpenRouterInvocation();
