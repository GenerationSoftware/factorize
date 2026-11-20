// Generated from packages/docs/openapi.yaml. Do not edit.
export interface paths {
    "/api/v1/x/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List X connections
         * @description Requires an interactive owner session. Returns named connection metadata, account identity, selected/granted scopes, and status. Client secrets and OAuth tokens are never returned.
         *
         *     Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_x_connections"];
        put?: never;
        /**
         * Add a user-owned X app connection
         * @description Requires an interactive owner session. Stores the X OAuth client secret in Factorize-managed encrypted storage and never returns it. Selected scopes are validated before saving.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_x_connections"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/x/connections/{connectionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete an X connection
         * @description Requires an interactive owner session. Immediately clears the encrypted credential and revokes the connection. A secret-free tombstone prevents old run snapshots from being revived if an identifier is reused.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_x_connections_connectionId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/x/connections/{connectionId}/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start X OAuth authorization
         * @description Requires an interactive owner session. Starts a short-lived PKCE authorization bound to this owner, tenant, session, connection, and selected scopes. The one-time state is set in an HttpOnly cookie.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_x_connections_connectionId_authorize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/x/connections/{connectionId}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test an X connection
         * @description Requires an interactive owner session. Performs a non-mutating GET to X /2/users/me using the saved access token. Returns only a safe status and the already stored account handle; it never returns tokens, credentials, or upstream error bodies. The verification read may incur X API usage charges.
         *
         *     Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_x_connections_connectionId_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/x/connections/{connectionId}/credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace X app credentials
         * @description Requires an interactive owner session. Replaces the encrypted client credentials, invalidates saved access and refresh tokens and pending OAuth attempts, preserves the existing account identity binding, and requires reauthorization. Reauthorization cannot switch the connection to a different X account; create a new connection for another account. Existing run selections remain unavailable until authorization succeeds.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_x_connections_connectionId_credentials"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/model-accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List model accounts available to the owner
         * @description Requires an interactive owner browser session. Returns account metadata and the collection revision only; encrypted account caches and credentials are never returned.
         *
         *     Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_model_accounts"];
        put?: never;
        /**
         * Create a model account
         * @description Requires an interactive owner browser session and the current collection revision. Saves an OpenAI-compatible provider URL, optional API key, and model limits in encrypted storage. Credentials are never returned.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_model_accounts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/model-accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace a model account credential
         * @description Owner session required. Saves an OpenAI-compatible provider URL and optional API key. Replaces the managed credential without changing the selected account ID; active runs use the replacement on their next request.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_model_accounts_accountId"];
        post?: never;
        /**
         * Delete a model account
         * @description Requires an interactive owner browser session and the current collection revision. Deletion is recorded as a tombstone so future run snapshots reject the disconnected account.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_model_accounts_accountId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/bearer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List bearer integration metadata
         * @description Requires an interactive owner browser session. Returns secret-safe metadata only; stored bearer credentials are never returned.
         *
         *     Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_integrations_bearer"];
        put?: never;
        /**
         * Create a bearer integration
         * @description Requires an interactive owner browser session. Accepts the secret over the authenticated connection and encrypts it with Factorize-managed storage before persistence. The secret is never returned.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_integrations_bearer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/bearer/{integrationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a bearer integration
         * @description Requires an interactive owner browser session and the current collection revision. Accepts a replacement secret and encrypts it with Factorize-managed storage before persistence. The secret is never returned.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_integrations_bearer_integrationId"];
        post?: never;
        /**
         * Delete an encrypted bearer integration
         * @description Requires an interactive owner browser session and the current collection revision.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_integrations_bearer_integrationId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Persist an individual validated MCP connection; sets a per-attempt browser cookie
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_connections"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/connections/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume verified onboarding in the initiating browser; never grants OAuth access
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_connections_resume"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your profile; interactive owner browser session required
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        get: operations["get_api_v1_profile"];
        /**
         * Change your globally unique username; interactive owner browser session required
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        put: operations["put_api_v1_profile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get current browser session
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        get: operations["get_api_v1_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/signup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request signup; existing accounts return the same accepted response
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_signup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/email-verification/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request email verification
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_email_verification_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/email-verification/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify email, establish an owner session, and resume explicit consent; callbacks stay in the initiating browser
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_email_verification_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-reset/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Request password reset
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_password_reset_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-reset/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Complete password reset and resume onboarding
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_password_reset_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change password and invalidate sessions
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revoke current session and clear browser cookie
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/oauth/device/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inspect a device authorization code */
        post: operations["post_api_v1_oauth_device_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/oauth/device/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve or deny a device authorization code */
        post: operations["post_api_v1_oauth_device_decision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/oauth/consent/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inspect an OAuth consent request */
        post: operations["post_api_v1_oauth_consent_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/oauth/consent/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Decide an OAuth consent request */
        post: operations["post_api_v1_oauth_consent_decision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/event-contexts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get template autocomplete metadata
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_event_contexts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exe-connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List exe connections
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_exe_connections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/github-installations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List GitHub installations
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_github_installations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trigger-event-availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available event kinds
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_trigger_event_availability"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/schedules/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Preview schedule
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_schedules_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/cloudflare-tail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Tail integrations
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_integrations_cloudflare_tail"];
        put?: never;
        /**
         * Create a Tail integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_integrations_cloudflare_tail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List installed integrations
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_integrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fly/connection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Fly account connection status
         * @description Owner browser session only. Returns organization metadata and never returns the provisioning token.
         *
         *     Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_fly_connection"];
        /**
         * Save a Fly account connection
         * @description Owner browser session only. Supply an org-scoped Fly deploy token with permission to manage Machines in the selected organization, created with `fly tokens create org --org <slug>`. A read-only org token is insufficient for provisioning. The server validates the connection and encrypts the token with its credential key; the token is never returned.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_fly_connection"];
        post?: never;
        /**
         * Remove the Fly account connection
         * @description Owner browser session only. Deletes the tenant's encrypted provisioning token.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_fly_connection"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fly/connection/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Validate a Fly organization token
         * @description Owner browser session only. Supply an org-scoped Fly deploy token with permission to manage Machines in the selected organization, created with `fly tokens create org --org <slug>`. A read-only org token is insufficient for later provisioning. Validation calls Fly's documented read-only current-token endpoint and launches no resources.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_fly_connection_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vm-presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List VM presets
         * @description Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_vm_presets"];
        put?: never;
        /**
         * Create a VM preset
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_vm_presets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vm-presets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a VM preset
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_vm_presets_id"];
        post?: never;
        /**
         * Delete a VM preset
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_vm_presets_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fly/execution-configurations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Fly execution configurations
         * @description Returns tenant-owned image, region, and VM size selections without connection credentials.
         *
         *     Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_fly_execution_configurations"];
        put?: never;
        /**
         * Create a Fly execution configuration
         * @description Requires a saved Fly connection and validates region and VM size against bounded provider metadata.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_fly_execution_configurations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/fly/execution-configurations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a Fly execution configuration
         * @description Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_fly_execution_configurations_id"];
        /**
         * Update a Fly execution configuration
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_fly_execution_configurations_id"];
        post?: never;
        /**
         * Delete a Fly execution configuration
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_fly_execution_configurations_id"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/exe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Create an exe.dev integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_integrations_exe"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/exe/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test exe.dev credentials
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_integrations_exe_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/amp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Create an Amp integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_integrations_amp"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/amp/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test Amp credentials
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_integrations_amp_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/linear/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Linear projects
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_linear_projects"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/linear/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Linear event options
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_linear_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/clickup/lists": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List ClickUp lists
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_clickup_lists"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/clickup/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List ClickUp event options
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_clickup_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/github/installations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List GitHub installations for provider setup
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_github_installations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/access/authorized-clients": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List authorized OAuth clients
         * @description Requires the triggers:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_access_authorized_clients"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/access-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List access tokens
         * @description Requires the triggers:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_access_tokens"];
        put?: never;
        /**
         * Create an access token
         * @description Requires the triggers:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_access_tokens"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/access-tokens/{tokenId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke an access token
         * @description Requires the triggers:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_access_tokens_tokenId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/access/authorizations/{grantId}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Edit an OAuth connection’s scopes and integration access
         * @description Requires the triggers:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_access_authorizations_grantId_permissions"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/access/authorizations/{grantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one isolated OAuth connection
         * @description Other connections, including copies of the same client, retain their approvals.
         *
         *     Requires the triggers:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_access_authorizations_grantId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/access/authorized-clients/{clientId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke an authorized OAuth client
         * @description Requires the triggers:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_access_authorized_clients_clientId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/exe/{connectionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove an exe.dev integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_integrations_exe_connectionId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/amp/{connectionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove an Amp integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_integrations_amp_connectionId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/cloudflare-tail/{integrationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a Tail integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_integrations_cloudflare_tail_integrationId"];
        post?: never;
        /**
         * Remove a Tail integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_integrations_cloudflare_tail_integrationId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/cloudflare-tail/{integrationId}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test a Tail integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_integrations_cloudflare_tail_integrationId_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/github/installations/{installationId}/repositories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List installation repositories
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_github_installations_installationId_repositories"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/github/installations/{installationId}/repositories/{repositoryId}/issue-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List GitHub issue event options
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_providers_github_installations_installationId_repositories_repositoryId_issue_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/github/installations/{installationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Disconnect a GitHub installation
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_providers_github_installations_installationId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/exe/{connectionId}/diagnostics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Probe exe.dev permissions and a disposable VM's agent/model integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_integrations_exe_connectionId_diagnostics"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trigger-summaries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List bounded trigger summaries
         * @description Additive bounded list representation. Omitted sort preserves immutable UUID descending; updated preserves updated time descending with UUID descending ties. active sorts triggers with live runs first, then name and UUID ascending; running sorts numeric live-run counts in direction with name and UUID ascending ties; title sorts name in direction with UUID ascending ties. Name ordering uses the PostgreSQL en-US ICU collation. Non-ID sorts return opaque cursors bound to their sort and direction; keep filters and sort unchanged between pages. Live run-count changes can move triggers between pages. Literal case-insensitive name/slug search. No prompts or event configuration; statistics are batched. Existing GET /triggers remains an array.
         *
         *     Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_trigger_summaries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trigger-selector": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search bounded lifecycle trigger options
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_trigger_selector"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/graph": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the team's workflow graph
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_triggers_graph"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/team": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the current team and its run defaults
         * @description Requires the team:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_team"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/team/run-defaults": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace the current team's run defaults
         * @description Requires the team:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_team_run_defaults"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skill-library": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read skill repository settings
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skill_library"];
        /**
         * Select the authoritative skills repository
         * @description Requires the skills:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_skill_library"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skill-library/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue a one-hour repository credential (read-only for GitHub mirrors)
         * @description Requires the skills:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_skill_library_token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skill-library/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Synchronize the tracked branch
         * @description Requires the skills:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_skill_library_sync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{skillId}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse the published skill directory at its immutable revision
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skills_skillId_files"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{skillId}/trigger": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a skill's optional trigger
         * @description Requires the skills:read and triggers:read scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skills_skillId_trigger"];
        /**
         * Configure a skill's event sources and enabled state
         * @description Requires the skills:write and triggers:write scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_skills_skillId_trigger"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{skillId}/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read skill execution defaults
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skills_skillId_settings"];
        /**
         * Save skill execution defaults for future manual and triggered runs
         * @description Requires the skills:write and triggers:write scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_skills_skillId_settings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search global skills
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skills"];
        put?: never;
        /**
         * Create a global skill
         * @description Requires the skills:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_skills"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Preview one skill, a literal prompt and optional Event template
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_triggers_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{skillId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a global skill
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skills_skillId"];
        /**
         * Update a global skill
         * @description Requires the skills:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_skills_skillId"];
        post?: never;
        /**
         * Delete an unused global skill
         * @description Requires the skills:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_skills_skillId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills/{skillId}/triggers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List triggers using a skill
         * @description Requires the skills:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_skills_skillId_triggers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vm-image-verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify a public VM image
         * @description Starts a tenant-scoped background verification. It creates a temporary Factorize-owned VM, checks SSH and the selected harness prerequisites, then deletes the VM. It never executes a trigger prompt.
         *
         *     Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_vm_image_verifications"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vm-image-verifications/{verificationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get VM image verification progress
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_vm_image_verifications_verificationId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List triggers
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_triggers"];
        put?: never;
        /**
         * Create trigger
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_triggers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trigger-conditions/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test webhook conditions
         * @description Evaluates supplied prepared webhook context only; does not authenticate the example, route events, verify GitHub state, or invoke triggers.
         *
         *     Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_trigger_conditions_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}/invocations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Invoke trigger
         * @description Requires the runs:invoke scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_triggers_triggerId_invocations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runtime-launch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fetch this VM's immutable launch payload
         * @description Requires the vendor-verified identity of an active run. Returns only that run's encrypted-at-rest scheduler snapshot, including the rendered prompt and harness or code context. No application scope is required. Sessions, API keys, OAuth clients, other runs and terminal runs cannot retrieve it. Responses are never cached.
         *
         *     Requires vendor-verified run identity; sessions and other bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_runtime_launch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/vm-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Delegate selected proxy integrations to an exe.dev VM
         * @description Requires an OAuth agent with proxy:use, vm:grant and access to the provider and each selected integration. Expires with the issuing access token.
         *
         *     Requires the vm:grant and proxy:use scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_vm_grants"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/vm-grants/{grantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke an external VM grant
         * @description Only the issuing OAuth grant can revoke. Access stops before provider cleanup.
         *
         *     Requires the vm:grant scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_agent_vm_grants_grantId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reserve an immutable image upload for Pi
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_media_uploads"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/{artifactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read authorized run input or scratch media
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_media_artifactId"];
        /**
         * Stream unchanged image bytes to a reserved upload
         * @description Content-Type must match the reserved mediaType. Maximum upload size is 32 MiB; Pi turns accept at most 16 MiB of decoded media. Uploads are immutable and checksum verified.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_media_artifactId"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/media/fetch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Capture an image from an authorized integration API
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_media_fetch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runtime/vm/exec": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Execute a command in this active run's verified workspace VM
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_runtime_vm_exec"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/reflection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Discover agent identity and granted or requestable integration APIs
         * @description OAuth authorization or verified active run required. Availability reports connection state, without probing credential health. OAuth integration scopes are integration:{stable UUID}:{revocation epoch}; initial login need not request any integration scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_agent_reflection"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make an authorized credential-injected API request
         * @description OAuth requires proxy:use. An external VM sends its short-lived exe.dev WIF bearer token, X-Factorize-VM-Grant and X-Factorize-VM-Proof. Only server-selected origins are used. Integration-wide grants are bounded by upstream credential permissions. Missing requestable access returns HTTP 403 with WWW-Authenticate insufficient_scope, scope and resource_metadata. Upstream status is returned in the result, including non-2xx. Text is UTF-8; other bodies are base64. Responses above 32 KiB are retained for 30 minutes and read in chunks. Revocation prevents subsequent calls and reads, but cannot undo upstream side effects.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_requests"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/telemetry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read paginated run spans and live usage/cost totals
         * @description Local telemetry remains available without Phoenix. Model input counts include cached tokens; reasoning is a subset of output. Unreported usage and unknown pricing remain unavailable. Wall time comes from the root span and does not sum overlapping child durations.
         *
         *     Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_telemetry"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/telemetry/{spanId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a bounded chunk of span input/output and its pricing snapshot
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_telemetry_spanId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/phoenix": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect credential-safe team Phoenix settings
         * @description Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_integrations_phoenix"];
        /**
         * Configure automatic new-run telemetry export to Phoenix Cloud
         * @description Requires an owner session and expectedRevision. API key is encrypted and never returned. Omit it to retain the existing key. Disabling cancels pending exports. Destination changes apply only to newly created runs; no historical backfill.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_integrations_phoenix"];
        post?: never;
        /**
         * Disconnect Phoenix and cancel pending exports
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_integrations_phoenix"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integrations/phoenix/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test Phoenix authentication and destination project lookup
         * @description Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_integrations_phoenix_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/model-pricing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read versioned catalog provenance and team model price overrides
         * @description Requires the integrations:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_model_pricing"];
        /**
         * Set per-integration/model USD prices per million tokens
         * @description Requires an interactive owner session and expectedRevision. Set rates null to revert to the catalog. Historical estimates retain their original pricing snapshot.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_model_pricing"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/proxy-payloads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reserve a temporary connection/run-bound request body
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_proxy_payloads"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/proxy-payloads/{handle}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect an authorized temporary upload
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_proxy_payloads_handle"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/proxy-payloads/{handle}/bytes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Stream a generic file into an authorized payload
         * @description An authenticated owner browser can upload for its originating OAuth connection. Immutable finalized bytes; fixed 32 MiB limit. No run is required.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_proxy_payloads_handle_bytes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/proxy-payloads/append": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Append a bounded idempotent payload chunk
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_proxy_payloads_append"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/proxy-payloads/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Finalize and checksum a staged body
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_proxy_payloads_finalize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/proxy-payloads/attachment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import a native ChatGPT attachment
         * @description Accepts documented OpenAI file parameters. Temporary signed URLs are never returned; imports require trusted public HTTPS file origins and disallow redirects.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_proxy_payloads_attachment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start an identity-bound durable HTTP operation
         * @description Fixed 32 MiB request, 64 MiB response and 15 minute upstream limits. An idempotencyKey safely reuses an accepted operation; interrupted dispatch is never automatically replayed. Poll/read/cancel using the operation ID.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_operations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/operations/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Poll an authorized HTTP operation
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_operations_status"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/operations/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel an authorized HTTP operation
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_operations_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/operations/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read bounded incremental operation bytes
         * @description Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_operations_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/responses/query": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Query bounded retained JSON, text lines or binary byte ranges
         * @description Rechecks proxy authorization and identity/tenant/integration expiry. JSON/text parsing is limited to 1 MiB; larger bodies remain available through byte ranges. JMESPath functions, root references and constructors are excluded to bound intermediate allocations.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_responses_query"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/responses/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read up to 64 KiB of an identity-bound retained response
         * @description Accepts the same OAuth, run or external VM authentication as the request endpoint. Rechecks authorization, integration revocation epoch, tenant, identity and 30-minute expiry. Chunks are always base64 so arbitrary byte offsets are safe.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_agent_responses_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integration-api-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tenant MCP API access policies
         * @description Requires the integrations:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_integration_api_policies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/integration-api-policies/{integrationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set baseline, requestable or disabled MCP access
         * @description Baseline changes apply immediately. Disabling invalidates approvals permanently; re-enabling requires fresh consent. Run selections remain independent.
         *
         *     Requires the integrations:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_integration_api_policies_integrationId"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runtime-context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Inspect the current runtime identity and scopes
         * @description Returns the verified calling identity and effective scopes without credentials. Requires a verified active identity but no application-resource scope; callers with zero scopes can inspect only their own identity. Execution provisioning uses this operation to verify the dedicated run proxy. Execution VMs must not have additional shared Factorize proxy attachments.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runtime_context"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runtime-integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Discover this run's selected integration endpoints
         * @description Requires vendor-verified run identity. Returns only snapshotted selections, safe connection metadata, X OAuth scopes, and current availability, without origins or credentials. X connections use /x/{connectionId}/ for supported API v2 resources; each resource is checked against selected and granted OAuth scopes. Selection authorization is independent of the run's Factorize API scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runtime_integrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}/invocation-permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a source trigger's manual invocation destinations
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_triggers_triggerId_invocation_permissions"];
        /**
         * Replace a source trigger's manual invocation destinations
         * @description Requires an owner session, scoped API key, or authorized OAuth client with triggers:write. Destinations must belong to the source trigger's project; self-invocation is allowed. A run token may invoke a configured destination only while both triggers remain in the same project. Lifecycle subscriptions do not create permissions.
         *
         *     Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_triggers_triggerId_invocation_permissions"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhook activity
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_triggers_triggerId_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enable trigger
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_triggers_triggerId_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable trigger
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_triggers_triggerId_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get trigger
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_triggers_triggerId"];
        /**
         * Replace trigger
         * @description Supply expectedUpdatedAt from GET for atomic optimistic concurrency. Stale edits return 409 stale_trigger. Omission uses last-writer-wins updates. Event identity is preserved.
         *
         *     Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        put: operations["put_api_v1_triggers_triggerId"];
        post?: never;
        /**
         * Delete trigger
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        delete: operations["delete_api_v1_triggers_triggerId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List runs
         * @description Returns tenant-authorized runs. Trigger and state filters accept repeated values and match any selected value within each filter; filters are applied before cursor pagination. When sort is supplied, ordering is applied before cursor pagination; statuses sort lexically by their persisted state, missing values sort last, and ties use run ID. Without sort, queued, reserved, and starting runs come first, running runs second, and all other states last; each group is ordered by creation time descending, then run ID descending. The opaque default cursor includes the priority group and creation time. Legacy two-field cursors resume at their original chronological boundary. Run states can change between requests and move rows across groups; restart pagination from the first page after observing a state transition if a gap-free live view is needed.
         *
         *     Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs"];
        put?: never;
        /**
         * Start a Team run from an optional skill and prompt, or a script
         * @description Supply a skill, a prompt, or both for an agent run, or a script without an agent skill or prompt. Omitted settings use Team defaults. Default scopes, integrations and invocation destinations are bounded by the caller's effective access. Explicit unauthorized permissions fail. Explicit empty selections grant none.
         *
         *     Requires the runs:start scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_runs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search triggers and runs by approximate metadata matches
         * @description Search uses PostgreSQL pg_trgm approximate matching over trigger names/slugs and run names, issue titles, and issue identifiers. Identifier matching is whole-field trigram matching; names and titles use word-level trigram matching. Exact identifiers and metadata names rank first, followed by the strongest individual field score. Results are unique, tenant-scoped, deterministically ordered, and limited to 100. Blank or punctuation-only queries return no results. One- and two-character queries may return no results because trigram matching is approximate; this is not ordered-character or substring matching.
         *
         *     Requires the triggers:read and runs:read scopes.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search webhook deliveries
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_webhooks_deliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/deliveries/{deliveryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get webhook delivery detail and processing timeline
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_webhooks_deliveries_deliveryId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get lightweight run status
         * @description Only bounded encrypted prompt/script previews are decrypted; full prompt, invocation context, artifacts, activity and diagnostics stay in the detail operation. Continue polling terminal runs while finalizing is true. trace_revision changes on generation transition or canonical projection/replay; live appends retain the revision. Full detail remains available at GET /runs/{runId}.
         *
         *     Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/artifacts/{artifactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a retained run artifact
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_artifacts_artifactId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/trace-pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get revision-bound trace page
         * @description First request omits revision and uses after=0. Subsequent requests supply the returned revision. A changed generation or canonical projection returns reset=true and events from zero in the new revision, from one database snapshot. Discard all cached old pages before merging the response. nextCursor=null means caught up, not finalized; poll after the last sequence while active/finalizing. The full trace endpoint provides its complete representation.
         *
         *     Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_trace_pages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get run
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Rename run
         * @description Changes only the run display name. Supply expectedName for optimistic concurrency; omission supports last-writer-wins clients.
         *
         *     Requires the runs:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        patch: operations["patch_api_v1_runs_runId"];
        trace?: never;
    };
    "/api/v1/runs/{runId}/report-error": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report an error for an active run
         * @description Records a sanitized reason and authenticated reporter without changing run execution or releasing its concurrency slot. The agent may continue work and should then exit normally. An identical retry succeeds; a different replacement reason returns 409. Terminal runs reject reports.
         *
         *     Requires the runs:write scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_runs_runId_report_error"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/trace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get paginated run trace events
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_trace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/trace/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replay a retained trace artifact or restore a native-session projection
         * @description Requires runs:cancel and an interactive tenant owner session. One terminal run per request, limited to 10 attempts per tenant per minute including retries and failures. Projection and result commit atomically; no artifacts are deleted. Retry failed requests with the same requestId. Conflicting reuse is rejected. Missing bytes cannot be recovered. Does not change the source declaration of an active or future run.
         *
         *     Requires the runs:cancel scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_runs_runId_trace_replay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/diagnostics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get credential-safe run lifecycle diagnostics
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId_diagnostics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Stop run
         * @description Requires the runs:cancel scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_runs_runId_stop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/retry-launch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Manually retry a blocked launch
         * @description Retries a blocked launch with its original immutable credential and API scope snapshot. Trigger edits affect future runs; revoked/deleted selections require trigger repair and a new run. An interactive owner must request this retry.
         *
         *     Requires the runs:cancel scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_runs_runId_retry_launch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{runId}/kill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Kill run and immediately release its concurrency slot
         * @description Requires the runs:cancel scope.
         *
         *     Accepts a scoped bearer token, vendor-verified run identity, or interactive owner session.
         */
        post: operations["post_api_v1_runs_runId_kill"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            error: {
                code: string;
                message: string;
            };
        };
        Run: {
            source: string;
            prompt_preview: string;
            id: string;
            trigger_id: string | null;
            launch_skill_id?: string | null;
            launch_skill_key?: string | null;
            launch_skill_revision?: number | null;
            trigger_name: string | null;
            issue_id: string;
            issue_url: string | null;
            issue_title: string;
            run_name: string;
            agent_name: string;
            workspace_name: string;
            agent_kind: string;
            /** @enum {string} */
            execution_type: "agent" | "code";
            /** @enum {string} */
            state: "queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored";
            provider: string;
            backend_kind: string;
            capabilities: string[];
            destination_url: string | null;
            /** @enum {string} */
            artifact_state: "pending" | "collecting" | "stored" | "partial" | "failed";
            artifact_error: string | null;
            created_at: string;
            updated_at: string;
            started_at: string | null;
            failure_source: ("system" | "agent") | null;
            failure?: {
                /** @enum {string} */
                source: "run" | "system";
                code: string;
                reason: string;
            } | null;
            agent_error: {
                reason: string;
                reported_at: string;
                reporter: {
                    user_id: string;
                    /** @enum {string} */
                    kind: "api_key" | "oauth" | "session" | "run_token";
                    id: string;
                };
            } | null;
            elapsed_time?: ({
                duration: number;
            } | {
                low: number;
                high: number;
            }) | null;
        } & {
            [key: string]: unknown;
        };
        RunPage: {
            items: {
                source: string;
                prompt_preview: string;
                id: string;
                trigger_id: string | null;
                launch_skill_id?: string | null;
                launch_skill_key?: string | null;
                launch_skill_revision?: number | null;
                trigger_name: string | null;
                issue_id: string;
                issue_url: string | null;
                issue_title: string;
                run_name: string;
                agent_name: string;
                workspace_name: string;
                agent_kind: string;
                /** @enum {string} */
                execution_type: "agent" | "code";
                /** @enum {string} */
                state: "queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored";
                provider: string;
                backend_kind: string;
                capabilities: string[];
                destination_url: string | null;
                /** @enum {string} */
                artifact_state: "pending" | "collecting" | "stored" | "partial" | "failed";
                artifact_error: string | null;
                created_at: string;
                updated_at: string;
                started_at: string | null;
                failure_source: ("system" | "agent") | null;
                failure?: {
                    /** @enum {string} */
                    source: "run" | "system";
                    code: string;
                    reason: string;
                } | null;
                agent_error: {
                    reason: string;
                    reported_at: string;
                    reporter: {
                        user_id: string;
                        /** @enum {string} */
                        kind: "api_key" | "oauth" | "session" | "run_token";
                        id: string;
                    };
                } | null;
                elapsed_time?: ({
                    duration: number;
                } | {
                    low: number;
                    high: number;
                }) | null;
            }[];
            nextCursor: string | null;
        };
        /** @description First terminal backend observation, retained independently of collection and cleanup errors. Null for older or nonterminal runs. Commands and raw backend responses are never included. */
        ExecutionDiagnostics: {
            /** @enum {string} */
            state: "succeeded" | "failed" | "stopped";
            /** @description Bounded credential-redacted backend observation detail */
            detail: string | null;
            systemd: {
                loadState: string;
                activeState: string;
                subState: string;
                result: string;
                /** @description systemd ExecMainCode (for example 1 for exit and 2 for signal) */
                execMainCode: number | null;
                /** @description systemd exit status or signal number; null if unavailable */
                execMainStatus: number | null;
            } | null;
        } | null;
        /** @description Stored redacted harness stderr artifact, or null if unavailable. Uses the combined log for older VMs. Retains at most the first 64 KiB, drops a truncated final line, and redacts recognizable credentials before storage. The object key is a storage locator, not a public or signed URL. This artifact remains available after VM deletion. */
        HarnessLog: {
            id: string;
            /** @constant */
            kind: "terminal_log";
            object_key: string;
            provider: string;
            /** @constant */
            format: "text";
            format_version?: string | null;
            cli_version?: string | null;
            /** @description Live source generation bound to the terminal snapshot; unknown for historical receipts. */
            source_generation?: string | null;
            native_session_id?: string | null;
            /** @description Byte count (PostgreSQL bigint may serialize as a decimal string) */
            byte_size: number | string;
            sha256: string;
            /** @enum {string} */
            state: "stored";
            /** Format: date-time */
            created_at: string;
        } | null;
        TraceSource: {
            /** @enum {string} */
            kind: "execution_stream" | "native_session";
            /** @description Guest source path; historical native sources may use a discovery root */
            path: string;
            /** @constant */
            mediaType: "application/x-ndjson";
            /** @enum {string} */
            provider: "codex" | "claude" | "pi";
            formatVersion?: string;
            cliVersion?: string;
            harnessVersion?: string;
            /** @description Native session discovery only */
            discoverCommand?: string;
        };
        TraceSources: {
            primary?: components["schemas"]["TraceSource"];
            nativeSession?: components["schemas"]["TraceSource"];
        } | null;
        /** @description Committed projection receipt. Null means no durable reconciliation evidence; it does not mean complete. */
        TraceProjection: {
            /** @enum {string} */
            source_kind?: "execution_stream" | "native_session";
            artifact_sha256?: string;
            parser_version?: string;
            /** Format: date-time */
            updated_at?: string;
            reconciliation?: {
                /** @enum {string} */
                state?: "matched" | "mismatch" | "no_live_cursor" | "reprojected";
                events?: number;
                liveEvents?: number;
                mismatches?: number;
                liveOffset?: number | null;
                artifactBytes?: number;
                generation?: string | null;
                /**
                 * @description Completion evidence from the exact retained canonical Codex bytes.
                 * @enum {string}
                 */
                codexCompletion?: "turn.completed" | "missing_turn_completed";
            };
        } | null;
        TraceDiagnostics: {
            /** @description Agent trace provider; the outer diagnostics provider remains the event provider. */
            provider: string | null;
            /** @enum {string} */
            primarySource: "execution_stream" | "native_session";
            sourceVersion: string | null;
            projection: components["schemas"]["TraceProjection"];
            liveCursor: {
                generation?: string;
                committed_offset?: number | string;
                pending_bytes?: number;
                /** Format: date-time */
                updated_at?: string;
            } | null;
            counts: {
                events?: number;
                parse_warnings?: number;
                unknown_events?: number;
                unknownEventRate?: number;
            };
            /** @description Tenant/run-scoped receipts; storage keys are locators, never public download URLs. Includes kind, provider, source_path, source_generation, format and source/CLI/harness versions, byte size, checksum and storage state. */
            artifacts: Record<string, never>[];
            /**
             * @description Canonical Codex runs do not capture native sessions. Historical native receipts remain readable.
             * @enum {string}
             */
            nativeArtifactState: "stored" | "missing" | "not_applicable";
            /** @description Native projection selected for a run originally declared with an execution stream primary. */
            fallbackUsed: boolean;
            /** @description Latest completed replay request ID */
            lastReplay: Record<string, never> | null;
        };
        TraceReplayResult: {
            /** Format: uuid */
            requestId: string;
            /** Format: uuid */
            runId: string;
            /** @enum {string} */
            status: "projected" | "already_projected" | "skipped" | "unrecoverable";
            /** @enum {string} */
            reason?: "run_active" | "ambiguous_artifacts" | "missing_artifact" | "unsupported_artifact" | "artifact_not_retained";
            /** @enum {string} */
            sourceKind?: "execution_stream" | "native_session";
            sha256?: string;
            parserVersion?: string;
            reconciliation?: Record<string, never>;
        };
        RunDetail: {
            source: string;
            prompt_preview: string;
            id: string;
            trigger_id: string | null;
            launch_skill_id?: string | null;
            launch_skill_key?: string | null;
            launch_skill_revision?: number | null;
            trigger_name: string | null;
            issue_id: string;
            issue_url: string | null;
            issue_title: string;
            run_name: string;
            agent_name: string;
            workspace_name: string;
            agent_kind: string;
            /**
             * @default agent
             * @enum {string}
             */
            execution_type: "agent" | "code";
            /** @enum {string} */
            state: "queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored";
            provider: string;
            backend_kind: string;
            capabilities: string[];
            destination_url: string | null;
            /** @enum {string} */
            artifact_state: "pending" | "collecting" | "stored" | "partial" | "failed";
            artifact_error: string | null;
            created_at: string;
            updated_at: string;
            started_at: string | null;
            failure_source: ("system" | "agent") | null;
            failure?: {
                /** @enum {string} */
                source: "run" | "system";
                code: string;
                reason: string;
            } | null;
            agent_error: {
                reason: string;
                reported_at: string;
                reporter: {
                    user_id: string;
                    /** @enum {string} */
                    kind: "api_key" | "oauth" | "session" | "run_token";
                    id: string;
                };
            } | null;
            elapsed_time?: ({
                duration: number;
            } | {
                low: number;
                high: number;
            }) | null;
            context_prompt: string;
            trigger_result: {
                /** @enum {string} */
                status: "succeeded" | "failed";
                summary?: string;
                reason?: string;
                outputs?: {
                    [key: string]: unknown;
                };
            } | null;
            run_artifacts: {
                id: string;
                kind: string;
                provider: string;
                format: string;
                byte_size: number;
                sha256: string;
                state: string;
                media_type: string | null;
                created_at: string;
            }[];
            tenant_id: string;
            invocation_id: string;
            execution_handle: {
                backendKind: string;
                id: string;
            } | null;
            execution_backend_kind: string;
            execution_capabilities: string[];
            claim_released: boolean;
            vm_cleanup_attempt: number;
            cleanup_next_at: string | null;
            vm_cleanup_complete: boolean;
            /** @default null */
            execution_script: string | null;
            execution_configuration: {
                [key: string]: unknown;
            };
            prompt: string;
            context: {
                [key: string]: unknown;
            };
            occurrence: {
                [key: string]: unknown;
            } | null;
            invocation: {
                id: string;
                source: string;
                claim_key: string;
                template_trigger_id?: string | null;
                event_id: string | null;
                context: {
                    [key: string]: unknown;
                };
                occurrence: {
                    [key: string]: unknown;
                } | null;
                source_trigger_id: string | null;
                source_run_id: string | null;
                created_at: string;
            };
            invocation_source: string;
            invocation_claim_key: string;
            invocation_event_id: string | null;
            invocation_created_at: string;
            activity: {
                action: string;
                detail: string;
                created_at: string;
            }[];
            execution_diagnostics: {
                [key: string]: unknown;
            } | null;
            trace_sources: {
                primary: {
                    /** @enum {string} */
                    kind: "execution_stream" | "native_session";
                    path: string;
                    /** @constant */
                    mediaType: "application/x-ndjson";
                    /** @enum {string} */
                    provider: "codex" | "claude" | "pi";
                    formatVersion?: string;
                    cliVersion?: string;
                    harnessVersion?: string;
                    discoverCommand?: string;
                };
                nativeSession?: {
                    /** @enum {string} */
                    kind: "execution_stream" | "native_session";
                    path: string;
                    /** @constant */
                    mediaType: "application/x-ndjson";
                    /** @enum {string} */
                    provider: "codex" | "claude" | "pi";
                    formatVersion?: string;
                    cliVersion?: string;
                    harnessVersion?: string;
                    discoverCommand?: string;
                };
            } | null;
            trace_projection: {
                [key: string]: unknown;
            } | null;
            trace_generation: string | null;
            harness_log: {
                [key: string]: unknown;
            } | null;
        };
        RunDiagnostics: {
            runId: string;
            triggerId: string | null;
            state: string;
            provider?: string;
            backendKind?: string;
            trace?: components["schemas"]["TraceDiagnostics"];
            traceSources?: components["schemas"]["TraceSources"];
            execution: components["schemas"]["ExecutionDiagnostics"];
            harnessLog: components["schemas"]["HarnessLog"];
            artifact: {
                state?: string;
                /** @description Secondary collection or cleanup error. Collection is retried up to three times before cleanup proceeds with partial artifacts. Cleanup failures remain retryable. */
                error?: string | null;
            };
            activity: Record<string, never>[];
            /** Format: date-time */
            createdAt?: string;
            /** Format: date-time */
            updatedAt?: string;
        };
        TriggerInput: {
            name: string;
            /** @enum {string} */
            executionType?: "agent" | "code";
            requiresVm?: boolean;
            /** @default  */
            prompt: string;
            script?: string;
            runNameTemplate?: string;
            concurrencyLimit?: number;
            /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
            runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
            executionConfigId?: string;
            tags?: string[];
            vmImage?: string;
            model?: string;
            /** @enum {string} */
            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
            /** @default [] */
            events: ({
                id?: string;
                slug?: string;
                /** @constant */
                kind: "manual";
                template?: string;
                /** @default true */
                enabled: boolean;
                /** @default {} */
                config: Record<string, never>;
            } | {
                id?: string;
                slug?: string;
                /** @constant */
                kind: "schedule";
                template?: string;
                /** @default true */
                enabled: boolean;
                config: {
                    cron: string;
                    timezone: string;
                };
            } | {
                id?: string;
                slug?: string;
                /** @constant */
                kind: "webhook";
                template?: string;
                /** @default true */
                enabled: boolean;
                config: {
                    conditions?: {
                        [key: string]: unknown;
                    };
                    /** @constant */
                    provider: "linear";
                    projectId: string;
                    matchRules: {
                        /** @enum {string} */
                        type: "owner" | "creator" | "status" | "label" | "assignee";
                        targetId: string;
                    }[];
                } | {
                    conditions?: {
                        [key: string]: unknown;
                    };
                    /** @constant */
                    provider: "clickup";
                    listId: string;
                    matchRules: {
                        /** @enum {string} */
                        type: "owner" | "creator" | "status" | "label" | "assignee";
                        targetId: string;
                    }[];
                } | {
                    conditions?: {
                        [key: string]: unknown;
                    };
                    /** @constant */
                    provider: "github";
                    installationId: number;
                    repositoryId: number;
                    event?: string;
                    action?: string;
                    matchRules?: {
                        /** @enum {string} */
                        type: "owner" | "creator" | "status" | "label" | "assignee";
                        targetId: string;
                    }[];
                } | {
                    conditions?: {
                        [key: string]: unknown;
                    };
                    /** @constant */
                    provider: "cloudflareTail";
                    integrationId: string;
                };
            } | {
                id?: string;
                slug?: string;
                /** @constant */
                kind: "triggerLifecycle";
                template?: string;
                /** @default true */
                enabled: boolean;
                config: {
                    sourceTriggerIds: string[];
                    states: ("succeeded" | "failed" | "stopped" | "edited")[];
                };
            } | {
                id?: string;
                slug?: string;
                /** @constant */
                kind: "triggerIdle";
                template?: string;
                /** @default true */
                enabled: boolean;
                config: {
                    sourceTriggerIds: string[];
                };
            })[];
            skillId?: string | null;
            portableIntegrationIds?: string[];
            /** Format: uuid */
            modelAccountId?: string;
            githubInstallationIds?: number[];
            linearConnectionId?: "linear" | null;
            xConnectionIds?: string[];
        };
        ManualInvocation: {
            /** @default  */
            prompt: string;
            data?: {
                [key: string]: unknown;
            };
            name?: string;
            idempotencyKey?: string;
        };
        TriggerConditionsTest: {
            conditions?: {
                [key: string]: unknown;
            };
            webhook: {
                [key: string]: unknown;
            };
        };
        TraceReplayRequest: {
            /**
             * Format: uuid
             * @description Tenant-scoped idempotency key; preserve it when retrying. Use a new key to reconsider a previously skipped or unrecoverable run.
             */
            requestId: string;
            /**
             * @description Primary replays the persisted source declaration (native for historical runs); native_session selects retained native bytes for other providers or historical native-only Codex runs. Canonical Codex runs reject native replay.
             * @default primary
             * @enum {string}
             */
            source: "primary" | "native_session";
        };
    };
    responses: {
        /** @description Invalid request */
        Error400: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Invalid or revoked credentials */
        Error401: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Missing scope or required owner session */
        Error403: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Resource not found */
        Error404: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Operation conflict */
        Error409: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Unsupported media type; use application/json */
        Error415: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Rate limit exceeded */
        Error429: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Internal error */
        Error500: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Service unavailable */
        Error503: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_api_v1_x_connections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description X connection metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        connections: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            clientId: string;
                            scopes: string[];
                            accountId: string | null;
                            accountHandle: string | null;
                            grantedScopes: string[];
                            /** @enum {string} */
                            status: "pending" | "connected" | "reconnect_required" | "revoked";
                            createdAt: string;
                            updatedAt: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_x_connections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    clientId: string;
                    clientSecret: string;
                    scopes: ("tweet.read" | "tweet.write" | "tweet.moderate.write" | "users.email" | "users.read" | "follows.read" | "follows.write" | "offline.access" | "space.read" | "mute.read" | "mute.write" | "like.read" | "like.write" | "list.read" | "list.write" | "block.read" | "block.write" | "bookmark.read" | "bookmark.write" | "dm.read" | "dm.write" | "media.write" | "broadcast.read" | "broadcast.write")[];
                };
            };
        };
        responses: {
            /** @description X connection created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        clientId: string;
                        scopes: string[];
                        accountId: string | null;
                        accountHandle: string | null;
                        grantedScopes: string[];
                        /** @enum {string} */
                        status: "pending" | "connected" | "reconnect_required" | "revoked";
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_x_connections_connectionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description X connection deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_x_connections_connectionId_authorize: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description X authorization URL */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uri */
                        authorizationUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_x_connections_connectionId_test: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Safe connection test result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "connected" | "failed" | "reconnect_required";
                        accountHandle: string | null;
                        message: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_x_connections_connectionId_credentials: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    clientId: string;
                    clientSecret: string;
                };
            };
        };
        responses: {
            /** @description Updated safe connection metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        clientId: string;
                        scopes: string[];
                        accountId: string | null;
                        accountHandle: string | null;
                        grantedScopes: string[];
                        /** @enum {string} */
                        status: "pending" | "connected" | "reconnect_required" | "revoked";
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_model_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Model account metadata and collection revision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        accounts: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            description: string | null;
                            revision: number;
                            credentialConfigured: boolean;
                            providerUrl: string | null;
                            contextWindow: number | null;
                            maxTokens: number | null;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_model_accounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    id: string;
                    expectedRevision: number;
                    /** Format: uuid */
                    idempotencyKey: string;
                    name: string;
                    description: string | null;
                    /** Format: uri */
                    providerUrl: string;
                    apiKey?: string;
                    /** @default 128000 */
                    contextWindow?: number;
                    /** @default 8192 */
                    maxTokens?: number;
                };
            };
        };
        responses: {
            /** @description Created model account */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_model_accounts_accountId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                    /** Format: uuid */
                    idempotencyKey: string;
                    name: string;
                    description: string | null;
                    /** Format: uri */
                    providerUrl: string;
                    apiKey?: string;
                    /** @default 128000 */
                    contextWindow?: number;
                    /** @default 8192 */
                    maxTokens?: number;
                };
            };
        };
        responses: {
            /** @description Model account updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_model_accounts_accountId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                    /** Format: uuid */
                    idempotencyKey: string;
                };
            };
        };
        responses: {
            /** @description Deleted model account */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** @constant */
                        deleted: true;
                        revision: number;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_integrations_bearer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bearer integration metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        integrations: {
                            /** @constant */
                            kind?: "bearer";
                            /** Format: uuid */
                            id: string;
                            name: string;
                            origin: string;
                            description: string | null;
                            revision: number;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_bearer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    id: string;
                    expectedRevision: number;
                    /** Format: uuid */
                    idempotencyKey: string;
                    name: string;
                    /** Format: uri */
                    origin: string;
                    description: string | null;
                    token: string;
                };
            };
        };
        responses: {
            /** @description Created integration */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_integrations_bearer_integrationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                    /** Format: uuid */
                    idempotencyKey: string;
                    name: string;
                    /** Format: uri */
                    origin: string;
                    description: string | null;
                    token: string;
                };
            };
        };
        responses: {
            /** @description Updated integration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_integrations_bearer_integrationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                    /** Format: uuid */
                    idempotencyKey: string;
                };
            };
        };
        responses: {
            /** @description Deleted integration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** @constant */
                        deleted: true;
                        revision: number;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_connections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    returnTo: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        connection: string;
                        clientName: string;
                        /** Format: date-time */
                        expiresAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_connections_resume: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    connection: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        returnTo?: string;
                        crossBrowser?: boolean;
                        pending?: boolean;
                        clientName?: string;
                        /** Format: date-time */
                        expiresAt?: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_profile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        username: string;
                        /** Format: email */
                        email: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_profile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    username: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        username: string;
                        /** Format: email */
                        email: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_session: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Unauthenticated sessions return authenticated:false; expired, unverified, removed or revoked owners are unauthenticated. */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        authenticated: false;
                    } | {
                        /** @constant */
                        authenticated: true;
                        user: {
                            id: string;
                            /** Format: email */
                            email: string;
                        };
                        team: {
                            id: string;
                            name: string | null;
                            /** @constant */
                            role: "owner";
                        };
                        capabilities: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        /** Format: date-time */
                        expiresAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    password: string;
                    returnTo?: string;
                    /** Format: uuid */
                    connection?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        returnTo: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_signup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    username: string;
                    password: string;
                    /** Format: uuid */
                    connection?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            202: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_email_verification_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    /** Format: uuid */
                    connection?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_email_verification_complete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        returnTo?: string;
                        crossBrowser?: boolean;
                        pending?: boolean;
                        clientName?: string;
                        /** Format: date-time */
                        expiresAt?: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_password_reset_request: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email: string;
                    /** Format: uuid */
                    connection?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_password_reset_complete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                        returnTo?: string;
                        crossBrowser?: boolean;
                        pending?: boolean;
                        clientName?: string;
                        /** Format: date-time */
                        expiresAt?: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_password: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    currentPassword: string;
                    password: string;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    /** @description Conditions-only webhook runtime deployment marker. */
                    "X-Factorize-Webhook-Conditions"?: "v1";
                    /** @description Deployment compatibility marker for the complete GEN-2157 static-client API contract. Deploy this API stage before static frontend cutover. */
                    "X-Factorize-Contract"?: "gen-2157-static-v1";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        ok: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_oauth_device_preview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    userCode: string;
                };
            };
        };
        responses: {
            /** @description Pending device request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        userCode: string;
                        clientName: string;
                        scopes: string[];
                        expiresAt: string;
                        signature: string;
                        integrationLabels?: {
                            scope: string;
                            name: string;
                            description: string | null;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_oauth_device_decision: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    userCode: string;
                    signature: string;
                    /** @enum {string} */
                    decision: "allow" | "deny";
                };
            };
        };
        responses: {
            /** @description Device decision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "approved" | "denied";
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_oauth_consent_preview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    authorizationQuery: string;
                };
            };
        };
        responses: {
            /** @description Owner-bound expiring consent */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        clientName: string;
                        scopes: string[];
                        request: string;
                        signature: string;
                        expiresAt: string;
                        integrationLabels?: {
                            scope: string;
                            name: string;
                            description: string | null;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_oauth_consent_decision: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    request: string;
                    signature: string;
                    /** @enum {string} */
                    decision: "allow" | "deny";
                    scopes: string[];
                };
            };
        };
        responses: {
            /** @description Validated protocol destination */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        redirectTo: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_event_contexts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paths by event kind/provider */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: {
                            path: string;
                            /** @enum {string} */
                            type: "string" | "number" | "boolean" | "object" | "array" | "unknown";
                            description: string;
                            example?: unknown;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_exe_connections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Safe metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        connectionId: string;
                        /** @constant */
                        credentialStatus: "connected";
                        /** @default [] */
                        accountTags: string[];
                        tags?: string[];
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_github_installations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Installations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        installationId: number | string;
                        accountLogin: string;
                        accountType: string;
                        state: string;
                        updatedAt: string;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_trigger_event_availability: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Availability */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        manual: true;
                        /** @constant */
                        schedule: true;
                        /** @constant */
                        triggerLifecycle: true;
                        linear: boolean;
                        clickup: boolean;
                        github: boolean;
                        cloudflareTail: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_schedules_preview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    cron: string;
                    timezone: string;
                };
            };
        };
        responses: {
            /** @description Next occurrence */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        nextRunAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_integrations_cloudflare_tail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Integrations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        integrationId: string;
                        name: string;
                        /** @constant */
                        status: "connected";
                        /** @constant */
                        secretConfigured: true;
                        createdAt?: string;
                        updatedAt?: string;
                        referencedTriggerCount: number;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_cloudflare_tail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    integrationId?: string;
                    name: string;
                    signingSecret?: "" | string;
                    generateSecret?: boolean;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        integrationId: string;
                        name: string;
                        /** @constant */
                        status: "connected";
                        /** @constant */
                        secretConfigured: true;
                        generatedSecret?: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_integrations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Credential-safe integration status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        linear: {
                            organizationName: string | null;
                            viewerEmail: string | null;
                        } | null;
                        clickup: {
                            teamName: string | null;
                        } | null;
                        exe: {
                            connectionId: string;
                            /** @constant */
                            credentialStatus: "connected";
                            /** @default [] */
                            accountTags: string[];
                            tags?: string[];
                        } | null;
                        exeConnections: {
                            connectionId: string;
                            /** @constant */
                            credentialStatus: "connected";
                            /** @default [] */
                            accountTags: string[];
                            tags?: string[];
                        }[];
                        ampConnections: {
                            connectionId: string;
                            project: string;
                            apiBaseUrl?: string;
                        }[];
                        cloudflareTail: {
                            count: number;
                            installations: {
                                integrationId: string;
                                name: string;
                                /** @constant */
                                status: "connected";
                                /** @constant */
                                secretConfigured: true;
                                createdAt?: string;
                                updatedAt?: string;
                                referencedTriggerCount: number;
                            }[];
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_fly_connection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Connection status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        connection: {
                            organizationSlug: string;
                            organizationName: string;
                        } | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_fly_connection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    organizationSlug: string;
                };
            };
        };
        responses: {
            /** @description Saved connection metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        connection: {
                            organizationSlug: string;
                            organizationName: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_fly_connection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deletion result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        deleted: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_fly_connection_test: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                    organizationSlug: string;
                };
            };
        };
        responses: {
            /** @description Validated organization */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        valid: true;
                        connection: {
                            organizationSlug: string;
                            organizationName: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_vm_presets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List VM presets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        presets: {
                            name: string;
                            settings: {
                                image: string;
                                region: string;
                                size: string;
                                /** @constant */
                                provider: "fly";
                            } | {
                                /** @constant */
                                provider: "exe";
                                connectionId: string;
                                image: string;
                                tags: string[];
                            };
                            /** Format: uuid */
                            id: string;
                            executionConfigId: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_vm_presets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    settings: {
                        image: string;
                        region: string;
                        size: string;
                        /** @constant */
                        provider: "fly";
                    } | {
                        /** @constant */
                        provider: "exe";
                        connectionId: string;
                        image: string;
                        tags: string[];
                    };
                };
            };
        };
        responses: {
            /** @description Create a VM preset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        preset: {
                            name: string;
                            settings: {
                                image: string;
                                region: string;
                                size: string;
                                /** @constant */
                                provider: "fly";
                            } | {
                                /** @constant */
                                provider: "exe";
                                connectionId: string;
                                image: string;
                                tags: string[];
                            };
                            /** Format: uuid */
                            id: string;
                            executionConfigId: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_vm_presets_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    settings: {
                        image: string;
                        region: string;
                        size: string;
                        /** @constant */
                        provider: "fly";
                    } | {
                        /** @constant */
                        provider: "exe";
                        connectionId: string;
                        image: string;
                        tags: string[];
                    };
                };
            };
        };
        responses: {
            /** @description Update a VM preset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        preset: {
                            name: string;
                            settings: {
                                image: string;
                                region: string;
                                size: string;
                                /** @constant */
                                provider: "fly";
                            } | {
                                /** @constant */
                                provider: "exe";
                                connectionId: string;
                                image: string;
                                tags: string[];
                            };
                            /** Format: uuid */
                            id: string;
                            executionConfigId: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_vm_presets_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Delete a VM preset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        deleted: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_fly_execution_configurations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configurations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configurations: {
                            /** Format: uuid */
                            id: string;
                            presetName?: string;
                            name: string;
                            image: string;
                            region: string;
                            size: string;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_fly_execution_configurations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    image: string;
                    region: string;
                    size: string;
                };
            };
        };
        responses: {
            /** @description Created configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configuration: {
                            /** Format: uuid */
                            id: string;
                            presetName?: string;
                            name: string;
                            image: string;
                            region: string;
                            size: string;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_fly_execution_configurations_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configuration: {
                            /** Format: uuid */
                            id: string;
                            presetName?: string;
                            name: string;
                            image: string;
                            region: string;
                            size: string;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_fly_execution_configurations_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    image: string;
                    region: string;
                    size: string;
                };
            };
        };
        responses: {
            /** @description Updated configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configuration: {
                            /** Format: uuid */
                            id: string;
                            presetName?: string;
                            name: string;
                            image: string;
                            region: string;
                            size: string;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_fly_execution_configurations_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deletion result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @constant */
                        deleted: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_integrations_exe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    connectionId?: string;
                    apiToken?: string;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        connectionId: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_exe_test: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    connectionId?: string;
                    apiToken?: string;
                    tags?: string[];
                };
            };
        };
        responses: {
            /** @description Test result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        missingPermissions: string[];
                        tags: string[];
                        checks: {
                            command: string;
                            ok: boolean;
                            httpStatus: number;
                            exitCode: number | null;
                            output: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_integrations_amp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    connectionId?: string;
                    accessToken?: string;
                    project?: string;
                    /** Format: uri */
                    apiBaseUrl?: string;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                        connectionId: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_amp_test: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    connectionId?: string;
                    accessToken?: string;
                    project?: string;
                    /** Format: uri */
                    apiBaseUrl?: string;
                };
            };
        };
        responses: {
            /** @description Test result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_linear_projects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Projects */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_linear_options: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Options */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        statuses: {
                            id: string;
                            name: string;
                        }[];
                        users: {
                            id: string;
                            name: string;
                        }[];
                        labels: {
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_clickup_lists: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Lists */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_clickup_options: {
        parameters: {
            query?: {
                listId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Options */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        statuses: {
                            id: string;
                            name: string;
                        }[];
                        users: {
                            id: string;
                            name: string;
                        }[];
                        labels: {
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_github_installations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Installations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        installationId: number | string;
                        accountLogin: string;
                        accountType: string;
                        state: string;
                        updatedAt: string;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_access_authorized_clients: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Clients */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        availableScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write" | "proxy:use" | "vm:grant")[];
                        /** @description Integration ID to approved epoch-bound scope, or false to block. */
                        integrationOverrides: {
                            [key: string]: string | false;
                        };
                        revision: number;
                        grantId: string;
                        clientId: string;
                        clientName: string;
                        scopes: string[];
                        authorizationDate: string;
                        expiresAt: string | null;
                        lastUsedAt: string | null;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_access_tokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        scopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        created_at: string;
                        expires_at: string;
                        last_used_at?: string | null;
                        revoked_at?: string | null;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_access_tokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    scopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                    expiryDays: 7 | 30 | 90;
                };
            };
        };
        responses: {
            /** @description Created token */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        scopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        created_at: string;
                        expires_at: string;
                        last_used_at?: string | null;
                        revoked_at?: string | null;
                        token: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_access_tokens_tokenId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tokenId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_access_authorizations_grantId_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                grantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    disabledScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write" | "proxy:use" | "vm:grant")[];
                    /** @description Integration ID to approved epoch-bound scope, or false to block. */
                    integrationOverrides: {
                        [key: string]: string | false;
                    };
                    expectedRevision?: number;
                };
            };
        };
        responses: {
            /** @description Permissions saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_access_authorizations_grantId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                grantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorization revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revoked: number;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_access_authorized_clients_clientId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                clientId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked grants */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_integrations_exe_connectionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_integrations_amp_connectionId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_integrations_cloudflare_tail_integrationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    integrationId?: string;
                    name: string;
                    signingSecret?: "" | string;
                    generateSecret?: boolean;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        integrationId: string;
                        name: string;
                        /** @constant */
                        status: "connected";
                        /** @constant */
                        secretConfigured: true;
                        generatedSecret?: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_integrations_cloudflare_tail_integrationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_cloudflare_tail_integrationId_test: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Test result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        ok: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_github_installations_installationId_repositories: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Repositories */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: number;
                        name: string;
                        fullName: string;
                        owner: string;
                        private: boolean;
                        defaultBranch: string;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_providers_github_installations_installationId_repositories_repositoryId_issue_options: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
                repositoryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Options */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        statuses: {
                            id: string;
                            name: string;
                        }[];
                        users: {
                            id: string;
                            name: string;
                        }[];
                        labels: {
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_providers_github_installations_installationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disconnected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_exe_connectionId_diagnostics: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Credential-safe diagnostic result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_trigger_summaries: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                q?: string;
                enabled?: "true" | "false";
                sort?: "id" | "updated" | "active" | "running" | "title";
                direction?: "asc" | "desc";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Summary page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            enabled: boolean;
                            model: string;
                            effort: string;
                            agentKind: string;
                            /** @enum {string} */
                            executionType: "agent" | "code";
                            concurrencyLimit: number;
                            runningCount: number;
                            lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_trigger_selector: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                q?: string;
                enabled?: "true" | "false";
                sort?: "id" | "updated" | "active" | "running" | "title";
                direction?: "asc" | "desc";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Selector page; same ordering/filter semantics as trigger-summaries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            enabled: boolean;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_triggers_graph: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Team graph */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        nodes: {
                            id: string;
                            /** @enum {string} */
                            type: "trigger" | "webhook";
                            label: string;
                            /** @enum {string} */
                            triggerKind?: "Agent" | "Code";
                            enabled?: boolean;
                            runningCount?: number;
                            concurrencyLimit?: number;
                            provider?: string;
                            resource?: string;
                        }[];
                        edges: {
                            id: string;
                            source: string;
                            target: string;
                            label: string;
                            details?: string;
                            /** @enum {string} */
                            kind: "lifecycle" | "idle" | "manual" | "webhook";
                            enabled: boolean;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_team: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Team */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string | null;
                        runDefaults: {
                            executionConfigId?: string;
                            requiresVm?: boolean;
                            model?: string;
                            /** @enum {string} */
                            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                            vmImage?: string;
                            tags?: string[];
                            /** Format: uuid */
                            modelAccountId?: string;
                            portableIntegrationIds?: string[];
                            githubInstallationIds?: number[];
                            linearConnectionId?: "linear" | null;
                            xConnectionIds?: string[];
                            /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                            runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                            capacity?: number;
                            concurrencyLimit?: number;
                            allowedTriggerIds?: string[];
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_team_run_defaults: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    executionConfigId?: string;
                    requiresVm?: boolean;
                    model?: string;
                    /** @enum {string} */
                    effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                    vmImage?: string;
                    tags?: string[];
                    /** Format: uuid */
                    modelAccountId?: string;
                    portableIntegrationIds?: string[];
                    githubInstallationIds?: number[];
                    linearConnectionId?: "linear" | null;
                    xConnectionIds?: string[];
                    /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                    runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                    capacity?: number;
                    concurrencyLimit?: number;
                    allowedTriggerIds?: string[];
                };
            };
        };
        responses: {
            /** @description Team run defaults */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        executionConfigId?: string;
                        requiresVm?: boolean;
                        model?: string;
                        /** @enum {string} */
                        effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                        vmImage?: unknown;
                        tags?: string[];
                        /** Format: uuid */
                        modelAccountId?: string;
                        portableIntegrationIds?: string[];
                        githubInstallationIds?: number[];
                        linearConnectionId?: "linear" | null;
                        xConnectionIds?: string[];
                        /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                        runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        capacity?: number;
                        concurrencyLimit?: number;
                        allowedTriggerIds?: string[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skill_library: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Read skill repository settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        source: ({
                            /** @constant */
                            kind: "managed";
                        } | {
                            /** @constant */
                            kind: "github";
                            installationId: number;
                            repositoryId: number;
                            branch: string;
                            folder: string;
                        }) | null;
                        remote: string | null;
                        commit: string | null;
                        upstreamCommit: string | null;
                        error: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_skill_library: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @constant */
                    kind: "managed";
                } | {
                    /** @constant */
                    kind: "github";
                    installationId: number;
                    repositoryId: number;
                    branch: string;
                    folder: string;
                    /**
                     * @description Required when changing to a GitHub source. Replaces the active library, including deletions.
                     * @constant
                     */
                    confirmOverwrite?: true;
                };
            };
        };
        responses: {
            /** @description Select the authoritative skills repository */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        source: ({
                            /** @constant */
                            kind: "managed";
                        } | {
                            /** @constant */
                            kind: "github";
                            installationId: number;
                            repositoryId: number;
                            branch: string;
                            folder: string;
                        }) | null;
                        remote: string | null;
                        commit: string | null;
                        upstreamCommit: string | null;
                        error: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_skill_library_token: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Issue a one-hour repository credential (read-only for GitHub mirrors) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        remote: string;
                        token: string;
                        expiresAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_skill_library_sync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Synchronize the tracked branch */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        source: ({
                            /** @constant */
                            kind: "managed";
                        } | {
                            /** @constant */
                            kind: "github";
                            installationId: number;
                            repositoryId: number;
                            branch: string;
                            folder: string;
                        }) | null;
                        remote: string | null;
                        commit: string | null;
                        upstreamCommit: string | null;
                        error: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skills_skillId_files: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Published files, with base64 encoded contents */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        commit: string | null;
                        files: {
                            path: string;
                            content: string;
                            executable: boolean;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skills_skillId_trigger: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Optional trigger */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        trigger: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            enabled: boolean;
                            requiresVm: boolean;
                            /** @enum {string} */
                            executionType?: "agent" | "code";
                            prompt: string;
                            script?: string;
                            runNameTemplate: string;
                            tags?: string[];
                            model: string;
                            effort?: string;
                            executionConfig: {
                                connectionId: string;
                                requiresVm?: boolean;
                                workspace?: string;
                                cwd?: string;
                                agentKind: string;
                                image?: string;
                                region?: string;
                                size?: string;
                                /** @enum {string} */
                                executionType?: "agent" | "code";
                                script?: string;
                            };
                            runScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                            portableIntegrationIds?: string[];
                            /** Format: uuid */
                            modelAccountId?: string;
                            githubInstallationIds?: number[];
                            linearConnectionId?: "linear" | null;
                            xConnectionIds?: string[];
                            skillId?: string | null;
                            executionConfigId: string;
                            agentKind: string;
                            concurrencyLimit: number;
                            runningCount: number;
                            currentRuns: number;
                            maxConcurrency: number;
                            lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                            events: ({
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "manual";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                /** @default {} */
                                config: Record<string, never>;
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "schedule";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    cron: string;
                                    timezone: string;
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "webhook";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "linear";
                                    projectId: string;
                                    matchRules: {
                                        /** @enum {string} */
                                        type: "owner" | "creator" | "status" | "label" | "assignee";
                                        targetId: string;
                                    }[];
                                    secretConfigured?: boolean;
                                } | {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "clickup";
                                    listId: string;
                                    matchRules: {
                                        /** @enum {string} */
                                        type: "owner" | "creator" | "status" | "label" | "assignee";
                                        targetId: string;
                                    }[];
                                    secretConfigured?: boolean;
                                } | {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "github";
                                    installationId: number;
                                    repositoryId: number;
                                    event?: string;
                                    action?: string;
                                    matchRules?: {
                                        /** @enum {string} */
                                        type: "owner" | "creator" | "status" | "label" | "assignee";
                                        targetId: string;
                                    }[];
                                    secretConfigured?: boolean;
                                } | {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "cloudflareTail";
                                    integrationId: string;
                                    destination?: string;
                                    secretConfigured?: boolean;
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "triggerLifecycle";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    sourceTriggerIds: string[];
                                    states: ("succeeded" | "failed" | "stopped" | "edited")[];
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "triggerIdle";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    sourceTriggerIds: string[];
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            })[];
                            skill?: {
                                /** Format: uuid */
                                id: string;
                                key: string;
                                revision: number;
                            } | null;
                            contextReviewRequired?: boolean;
                            createdAt: string;
                            updatedAt: string;
                        } | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_skills_skillId_trigger: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    events: ({
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "manual";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        /** @default {} */
                        config?: Record<string, never>;
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "schedule";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            cron: string;
                            timezone: string;
                        };
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "webhook";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "linear";
                            projectId: string;
                            matchRules: {
                                /** @enum {string} */
                                type: "owner" | "creator" | "status" | "label" | "assignee";
                                targetId: string;
                            }[];
                        } | {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "clickup";
                            listId: string;
                            matchRules: {
                                /** @enum {string} */
                                type: "owner" | "creator" | "status" | "label" | "assignee";
                                targetId: string;
                            }[];
                        } | {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "github";
                            installationId: number;
                            repositoryId: number;
                            event?: string;
                            action?: string;
                            matchRules?: {
                                /** @enum {string} */
                                type: "owner" | "creator" | "status" | "label" | "assignee";
                                targetId: string;
                            }[];
                        } | {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "cloudflareTail";
                            integrationId: string;
                        };
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "triggerLifecycle";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            sourceTriggerIds: string[];
                            states: ("succeeded" | "failed" | "stopped" | "edited")[];
                        };
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "triggerIdle";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            sourceTriggerIds: string[];
                        };
                    })[];
                    /** @default true */
                    enabled?: boolean;
                    /** Format: date-time */
                    expectedUpdatedAt?: string;
                };
            };
        };
        responses: {
            /** @description Saved trigger */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        trigger: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            enabled: boolean;
                            requiresVm: boolean;
                            /** @enum {string} */
                            executionType?: "agent" | "code";
                            prompt: string;
                            script?: string;
                            runNameTemplate: string;
                            tags?: string[];
                            model: string;
                            effort?: string;
                            executionConfig: {
                                connectionId: string;
                                requiresVm?: boolean;
                                workspace?: string;
                                cwd?: string;
                                agentKind: string;
                                image?: string;
                                region?: string;
                                size?: string;
                                /** @enum {string} */
                                executionType?: "agent" | "code";
                                script?: string;
                            };
                            runScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                            portableIntegrationIds?: string[];
                            /** Format: uuid */
                            modelAccountId?: string;
                            githubInstallationIds?: number[];
                            linearConnectionId?: "linear" | null;
                            xConnectionIds?: string[];
                            skillId?: string | null;
                            executionConfigId: string;
                            agentKind: string;
                            concurrencyLimit: number;
                            runningCount: number;
                            currentRuns: number;
                            maxConcurrency: number;
                            lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                            events: ({
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "manual";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                /** @default {} */
                                config: Record<string, never>;
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "schedule";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    cron: string;
                                    timezone: string;
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "webhook";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "linear";
                                    projectId: string;
                                    matchRules: {
                                        /** @enum {string} */
                                        type: "owner" | "creator" | "status" | "label" | "assignee";
                                        targetId: string;
                                    }[];
                                    secretConfigured?: boolean;
                                } | {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "clickup";
                                    listId: string;
                                    matchRules: {
                                        /** @enum {string} */
                                        type: "owner" | "creator" | "status" | "label" | "assignee";
                                        targetId: string;
                                    }[];
                                    secretConfigured?: boolean;
                                } | {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "github";
                                    installationId: number;
                                    repositoryId: number;
                                    event?: string;
                                    action?: string;
                                    matchRules?: {
                                        /** @enum {string} */
                                        type: "owner" | "creator" | "status" | "label" | "assignee";
                                        targetId: string;
                                    }[];
                                    secretConfigured?: boolean;
                                } | {
                                    conditions?: {
                                        [key: string]: unknown;
                                    };
                                    /** @constant */
                                    provider: "cloudflareTail";
                                    integrationId: string;
                                    destination?: string;
                                    secretConfigured?: boolean;
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "triggerLifecycle";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    sourceTriggerIds: string[];
                                    states: ("succeeded" | "failed" | "stopped" | "edited")[];
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            } | {
                                /** Format: uuid */
                                id: string;
                                slug: string;
                                /** @constant */
                                kind: "triggerIdle";
                                template?: string;
                                /** @default true */
                                enabled: boolean;
                                config: {
                                    sourceTriggerIds: string[];
                                };
                                /** Format: uuid */
                                triggerId: string;
                                createdAt: string;
                                updatedAt: string;
                            })[];
                            skill?: {
                                /** Format: uuid */
                                id: string;
                                key: string;
                                revision: number;
                            } | null;
                            contextReviewRequired?: boolean;
                            createdAt: string;
                            updatedAt: string;
                        } | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skills_skillId_settings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Skill settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        defaults: {
                            executionConfigId?: string;
                            requiresVm?: boolean;
                            model?: string;
                            /** @enum {string} */
                            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                            /** @description Public Docker/OCI image reference, or blank for the provider default. */
                            vmImage?: string;
                            tags?: string[];
                            /** Format: uuid */
                            modelAccountId?: string;
                            portableIntegrationIds?: string[];
                            githubInstallationIds?: number[];
                            linearConnectionId?: "linear" | null;
                            xConnectionIds?: string[];
                            /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                            runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                            concurrencyLimit?: number;
                            allowedTriggerIds?: string[];
                            /**
                             * @default agent
                             * @enum {string}
                             */
                            executionType: "agent" | "code";
                            /** @default  */
                            prompt: string;
                            script?: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_skills_skillId_settings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                    defaults: {
                        executionConfigId?: string;
                        requiresVm?: boolean;
                        model?: string;
                        /** @enum {string} */
                        effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                        /** @description Public Docker/OCI image reference, or blank for the provider default. */
                        vmImage?: string;
                        tags?: string[];
                        /** Format: uuid */
                        modelAccountId?: string;
                        portableIntegrationIds?: string[];
                        githubInstallationIds?: number[];
                        linearConnectionId?: "linear" | null;
                        xConnectionIds?: string[];
                        /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                        runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        concurrencyLimit?: number;
                        allowedTriggerIds?: string[];
                        /**
                         * @default agent
                         * @enum {string}
                         */
                        executionType?: "agent" | "code";
                        /** @default  */
                        prompt?: string;
                        script?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Saved skill settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revision: number;
                        defaults: {
                            executionConfigId?: string;
                            requiresVm?: boolean;
                            model?: string;
                            /** @enum {string} */
                            effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                            /** @description Public Docker/OCI image reference, or blank for the provider default. */
                            vmImage?: string;
                            tags?: string[];
                            /** Format: uuid */
                            modelAccountId?: string;
                            portableIntegrationIds?: string[];
                            githubInstallationIds?: number[];
                            linearConnectionId?: "linear" | null;
                            xConnectionIds?: string[];
                            /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                            runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                            concurrencyLimit?: number;
                            allowedTriggerIds?: string[];
                            /**
                             * @default agent
                             * @enum {string}
                             */
                            executionType: "agent" | "code";
                            /** @default  */
                            prompt: string;
                            script?: string;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skills: {
        parameters: {
            query?: {
                q?: string;
                limit?: number;
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Skills */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            revision: number;
                            usageCount: number;
                            createdAt: string;
                            updatedAt: string;
                            trigger?: {
                                /** Format: uuid */
                                id: string;
                                enabled: boolean;
                            } | null;
                            lastRunState?: string | null;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_skills: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key: string;
                    body: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        key: string;
                        revision: number;
                        body: string;
                        usageCount: number;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_triggers_preview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    skillId?: string | null;
                    /** @default  */
                    prompt?: string;
                    eventTemplate?: string;
                    eventData?: {
                        [key: string]: unknown;
                    };
                    eventSlug?: string;
                    /**
                     * @default manual
                     * @enum {string}
                     */
                    eventKind?: "manual" | "schedule" | "webhook" | "triggerLifecycle" | "triggerIdle";
                    /** @default  */
                    instructions?: string;
                    runNameTemplate?: string;
                };
            };
        };
        responses: {
            /** @description Prompt preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        prompt: string;
                        eventText: string;
                        skill: {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            revision: number;
                        } | null;
                        runName: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skills_skillId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Skill */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        key: string;
                        revision: number;
                        body: string;
                        usageCount: number;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_skills_skillId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    key?: string;
                    body?: string;
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        key: string;
                        revision: number;
                        body: string;
                        usageCount: number;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_skills_skillId: {
        parameters: {
            query: {
                expectedRevision: number;
            };
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_skills_skillId_triggers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skillId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Triggers */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        skillId: string;
                        triggers: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            enabled: boolean;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_vm_image_verifications: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    connectionId: string;
                    image: string;
                    tags: string[];
                };
            };
        };
        responses: {
            /** @description Verification operation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        status: "queued" | "creating" | "checking_ssh" | "checking_agent" | "cleaning_up" | "succeeded" | "failed" | "cleanup_failed";
                        phase: string;
                        errorKind: string | null;
                        error: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_vm_image_verifications_verificationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                verificationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Verification operation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        status: "queued" | "creating" | "checking_ssh" | "checking_agent" | "cleaning_up" | "succeeded" | "failed" | "cleanup_failed";
                        phase: string;
                        errorKind: string | null;
                        error: string | null;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_triggers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Triggers */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        enabled: boolean;
                        requiresVm: boolean;
                        /** @enum {string} */
                        executionType?: "agent" | "code";
                        prompt: string;
                        script?: string;
                        runNameTemplate: string;
                        tags?: string[];
                        model: string;
                        effort?: string;
                        executionConfig: {
                            connectionId: string;
                            requiresVm?: boolean;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                            image?: string;
                            region?: string;
                            size?: string;
                            /** @enum {string} */
                            executionType?: "agent" | "code";
                            script?: string;
                        };
                        runScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        portableIntegrationIds?: string[];
                        /** Format: uuid */
                        modelAccountId?: string;
                        githubInstallationIds?: number[];
                        linearConnectionId?: "linear" | null;
                        xConnectionIds?: string[];
                        skillId?: string | null;
                        executionConfigId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        events: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "linear";
                                projectId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "clickup";
                                listId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "github";
                                installationId: number;
                                repositoryId: number;
                                event?: string;
                                action?: string;
                                matchRules?: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "cloudflareTail";
                                integrationId: string;
                                destination?: string;
                                secretConfigured?: boolean;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerLifecycle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerIdle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        })[];
                        skill?: {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            revision: number;
                        } | null;
                        contextReviewRequired?: boolean;
                        createdAt: string;
                        updatedAt: string;
                    }[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_triggers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TriggerInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        enabled: boolean;
                        requiresVm: boolean;
                        /** @enum {string} */
                        executionType?: "agent" | "code";
                        prompt: string;
                        script?: string;
                        runNameTemplate: string;
                        tags?: string[];
                        model: string;
                        effort?: string;
                        executionConfig: {
                            connectionId: string;
                            requiresVm?: boolean;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                            image?: string;
                            region?: string;
                            size?: string;
                            /** @enum {string} */
                            executionType?: "agent" | "code";
                            script?: string;
                        };
                        runScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        portableIntegrationIds?: string[];
                        /** Format: uuid */
                        modelAccountId?: string;
                        githubInstallationIds?: number[];
                        linearConnectionId?: "linear" | null;
                        xConnectionIds?: string[];
                        skillId?: string | null;
                        executionConfigId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        events: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "linear";
                                projectId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "clickup";
                                listId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "github";
                                installationId: number;
                                repositoryId: number;
                                event?: string;
                                action?: string;
                                matchRules?: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "cloudflareTail";
                                integrationId: string;
                                destination?: string;
                                secretConfigured?: boolean;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerLifecycle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerIdle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        })[];
                        skill?: {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            revision: number;
                        } | null;
                        contextReviewRequired?: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_trigger_conditions_test: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TriggerConditionsTest"];
            };
        };
        responses: {
            /** @description Decision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        decision: "match" | "no-match" | "error";
                        error?: string;
                        details: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_triggers_triggerId_invocations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualInvocation"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        invocationId: string;
                        runId: string;
                        state: string;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            /** @description queue_full — all execution slots are reserved or occupied and one waiting run already exists. Duplicate idempotency keys return the original run. */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runtime_launch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Launch payload for the calling run */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        version: 1;
                        /** Format: uuid */
                        runId: string;
                        traceSources?: {
                            [key: string]: unknown;
                        };
                        prompt: string;
                        skillFiles?: {
                            path: string;
                            content: string;
                            executable: boolean;
                        }[];
                        harness: {
                            executable: string;
                            args: string[];
                            env: {
                                [key: string]: string;
                            };
                        };
                    } | {
                        /** @constant */
                        version: 1;
                        /** Format: uuid */
                        runId: string;
                        traceSources?: {
                            [key: string]: unknown;
                        };
                        code: {
                            script: string;
                            context: {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_vm_grants: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    providerIntegrationId: string;
                    vm: string;
                    integrationIds: string[];
                    idempotencyKey: string;
                };
            };
        };
        responses: {
            /** @description Verified VM grant */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        grantId: string;
                        vm: string;
                        integrationIds: string[];
                        expiresAt: string;
                        /** Format: uri */
                        tokenUrl: string;
                        proofFile: string;
                        /** Format: uri */
                        requestUrl: string;
                        instructions: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_agent_vm_grants_grantId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                grantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked grant */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        grantId: string;
                        revoked: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_media_uploads: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    mediaType: string;
                    byteSize: number;
                    sha256: string;
                    idempotencyKey: string;
                };
            };
        };
        responses: {
            /** @description Idempotent upload receipt */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        artifactId: string;
                        mediaType: string;
                        byteSize: number;
                        sha256: string;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "ready" | "deleting" | "deleted";
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        readUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_media_artifactId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Original media bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_media_artifactId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Verified media receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        artifactId: string;
                        mediaType: string;
                        byteSize: number;
                        sha256: string;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "ready" | "deleting" | "deleted";
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        readUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_media_fetch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    integration: string;
                    /** Format: starts_with */
                    path: string;
                    headers?: {
                        [key: string]: string;
                    };
                    idempotencyKey: string;
                };
            };
        };
        responses: {
            /** @description Media receipt */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        artifactId: string;
                        mediaType: string;
                        byteSize: number;
                        sha256: string;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "ready" | "deleting" | "deleted";
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        readUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runtime_vm_exec: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    command: string;
                    /** Format: starts_with */
                    cwd?: string;
                };
            };
        };
        responses: {
            /** @description Command output and exit status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        output: string;
                        exitCode: number;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_agent_reflection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Agent reflection */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        media?: {
                            /** @constant */
                            frameworkVersion: "1.5.2";
                            contentTypes: ("text" | "image")[];
                            maxUploadBytes: number;
                            maxTurnMediaBytes: number;
                            /** Format: uri */
                            uploadUrl: string;
                            /** @constant */
                            fetchTool: "fetch_media";
                            /** @constant */
                            readTool: "read_media";
                        };
                        /** @enum {string} */
                        agentHost: "factorize" | "external" | "vm";
                        current_vm: {
                            /** @enum {string} */
                            provider: "exe.dev" | "fly.io";
                            id: string;
                            /** Format: uuid */
                            runId: string;
                            /** @constant */
                            status: "ready";
                            cwd: string;
                            verifiedAt: string;
                            /** @constant */
                            tool: "vm_exec";
                        } | null;
                        identity: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "oauth" | "run";
                        };
                        scopes: string[];
                        proxy: {
                            /** Format: uri */
                            requestUrl: string;
                            /** Format: uri */
                            readResponseUrl: string;
                            /** @constant */
                            requestTool: "request_api";
                            /** @constant */
                            readResponseTool: "read_api_response";
                            authentication: string;
                        };
                        integrations: {
                            /** Format: uuid */
                            id: string;
                            credentialId: string;
                            name: string;
                            description: string | null;
                            /** @enum {string} */
                            kind: "bearer" | "github" | "linear" | "model" | "fly" | "exe" | "amp" | "clickup" | "x";
                            /** @enum {string} */
                            policy: "baseline" | "requestable" | "disabled";
                            available: boolean;
                            revision: number;
                            requiredScope: string;
                            /** @enum {string} */
                            access: "granted" | "requestable" | "unavailable";
                            instructions: string;
                            requestExample: {
                                /** Format: uuid */
                                integration: string;
                                /** @enum {string} */
                                method: "GET" | "POST";
                                path: string;
                                headers?: {
                                    [key: string]: string;
                                };
                                body?: string;
                            };
                            /** @constant */
                            vmGrantProvider?: "exe.dev";
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_requests: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    integration: string;
                    /** @enum {string} */
                    method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
                    path: string;
                    /** @default {} */
                    headers?: {
                        [key: string]: string;
                    };
                    /** @enum {string} */
                    execution?: "sync" | "async";
                    idempotencyKey?: string;
                    maxResultBytes?: number;
                    bodySource?: {
                        /** @constant */
                        kind: "payload";
                        /** Format: uuid */
                        handle: string;
                    } | {
                        /** @constant */
                        kind: "response";
                        /** Format: uuid */
                        handle: string;
                    } | {
                        /** @constant */
                        kind: "artifact";
                        /** Format: uuid */
                        runId: string;
                        /** Format: uuid */
                        artifactId: string;
                    };
                    multipart?: {
                        name: string;
                        text?: string;
                        source?: {
                            /** @constant */
                            kind: "payload";
                            /** Format: uuid */
                            handle: string;
                        } | {
                            /** @constant */
                            kind: "response";
                            /** Format: uuid */
                            handle: string;
                        } | {
                            /** @constant */
                            kind: "artifact";
                            /** Format: uuid */
                            runId: string;
                            /** Format: uuid */
                            artifactId: string;
                        };
                        filename?: string;
                        mediaType?: string;
                    }[];
                    body?: string;
                    /**
                     * @default utf8
                     * @enum {string}
                     */
                    encoding?: "utf8" | "base64";
                };
            };
        };
        responses: {
            /** @description Upstream response or retained response handle */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: number;
                        headers: {
                            [key: string]: string;
                        };
                        size: number;
                        /** @enum {string} */
                        encoding: "utf8" | "base64";
                        body?: string;
                        /** Format: uuid */
                        handle?: string;
                        expiresAt?: string;
                        preview?: string;
                        instructions?: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_telemetry: {
        parameters: {
            query?: {
                cursor?: number;
                limit?: number;
            };
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Telemetry page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        available: boolean;
                        traceId: string | null;
                        items: {
                            id: string;
                            key: string;
                            traceId: string;
                            parentId: string | null;
                            kind: string;
                            name: string;
                            model: string | null;
                            /** @enum {string} */
                            status: "running" | "ok" | "error" | "canceled" | "uncertain";
                            startedAt: string;
                            endedAt: string | null;
                            durationMs: number;
                            usage: {
                                input: number | null;
                                uncachedInput: number | null;
                                output: number | null;
                                cacheRead: number | null;
                                cacheWrite: number | null;
                                reasoning: number | null;
                                total: number | null;
                            };
                            costUsd: number | null;
                        }[];
                        nextCursor: number | null;
                        phoenix?: {
                            url: string | null;
                            pending: number;
                            sent: number;
                            failed: number;
                            canceled: number;
                            lastError: string | null;
                        };
                        summary: {
                            durationMs: number | null;
                            modelCalls: number;
                            toolCalls: number;
                            unreportedCalls: number;
                            unpricedCalls: number;
                            usage: {
                                input: number | null;
                                uncachedInput: number | null;
                                output: number | null;
                                cacheRead: number | null;
                                cacheWrite: number | null;
                                reasoning: number | null;
                                total: number | null;
                            };
                            costUsd: number | null;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_telemetry_spanId: {
        parameters: {
            query?: {
                field?: "input" | "output";
                chunk?: number;
                offset?: number;
                limit?: number;
            };
            header?: never;
            path: {
                runId: string;
                spanId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description At most 2048 characters of encrypted-at-rest content */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        text: string;
                        /** @enum {string} */
                        field: "input" | "output";
                        next: {
                            chunk: number;
                            offset: number;
                        } | null;
                        pricing: unknown;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_integrations_phoenix: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Phoenix configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configured: boolean;
                        endpoint: string;
                        projectName: string;
                        projectId: string | null;
                        credentialConfigured: boolean;
                        enabled: boolean;
                        revision: number;
                        lastTestAt: string | null;
                        lastError: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_integrations_phoenix: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uri */
                    endpoint: string;
                    projectName: string;
                    apiKey?: string;
                    /** @default true */
                    enabled?: boolean;
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description Saved configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configured: boolean;
                        endpoint: string;
                        projectName: string;
                        projectId: string | null;
                        credentialConfigured: boolean;
                        enabled: boolean;
                        revision: number;
                        lastTestAt: string | null;
                        lastError: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_integrations_phoenix: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description Disconnected configuration */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        configured: boolean;
                        endpoint: string;
                        projectName: string;
                        projectId: string | null;
                        credentialConfigured: boolean;
                        enabled: boolean;
                        revision: number;
                        lastTestAt: string | null;
                        lastError: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_integrations_phoenix_test: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Connection result without credentials */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        connected: boolean;
                        projectFound: boolean;
                        error: string | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_model_pricing: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pricing settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        catalogVersion: string;
                        source: string;
                        items: {
                            /** Format: uuid */
                            integrationId: string;
                            model: string;
                            rates: {
                                input: number;
                                output: number;
                                cacheRead?: number;
                                cacheWrite?: number;
                            } | null;
                            revision: number;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_model_pricing: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    integrationId: string;
                    model: string;
                    rates: {
                        input: number;
                        output: number;
                        cacheRead?: number;
                        cacheWrite?: number;
                    } | null;
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description Saved override revision */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        integrationId: string;
                        model: string;
                        rates: {
                            input: number;
                            output: number;
                            cacheRead?: number;
                            cacheWrite?: number;
                        } | null;
                        revision: number;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_proxy_payloads: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default payload */
                    name?: string;
                    /** @default application/octet-stream */
                    mediaType?: string;
                    byteSize?: number;
                };
            };
        };
        responses: {
            /** @description Upload/staging receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        name: string;
                        mediaType: string;
                        size: number;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "finalizing" | "ready";
                        sha256: string | null;
                        expiresAt: string;
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        browserUploadUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_proxy_payloads_handle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                handle: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Payload receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        name: string;
                        mediaType: string;
                        size: number;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "finalizing" | "ready";
                        sha256: string | null;
                        expiresAt: string;
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        browserUploadUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_proxy_payloads_handle_bytes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                handle: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Finalized payload receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        name: string;
                        mediaType: string;
                        size: number;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "finalizing" | "ready";
                        sha256: string | null;
                        expiresAt: string;
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        browserUploadUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_proxy_payloads_append: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    handle: string;
                    offset: number;
                    body: string;
                    /**
                     * @default utf8
                     * @enum {string}
                     */
                    encoding?: "utf8" | "base64";
                };
            };
        };
        responses: {
            /** @description Payload progress */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        name: string;
                        mediaType: string;
                        size: number;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "finalizing" | "ready";
                        sha256: string | null;
                        expiresAt: string;
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        browserUploadUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_proxy_payloads_finalize: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    handle: string;
                    sha256?: string;
                };
            };
        };
        responses: {
            /** @description Immutable payload receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        name: string;
                        mediaType: string;
                        size: number;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "finalizing" | "ready";
                        sha256: string | null;
                        expiresAt: string;
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        browserUploadUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_proxy_payloads_attachment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    file: {
                        /** Format: uri */
                        download_url: string;
                        file_id: string;
                        mime_type?: string;
                        file_name?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Imported file handle */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        name: string;
                        mediaType: string;
                        size: number;
                        /** @enum {string} */
                        state: "pending" | "uploading" | "finalizing" | "ready";
                        sha256: string | null;
                        expiresAt: string;
                        /** Format: uri */
                        uploadUrl: string;
                        /** Format: uri */
                        browserUploadUrl: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_operations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    integration: string;
                    /** @enum {string} */
                    method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
                    path: string;
                    /** @default {} */
                    headers?: {
                        [key: string]: string;
                    };
                    /** @enum {string} */
                    execution?: "sync" | "async";
                    idempotencyKey?: string;
                    maxResultBytes?: number;
                    bodySource?: {
                        /** @constant */
                        kind: "payload";
                        /** Format: uuid */
                        handle: string;
                    } | {
                        /** @constant */
                        kind: "response";
                        /** Format: uuid */
                        handle: string;
                    } | {
                        /** @constant */
                        kind: "artifact";
                        /** Format: uuid */
                        runId: string;
                        /** Format: uuid */
                        artifactId: string;
                    };
                    multipart?: {
                        name: string;
                        text?: string;
                        source?: {
                            /** @constant */
                            kind: "payload";
                            /** Format: uuid */
                            handle: string;
                        } | {
                            /** @constant */
                            kind: "response";
                            /** Format: uuid */
                            handle: string;
                        } | {
                            /** @constant */
                            kind: "artifact";
                            /** Format: uuid */
                            runId: string;
                            /** Format: uuid */
                            artifactId: string;
                        };
                        filename?: string;
                        mediaType?: string;
                    }[];
                    body?: string;
                    /**
                     * @default utf8
                     * @enum {string}
                     */
                    encoding?: "utf8" | "base64";
                };
            };
        };
        responses: {
            /** @description Durable operation state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        operationId: string;
                        /** @enum {string} */
                        state: "queued" | "running" | "complete" | "failed" | "canceled" | "uncertain";
                        status: number | null;
                        size: number;
                        partial: boolean;
                        effectsUncertain: boolean;
                        error: {
                            code: string;
                            message: string;
                        } | null;
                        /** Format: uuid */
                        responseHandle?: string;
                        expiresAt: string;
                        instructions: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_operations_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    operationId: string;
                };
            };
        };
        responses: {
            /** @description Operation state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        operationId: string;
                        /** @enum {string} */
                        state: "queued" | "running" | "complete" | "failed" | "canceled" | "uncertain";
                        status: number | null;
                        size: number;
                        partial: boolean;
                        effectsUncertain: boolean;
                        error: {
                            code: string;
                            message: string;
                        } | null;
                        /** Format: uuid */
                        responseHandle?: string;
                        expiresAt: string;
                        instructions: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_operations_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    operationId: string;
                };
            };
        };
        responses: {
            /** @description Cancellation state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        operationId: string;
                        /** @enum {string} */
                        state: "queued" | "running" | "complete" | "failed" | "canceled" | "uncertain";
                        status: number | null;
                        size: number;
                        partial: boolean;
                        effectsUncertain: boolean;
                        error: {
                            code: string;
                            message: string;
                        } | null;
                        /** Format: uuid */
                        responseHandle?: string;
                        expiresAt: string;
                        instructions: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_operations_read: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    operationId: string;
                    /** @default 0 */
                    offset?: number;
                    /** @default 384 */
                    limit?: number;
                };
            };
        };
        responses: {
            /** @description Partial or completed byte range */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        operationId: string;
                        offset: number;
                        nextOffset: number;
                        body: string;
                        /** @constant */
                        encoding: "base64";
                        size: number;
                        state: string;
                        done: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_responses_query: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    handle: string;
                    /**
                     * @default json
                     * @enum {string}
                     */
                    mode?: "json" | "text" | "bytes";
                    /** @default @ */
                    expression?: string;
                    /** @default 0 */
                    offset?: number;
                    /** @default 25 */
                    limit?: number;
                    /** @default 4096 */
                    maxResultBytes?: number;
                };
            };
        };
        responses: {
            /** @description Bounded selected data */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        /** @enum {string} */
                        mode: "json" | "text" | "bytes";
                        data: unknown;
                        offset: number;
                        nextOffset: number;
                        done: boolean;
                        /** @enum {string} */
                        encoding: "json" | "utf8" | "base64";
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_agent_responses_read: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    handle: string;
                    /** @default 0 */
                    offset?: number;
                    limit?: number;
                };
            };
        };
        responses: {
            /** @description Response chunk */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        handle: string;
                        offset: number;
                        nextOffset: number;
                        size: number;
                        /** @constant */
                        encoding: "base64";
                        body: string;
                        done: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_integration_api_policies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Policies */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        integrations: {
                            /** Format: uuid */
                            id: string;
                            credentialId: string;
                            name: string;
                            description: string | null;
                            /** @enum {string} */
                            kind: "bearer" | "github" | "linear" | "model" | "fly" | "exe" | "amp" | "clickup" | "x";
                            /** @enum {string} */
                            policy: "baseline" | "requestable" | "disabled";
                            available: boolean;
                            revision: number;
                            requiredScope: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_integration_api_policies_integrationId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                integrationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    policy: "baseline" | "requestable" | "disabled";
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description Updated policies */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        integrations: {
                            /** Format: uuid */
                            id: string;
                            credentialId: string;
                            name: string;
                            description: string | null;
                            /** @enum {string} */
                            kind: "bearer" | "github" | "linear" | "model" | "fly" | "exe" | "amp" | "clickup" | "x";
                            /** @enum {string} */
                            policy: "baseline" | "requestable" | "disabled";
                            available: boolean;
                            revision: number;
                            requiredScope: string;
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runtime_context: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Verified runtime identity */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "factorize-runtime-context-v1";
                        authMethod: string;
                        runId: string | null;
                        triggerId: string | null;
                        scopes: string[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runtime_integrations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Selected run integrations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        kind: "factorize-run-integrations-v1";
                        integrations: {
                            id: string;
                            name: string;
                            description: string | null;
                            path: string;
                            available: boolean;
                        }[];
                        /** @default [] */
                        xConnections: {
                            id: string;
                            name: string;
                            accountHandle: string | null;
                            scopes: string[];
                            path: string;
                            available: boolean;
                        }[];
                        providers: {
                            githubInstallations: {
                                installationId: number;
                                path: string;
                                available: boolean;
                            }[];
                            linear: {
                                path: string;
                                available: boolean;
                            } | null;
                            model: {
                                path: string;
                                available: boolean;
                            } | null;
                        };
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_triggers_triggerId_invocation_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Configured destination triggers in the same project */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sourceTriggerId: string;
                        destinationTriggerIds: string[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_triggers_triggerId_invocation_permissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    destinationTriggerIds: string[];
                };
            };
        };
        responses: {
            /** @description Saved manual invocation permissions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sourceTriggerId: string;
                        destinationTriggerIds: string[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_triggers_triggerId_events: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Activity */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>[];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_triggers_triggerId_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Enabled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_triggers_triggerId_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disabled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_triggers_triggerId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Trigger */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        enabled: boolean;
                        requiresVm: boolean;
                        /** @enum {string} */
                        executionType?: "agent" | "code";
                        prompt: string;
                        script?: string;
                        runNameTemplate: string;
                        tags?: string[];
                        model: string;
                        effort?: string;
                        executionConfig: {
                            connectionId: string;
                            requiresVm?: boolean;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                            image?: string;
                            region?: string;
                            size?: string;
                            /** @enum {string} */
                            executionType?: "agent" | "code";
                            script?: string;
                        };
                        runScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        portableIntegrationIds?: string[];
                        /** Format: uuid */
                        modelAccountId?: string;
                        githubInstallationIds?: number[];
                        linearConnectionId?: "linear" | null;
                        xConnectionIds?: string[];
                        skillId?: string | null;
                        executionConfigId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        events: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "linear";
                                projectId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "clickup";
                                listId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "github";
                                installationId: number;
                                repositoryId: number;
                                event?: string;
                                action?: string;
                                matchRules?: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "cloudflareTail";
                                integrationId: string;
                                destination?: string;
                                secretConfigured?: boolean;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerLifecycle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerIdle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        })[];
                        skill?: {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            revision: number;
                        } | null;
                        contextReviewRequired?: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    put_api_v1_triggers_triggerId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @enum {string} */
                    executionType?: "agent" | "code";
                    requiresVm?: boolean;
                    /** @default  */
                    prompt?: string;
                    script?: string;
                    runNameTemplate?: string;
                    concurrencyLimit?: number;
                    /** @description Factorize API scopes for new trigger runs. Omission uses existing scopes on update or read/invoke defaults on create; an empty array grants no application scopes. triggers:write permits configuring triggers and their future run scopes. */
                    runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                    executionConfigId?: string;
                    tags?: string[];
                    vmImage?: string;
                    model?: string;
                    /** @enum {string} */
                    effort?: "" | "minimal" | "low" | "medium" | "high" | "xhigh";
                    /** @default [] */
                    events?: ({
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "manual";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        /** @default {} */
                        config?: Record<string, never>;
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "schedule";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            cron: string;
                            timezone: string;
                        };
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "webhook";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "linear";
                            projectId: string;
                            matchRules: {
                                /** @enum {string} */
                                type: "owner" | "creator" | "status" | "label" | "assignee";
                                targetId: string;
                            }[];
                        } | {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "clickup";
                            listId: string;
                            matchRules: {
                                /** @enum {string} */
                                type: "owner" | "creator" | "status" | "label" | "assignee";
                                targetId: string;
                            }[];
                        } | {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "github";
                            installationId: number;
                            repositoryId: number;
                            event?: string;
                            action?: string;
                            matchRules?: {
                                /** @enum {string} */
                                type: "owner" | "creator" | "status" | "label" | "assignee";
                                targetId: string;
                            }[];
                        } | {
                            conditions?: {
                                [key: string]: unknown;
                            };
                            /** @constant */
                            provider: "cloudflareTail";
                            integrationId: string;
                        };
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "triggerLifecycle";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            sourceTriggerIds: string[];
                            states: ("succeeded" | "failed" | "stopped" | "edited")[];
                        };
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "triggerIdle";
                        template?: string;
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            sourceTriggerIds: string[];
                        };
                    })[];
                    skillId?: string | null;
                    portableIntegrationIds?: string[];
                    /** Format: uuid */
                    modelAccountId?: string;
                    githubInstallationIds?: number[];
                    linearConnectionId?: "linear" | null;
                    xConnectionIds?: string[];
                    /** Format: date-time */
                    expectedUpdatedAt?: string;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        enabled: boolean;
                        requiresVm: boolean;
                        /** @enum {string} */
                        executionType?: "agent" | "code";
                        prompt: string;
                        script?: string;
                        runNameTemplate: string;
                        tags?: string[];
                        model: string;
                        effort?: string;
                        executionConfig: {
                            connectionId: string;
                            requiresVm?: boolean;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                            image?: string;
                            region?: string;
                            size?: string;
                            /** @enum {string} */
                            executionType?: "agent" | "code";
                            script?: string;
                        };
                        runScopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                        portableIntegrationIds?: string[];
                        /** Format: uuid */
                        modelAccountId?: string;
                        githubInstallationIds?: number[];
                        linearConnectionId?: "linear" | null;
                        xConnectionIds?: string[];
                        skillId?: string | null;
                        executionConfigId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        events: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "linear";
                                projectId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "clickup";
                                listId: string;
                                matchRules: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "github";
                                installationId: number;
                                repositoryId: number;
                                event?: string;
                                action?: string;
                                matchRules?: {
                                    /** @enum {string} */
                                    type: "owner" | "creator" | "status" | "label" | "assignee";
                                    targetId: string;
                                }[];
                                secretConfigured?: boolean;
                            } | {
                                conditions?: {
                                    [key: string]: unknown;
                                };
                                /** @constant */
                                provider: "cloudflareTail";
                                integrationId: string;
                                destination?: string;
                                secretConfigured?: boolean;
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerLifecycle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "triggerIdle";
                            template?: string;
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceTriggerIds: string[];
                            };
                            /** Format: uuid */
                            triggerId: string;
                            createdAt: string;
                            updatedAt: string;
                        })[];
                        skill?: {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            revision: number;
                        } | null;
                        contextReviewRequired?: boolean;
                        createdAt: string;
                        updatedAt: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            /** @description stale_trigger: reload and reconcile before retrying */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_triggers_triggerId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                triggerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs: {
        parameters: {
            query?: {
                triggerId?: string | string[];
                state?: ("queued" | "reserved" | "starting" | "running" | "done" | "blocked" | "failed" | "ignored" | "succeeded" | "stopping" | "stopped") | ("queued" | "reserved" | "starting" | "running" | "done" | "blocked" | "failed" | "ignored" | "succeeded" | "stopping" | "stopped")[];
                skillId?: string | "none";
                contextQuery?: string;
                sort?: "source" | "run" | "status" | "created" | "agent";
                direction?: "asc" | "desc";
                limit?: number;
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated runs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunPage"];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    attachments?: {
                        /** Format: uuid */
                        artifactId: string;
                    }[];
                    requiresVm?: boolean;
                    prompt?: string;
                    script?: string;
                    skill?: string;
                    name?: string;
                    executionConfigId?: string;
                    /** Format: uuid */
                    modelAccountId?: string;
                    vmImage?: string;
                    model?: string;
                    /** @description Factorize application permissions to grant. Omission inherits effective client permissions and an empty list grants none. */
                    runScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "runs:read" | "runs:invoke" | "runs:start" | "runs:cancel" | "runs:write" | "integrations:read" | "integrations:write" | "skills:read" | "skills:write")[];
                    integrationIds?: string[];
                    inputs?: {
                        [key: string]: unknown;
                    };
                    idempotencyKey?: string;
                };
            };
        };
        responses: {
            /** @description Accepted run */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        runId: string;
                        /** Format: uri */
                        url: string;
                        outcomeUri: string;
                        duplicate: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_search: {
        parameters: {
            query?: {
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Search results */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** @enum {string} */
                            kind: "trigger" | "run" | "trace";
                            id: string;
                            title: string;
                            subtitle: string;
                            url: string;
                            source: {
                                /** @enum {string} */
                                kind: "trigger" | "run" | "trace";
                                label: string;
                                id: string;
                            };
                            match: {
                                text: string;
                                ranges: {
                                    start: number;
                                    end: number;
                                }[];
                            };
                        }[];
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_webhooks_deliveries: {
        parameters: {
            query?: {
                provider?: string;
                deliveryId?: string;
                event?: string;
                action?: string;
                outcome?: string;
                triggerId?: string;
                q?: string;
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cursor-paginated safe delivery records */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_webhooks_deliveries_deliveryId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deliveryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Safe delivery detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_status: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        trigger_id: string | null;
                        launch_skill_id?: string | null;
                        launch_skill_key?: string | null;
                        launch_skill_revision?: number | null;
                        /** @enum {string} */
                        state: "queued" | "reserved" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped";
                        /**
                         * @default agent
                         * @enum {string}
                         */
                        execution_type: "agent" | "code";
                        run_name: string;
                        trigger_name: string | null;
                        destination_url: string | null;
                        created_at: string;
                        updated_at: string;
                        started_at: string | null;
                        /** @enum {string} */
                        artifact_state: "pending" | "collecting" | "stored" | "partial" | "failed";
                        finalizing: boolean;
                        trace_revision: string;
                        failure_source: ("system" | "agent") | null;
                        failure?: {
                            /** @enum {string} */
                            source: "run" | "system";
                            code: string;
                            reason: string;
                        } | null;
                        agent_error: {
                            reason: string;
                            reported_at: string;
                            reporter: {
                                user_id: string;
                                /** @enum {string} */
                                kind: "api_key" | "oauth" | "session" | "run_token";
                                id: string;
                            };
                        } | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_artifacts_artifactId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized artifact bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_trace_pages: {
        parameters: {
            query?: {
                after?: number;
                before?: number;
                recent?: boolean;
                limit?: number;
                revision?: string;
            };
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revision-bound page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            sequence: number;
                            id: string;
                            parentId?: string;
                            /** @enum {string} */
                            type: "user_message" | "assistant_message" | "reasoning" | "tool_call" | "tool_result" | "command" | "file_change" | "compaction" | "branch" | "usage" | "warning" | "error" | "metadata";
                            role?: string;
                            title: string;
                            preview: string;
                            occurredAt?: string;
                            display: {
                                [key: string]: unknown;
                            };
                        }[];
                        nextCursor: number | null;
                        previousCursor?: number | null;
                        revision: string;
                        reset: boolean;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run including durable execution diagnostics and harness artifact location */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunDetail"];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    patch_api_v1_runs_runId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    expectedName?: string;
                };
            };
        };
        responses: {
            /** @description Saved run display name */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        run_name: string;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            /** @description Run not found within the tenant */
            404: components["responses"]["Error404"];
            /** @description stale_run_name: reload before retrying */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runs_runId_report_error: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Report saved or identical retry acknowledged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        reported: true;
                        reason: string;
                        retry: boolean;
                    };
                };
            };
            /** @description Invalid reason or request body */
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            /** @description Missing runs:write authorization */
            403: components["responses"]["Error403"];
            /** @description Run not found within the tenant */
            404: components["responses"]["Error404"];
            /** @description Run is terminal or a different reason was already reported */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_trace: {
        parameters: {
            query?: {
                after?: number;
                limit?: number;
            };
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Trace page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: Record<string, never>[];
                        nextCursor: number | null;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runs_runId_trace_replay: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TraceReplayRequest"];
            };
        };
        responses: {
            /** @description Durable replay result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TraceReplayResult"];
                };
            };
            /** @description Invalid request */
            400: components["responses"]["Error400"];
            /** @description Invalid owner session */
            401: components["responses"]["Error401"];
            /** @description Missing runs:cancel scope or interactive owner session */
            403: components["responses"]["Error403"];
            /** @description Run not found within the tenant */
            404: components["responses"]["Error404"];
            /** @description Request ID conflict or artifact ownership/checksum mismatch */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            /** @description Tenant rate limit reached; wait one minute before retrying */
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            /** @description Artifact storage unavailable */
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_runs_runId_diagnostics: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Credential-safe execution metadata and durable harness artifact location */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunDiagnostics"];
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runs_runId_stop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stopped */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runs_runId_retry_launch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Manual retry queued */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        runId: string;
                        /** @constant */
                        retryRequested: true;
                    };
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            /** @description Interactive owner session required */
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            /** @description Run is not waiting for a manual launch retry */
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_runs_runId_kill: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Killed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            400: components["responses"]["Error400"];
            401: components["responses"]["Error401"];
            403: components["responses"]["Error403"];
            404: components["responses"]["Error404"];
            409: components["responses"]["Error409"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
}
