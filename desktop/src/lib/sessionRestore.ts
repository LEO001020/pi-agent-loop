/**
 * Startup restore of the last active chat — pure decision helper.
 *
 * Product rule: after onboarding/workbench is ready, if the user left the
 * setting on (default), open the remembered session once when it still exists
 * and is not archived. No I/O here; App performs open + persistence.
 */

export type RestorableSession = {
  id: string;
  archived?: boolean;
};

export type ShouldRestoreLastSessionInput = {
  /** Settings → General toggle (default true). */
  enabled: boolean;
  /** Setup wizard / onboarding finished; workbench is showing. */
  workbenchReady: boolean;
  lastSessionId?: string | null;
  sessions: RestorableSession[];
  /** Already viewing a session (tray / race) — skip restore. */
  currentSessionId?: string | null;
};

/**
 * Returns the session id to open once on launch, or null for no-op.
 */
export function shouldRestoreLastSession(
  input: ShouldRestoreLastSessionInput,
): string | null {
  if (!input.enabled) return null;
  if (!input.workbenchReady) return null;
  const id = (input.lastSessionId ?? "").trim();
  if (!id) return null;
  if (input.currentSessionId) return null;
  const row = input.sessions.find((s) => s.id === id);
  if (!row) return null;
  if (row.archived) return null;
  return id;
}
