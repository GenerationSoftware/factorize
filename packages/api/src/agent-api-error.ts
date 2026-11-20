export class AgentApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly scope?: string) { super(message); }
}
