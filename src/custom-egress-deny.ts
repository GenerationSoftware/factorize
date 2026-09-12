// Outbound Worker for the custom dispatch namespace. It intentionally does not
// inspect, resolve, log, authenticate, or forward attacker-controlled requests.
export default { fetch(): Response { return new Response(null, { status: 403 }); } };
