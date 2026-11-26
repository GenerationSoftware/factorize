# OAuth client connections and permissions

A connection is one installation of an OAuth client authorized by an owner in
one team. The registered client ID or callback alone does not identify it.
On a client-initiated Reconnect, choose the existing named connection in the
Factorize consent page. Creating a separate connection is the default. Only
compatible client IDs and matching callbacks can be selected. The old
credential is replaced only when the new authorization is successfully
exchanged for a token. Abandoning the flow leaves the old credential alone.

Client permissions are the checked scopes saved for that connection, not what
any individual token necessarily carries. Unchecking takes effect immediately.
Rechecking does not restore access to the outstanding credential. Save the
selection, then start Reconnect from the client and select the same connection.
If the client sends a limited authorization request, your available saved
permissions for that selected existing connection are shown separately. You
can confirm those permissions for the new grant. The token response reports
the actual scopes issued; clients that separately downscope at token exchange
or refuse the resulting credential may still need changes. This never widens
an old token or ordinary refresh. Factorize cannot push credentials into an
offline client. Team defaults seed new consent only.
Provider restrictions still apply independently of the saved connection.

An explicitly reconnected subscription keeps its identifier, expiry, existing
pending deliveries, cooldowns and acknowledgments. If the active authorization
lacks `triggers:read`, it stops sending and does not queue new webhook delivery
attempts; stored Event occurrences remain separately available. Revoking the
connection explicitly removes that connection's subscriptions, not copies of
the same client or the source Events. Credentials created by the independent
device flow get their own connections. Older OAuth grants are adopted one at a
time; no two copies are combined. A legacy grant without recorded callback
information cannot be offered as an exact callback match.
