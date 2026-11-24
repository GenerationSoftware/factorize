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
         * @description Requires an interactive owner session. Immediately clears the encrypted credential and revokes the connection. A secret-free tombstone prevents revoked access from being revived if an identifier is reused.
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
         * @description Requires an interactive owner session. Replaces the encrypted client credentials, invalidates saved access and refresh tokens and pending OAuth attempts, preserves the existing account identity binding, and requires reauthorization. Reauthorization cannot switch the connection to a different X account; create a new connection for another account. Client access remains unavailable until authorization succeeds.
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
    "/api/v1/auth/google": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check whether Google sign-in is configured
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        get: operations["get_api_v1_auth_google"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start browser-bound Google sign-in
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_google_start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read Google signup or linking steps for the current browser
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        get: operations["get_api_v1_auth_google_pending"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/email/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send a verification link for a new Google signup
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_google_email_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/email/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify the signup email in the initiating browser
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_google_email_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/username": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check username availability during Google signup
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_google_username"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/password/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set the Factorize password with fresh Google proof and email confirmation
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_google_password_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/finish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Choose a username or confirm your existing Factorize password
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_google_finish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password/set-request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start fresh Google verification before setting or recovering a password
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_password_set_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/two-factor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read your two-factor settings
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        get: operations["get_api_v1_auth_two_factor"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/two-factor/google": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm a linked Google account for a two-factor settings change
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_two_factor_google"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/two-factor/enrollment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a short-lived authenticator setup secret
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_two_factor_enrollment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/two-factor/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enable two-factor authentication and show recovery codes once
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_two_factor_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/two-factor/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable two-factor authentication using primary and second factors
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_two_factor_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/two-factor/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Finish a browser sign-in using a fresh authenticator or recovery code
         * @description Cookie-only browser operation. Mutations require an exact app Origin and reject cross-site requests. Authorization headers are rejected. Responses are never cached.
         */
        post: operations["post_api_v1_auth_two_factor_challenge"];
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_integrations_cloudflare_tail"];
        put?: never;
        /**
         * Create a Tail integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_integrations_exe"];
        post?: never;
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_integrations_amp"];
        post?: never;
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
    "/api/v1/access/authorizations/{grantId}/name": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Rename an authorized OAuth connection
         * @description Interactive owner session required. Changes only this connection’s display name, not the registered app name or permissions.
         *
         *     Requires the triggers:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_access_authorizations_grantId_name"];
        post?: never;
        delete?: never;
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
         * Set an OAuth connection’s effective scopes and integration access
         * @description Interactive owner session required. Removing permissions takes effect immediately. A scope not carried by the current token requires a fresh OAuth authorization and token.
         *
         *     Requires the triggers:write scope.
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
    "/api/v1/vms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List VMs with active Factorize permission grants
         * @description Requires the vms:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_vms"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vms/grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Grant or replace Factorize permissions for an existing VM
         * @description Supply a preset ID or an explicit scope list. Factorize saves the resolved scope snapshot and rejects the entire request if any scope exceeds the caller's effective access. Use one requestKey per initial enrollment and reuse it for a retry. Supply the current revision when editing an existing grant.
         *
         *     Requires the vms:edit scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_vms_grants"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/vms/grants/{grantId}": {
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
         * Revoke a VM's Factorize permission grant
         * @description Factorize immediately denies access under this grant. The VM keeps running. Retrying the same revocation is safe.
         *
         *     Requires the vms:edit scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        delete: operations["delete_api_v1_vms_grants_grantId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/permission-presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List team permission presets
         * @description Requires the team:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_permission_presets"];
        put?: never;
        /**
         * Create a team permission preset
         * @description Requires the team:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_permission_presets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/permission-presets/{presetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Update a team permission preset
         * @description Requires the team:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        put: operations["put_api_v1_permission_presets_presetId"];
        post?: never;
        /**
         * Delete a team permission preset
         * @description Requires the team:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_permission_presets_presetId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/permission-presets/{presetId}/default": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set the team default permission preset
         * @description Requires the team:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_permission_presets_presetId_default"];
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_integrations_cloudflare_tail_integrationId"];
        post?: never;
        /**
         * Remove a Tail integration
         * @description Requires the integrations:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        delete: operations["delete_api_v1_providers_github_installations_installationId"];
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
         * Get the current team
         * @description Requires the team:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Events
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_events"];
        put?: never;
        /**
         * Create an Event
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_events"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an Event
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_events_eventId"];
        /**
         * Update an Event payload schema
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_events_eventId"];
        post?: never;
        /**
         * Delete an Event and its Triggers and occurrences
         * @description Permanently deletes the Event, all attached Triggers, their input configurations, and the Event's occurrence history.
         *
         *     Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        delete: operations["delete_api_v1_events_eventId"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/occurrences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List durable Event occurrences
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_events_eventId_occurrences"];
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_triggers"];
        put?: never;
        /**
         * Create trigger
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_triggers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/triggers/{triggerId}/fire": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Fire a Trigger and create an Event occurrence
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_triggers_triggerId_fire"];
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_trigger_conditions_test"];
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
         * @description OAuth authorization required. Availability reports connection state, without probing credential health. OAuth integration scopes are integration:{stable UUID}:{revocation epoch}; initial login need not request any integration scopes.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description OAuth requires proxy:use. An enrolled VM sends its short-lived provider OIDC bearer token, X-Factorize-VM-Grant, and a fresh signed request proof in X-Factorize-VM-Proof. Only server-selected origins are used. Integration-wide grants are bounded by upstream credential permissions. Missing requestable access returns HTTP 403 with WWW-Authenticate insufficient_scope, scope and resource_metadata. Upstream status is returned in the result, including non-2xx. Text is UTF-8; other bodies are base64. Responses above 32 KiB are retained for 30 minutes and read in chunks. Revocation prevents subsequent calls and reads, but cannot undo upstream side effects.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_agent_requests"];
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
         * Reserve a temporary connection-bound request body
         * @description Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts a scoped bearer token or interactive owner session.
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
         * @description An authenticated owner browser can upload for its originating OAuth connection. Immutable finalized bytes; fixed 32 MiB limit. The originating OAuth connection is required.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Accepts the same OAuth authentication as the request endpoint. Rechecks authorization, integration revocation epoch, tenant, identity and 30-minute expiry. Chunks are always base64 so arbitrary byte offsets are safe.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Baseline changes apply immediately. Disabling invalidates approvals permanently; re-enabling requires fresh consent. Connected-client access remains independent.
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
    "/api/v1/triggers/{triggerId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List webhook activity
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_triggers_triggerId"];
        /**
         * Replace trigger
         * @description Supply expectedUpdatedAt from GET for atomic optimistic concurrency. Stale edits return 409 stale_trigger. Omission uses last-writer-wins updates. Retain each source ID to preserve its identity when its kind stays the same.
         *
         *     Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_triggers_triggerId"];
        post?: never;
        /**
         * Delete trigger
         * @description Requires the triggers:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        delete: operations["delete_api_v1_triggers_triggerId"];
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
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires the triggers:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
    "/api/v1/app-consent/{requestId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Preview a registered app sign-in request
         * @description Requires the team:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_app_consent_requestId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/app-consent/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Allow or deny a registered app sign-in request
         * @description Requires the team:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_app_consent_decision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/apps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the team's app registrations
         * @description Requires the apps:manage scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_apps"];
        put?: never;
        /**
         * Register a server-side application
         * @description Requires the apps:manage scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_apps"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/apps/{appId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an app registration
         * @description Requires the apps:manage scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_apps_appId"];
        /**
         * Change an app registration, its visibility, or its enabled state
         * @description Requires the apps:manage scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_apps_appId"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/apps/{appId}/secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Issue or rotate a client secret in a browser session
         * @description Requires the apps:manage scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        post: operations["post_api_v1_apps_appId_secret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/app-connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List sign-in apps authorized by the current user
         * @description Requires the team:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_app_connections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/app-connections/{connectionId}": {
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
         * Revoke one sign-in app connection
         * @description Requires the team:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_app_connections_connectionId"];
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
        TriggerInput: {
            name: string;
            /** Format: uuid */
            eventId: string;
            /**
             * @default [
             *       {
             *         "kind": "manual",
             *         "slug": "source-1",
             *         "enabled": true,
             *         "config": {}
             *       }
             *     ]
             */
            sources: ({
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
            })[];
        };
        FireTriggerInput: {
            /** @default {} */
            data: {
                [key: string]: unknown;
            };
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
                        capabilities: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "integrations:read" | "integrations:write" | "vms:read" | "vms:edit" | "apps:manage")[];
                        /** Format: date-time */
                        expiresAt: string;
                        googleManagedRecovery?: boolean;
                        hasPassword?: boolean;
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
    get_api_v1_auth_google: {
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
                        enabled: boolean;
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
    post_api_v1_auth_google_start: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
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
    get_api_v1_auth_google_pending: {
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
                        /** Format: email */
                        email: string;
                        /** @enum {string} */
                        mode: "link" | "signup" | "verify-email" | "set-password";
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
    post_api_v1_auth_google_email_request: {
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
    post_api_v1_auth_google_email_verify: {
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
    post_api_v1_auth_google_username: {
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
                        available: boolean;
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
    post_api_v1_auth_google_password_complete: {
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
    post_api_v1_auth_google_finish: {
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
                } | {
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
    post_api_v1_auth_password_set_request: {
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
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_auth_two_factor: {
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
                        enabled: boolean;
                        available: boolean;
                        /** @enum {string} */
                        method: "password" | "google" | "unavailable";
                        googleVerified: boolean;
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
    post_api_v1_auth_two_factor_google: {
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
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    post_api_v1_auth_two_factor_enrollment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    password?: string;
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
                        secret: string;
                        uri: string;
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
    post_api_v1_auth_two_factor_enable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
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
                        recoveryCodes: string[];
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
    post_api_v1_auth_two_factor_disable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    password?: string;
                    code: string;
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
    post_api_v1_auth_two_factor_challenge: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
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
                        selectedScopes: string[];
                        unavailableSavedScopes: string[];
                        reconnect: boolean;
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
                        } | null;
                        exeConnections: {
                            connectionId: string;
                            /** @constant */
                            credentialStatus: "connected";
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
                        availableScopes: string[];
                        /** @default {} */
                        scopeLabels: {
                            [key: string]: string;
                        };
                        /** @default {} */
                        integrationOverrides: {
                            [key: string]: string | false;
                        };
                        revision: number;
                        grantId: string;
                        clientId: string;
                        clientName: string;
                        appName?: string;
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
                        scopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "integrations:read" | "integrations:write" | "vms:read" | "vms:edit")[];
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
                    scopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "integrations:read" | "integrations:write" | "vms:read" | "vms:edit")[];
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
                        scopes: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "integrations:read" | "integrations:write" | "vms:read" | "vms:edit")[];
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
    put_api_v1_access_authorizations_grantId_name: {
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
                    name: string;
                };
            };
        };
        responses: {
            /** @description Connection renamed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        name: string;
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
                    /** @description Complete owner-selected effective scope set for this connection. */
                    scopes?: string[];
                    disabledScopes?: ("team:read" | "team:write" | "triggers:read" | "triggers:write" | "integrations:read" | "integrations:write" | "vms:read" | "vms:edit" | "proxy:use" | "apps:manage")[];
                    /** @description Integration ID to approved epoch-bound scope, or false to block. Explicit approval is required to re-enable a blocked integration, including when scopes are supplied. */
                    integrationOverrides?: {
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
    get_api_v1_vms: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Active team VM grants */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** Format: uuid */
                        providerId: string;
                        /** @enum {string} */
                        provider: "exe.dev" | "fly.io";
                        vm: string;
                        app: string | null;
                        scopes: string[];
                        presetId: string | null;
                        presetName: string | null;
                        revision: number;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
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
    post_api_v1_vms_grants: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    target: {
                        /** @constant */
                        kind: "machine";
                        /** Format: uuid */
                        providerId: string;
                        vm: string;
                        app?: string;
                        requestKey: string;
                    } | {
                        /** @constant */
                        kind: "existing";
                        /** Format: uuid */
                        grantId: string;
                        expectedRevision: number;
                    };
                    permissions: {
                        /** Format: uuid */
                        presetId: string;
                    } | {
                        scopes: string[];
                    };
                };
            };
        };
        responses: {
            /** @description VM grant and guest authentication metadata */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** Format: uuid */
                        providerId: string;
                        /** @enum {string} */
                        provider: "exe.dev" | "fly.io";
                        vm: string;
                        app: string | null;
                        scopes: string[];
                        presetId: string | null;
                        presetName: string | null;
                        revision: number;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        updatedAt: string;
                        authentication: {
                            audience: string;
                            guestKeyPath: string;
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
    delete_api_v1_vms_grants_grantId: {
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
            /** @description VM grant revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** @constant */
                        revoked: true;
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
    get_api_v1_permission_presets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Permission presets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        scopes: string[];
                        isDefault: boolean;
                        revision: number;
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
    post_api_v1_permission_presets: {
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
                    scopes: string[];
                    expectedRevision?: number;
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
                        name: string;
                        scopes: string[];
                        isDefault: boolean;
                        revision: number;
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
    put_api_v1_permission_presets_presetId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                presetId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    scopes: string[];
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
                        name: string;
                        scopes: string[];
                        isDefault: boolean;
                        revision: number;
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
    delete_api_v1_permission_presets_presetId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                presetId: string;
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
    post_api_v1_permission_presets_presetId_default: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                presetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Default updated */
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
    get_api_v1_events: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Events and current revisions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        description: string;
                        revision: number;
                        payloadSchema: {
                            [key: string]: unknown;
                        };
                        createdAt: string;
                        updatedAt: string;
                        triggerCount: number;
                        occurrenceCount: number;
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
    post_api_v1_events: {
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
                    /** @default  */
                    description?: string;
                    /**
                     * @default {
                     *       "type": "object"
                     *     }
                     */
                    payloadSchema?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Created Event */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        description: string;
                        revision: number;
                        payloadSchema: {
                            [key: string]: unknown;
                        };
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
    get_api_v1_events_eventId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Event */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        description: string;
                        revision: number;
                        payloadSchema: {
                            [key: string]: unknown;
                        };
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
    put_api_v1_events_eventId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @default  */
                    description?: string;
                    /**
                     * @default {
                     *       "type": "object"
                     *     }
                     */
                    payloadSchema?: {
                        [key: string]: unknown;
                    };
                    expectedRevision: number;
                };
            };
        };
        responses: {
            /** @description Updated Event */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        description: string;
                        revision: number;
                        payloadSchema: {
                            [key: string]: unknown;
                        };
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
    delete_api_v1_events_eventId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
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
    get_api_v1_events_eventId_occurrences: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
            };
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Occurrences */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            revision: number;
                            occurredAt: string;
                            payload: {
                                [key: string]: unknown;
                            };
                            producer: {
                                [key: string]: unknown;
                            };
                            createdAt: string;
                        }[];
                        nextCursor?: string;
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
                        description: string;
                        enabled: boolean;
                        /** Format: uuid */
                        eventId: string;
                        sources: ({
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
                        })[];
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
                        description: string;
                        enabled: boolean;
                        /** Format: uuid */
                        eventId: string;
                        sources: ({
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
                        })[];
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
    post_api_v1_triggers_triggerId_fire: {
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
                "application/json": components["schemas"]["FireTriggerInput"];
            };
        };
        responses: {
            /** @description Event occurrence receipt */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        occurrenceId: string | null;
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
                        identity: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "oauth" | "vm";
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
                        description: string;
                        enabled: boolean;
                        /** Format: uuid */
                        eventId: string;
                        sources: ({
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
                        })[];
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
                    /** Format: uuid */
                    eventId: string;
                    /**
                     * @default [
                     *       {
                     *         "kind": "manual",
                     *         "slug": "source-1",
                     *         "enabled": true,
                     *         "config": {}
                     *       }
                     *     ]
                     */
                    sources?: ({
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
                    })[];
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
                        description: string;
                        enabled: boolean;
                        /** Format: uuid */
                        eventId: string;
                        sources: ({
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
                        })[];
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
    get_api_v1_app_consent_requestId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                requestId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Requested app permissions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        appName: string;
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
    post_api_v1_app_consent_decision: {
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
                    requestId: string;
                    /** @enum {string} */
                    decision: "allow" | "deny";
                };
            };
        };
        responses: {
            /** @description Registered redirect destination */
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
    get_api_v1_apps: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Registered apps */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        redirectUris: string[];
                        public: boolean;
                        enabled: boolean;
                        secretConfigured: boolean;
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
    post_api_v1_apps: {
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
                    redirectUris: string[];
                    /** @default false */
                    public?: boolean;
                };
            };
        };
        responses: {
            /** @description Registered app */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        redirectUris: string[];
                        public: boolean;
                        enabled: boolean;
                        secretConfigured: boolean;
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
    get_api_v1_apps_appId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Registered app */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        redirectUris: string[];
                        public: boolean;
                        enabled: boolean;
                        secretConfigured: boolean;
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
    put_api_v1_apps_appId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    redirectUris: string[];
                    /** @default false */
                    public?: boolean;
                    enabled: boolean;
                };
            };
        };
        responses: {
            /** @description Registered app */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        redirectUris: string[];
                        public: boolean;
                        enabled: boolean;
                        secretConfigured: boolean;
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
    post_api_v1_apps_appId_secret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                appId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One-time secret */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        clientId: string;
                        clientSecret: string;
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
    get_api_v1_app_connections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Connected apps */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        /** Format: uuid */
                        appId: string;
                        name: string;
                        scopes: string[];
                        /** Format: date-time */
                        authorizedAt: string;
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
    delete_api_v1_app_connections_connectionId: {
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
            /** @description Connection revoked */
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
}
