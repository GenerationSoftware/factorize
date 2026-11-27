export function withRequestReference(message: string, response?: Response): string {
  const requestId = response?.headers.get("X-Request-Id");
  return requestId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)
    ? `${message} (Request ID: ${requestId})`
    : message;
}
