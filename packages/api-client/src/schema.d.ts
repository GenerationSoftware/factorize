// Generated from packages/docs/openapi.yaml. Do not edit.
export interface paths {
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
    "/api/v1/trigger-contexts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get template autocomplete metadata
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_trigger_contexts"];
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
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:read scope.
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
    "/api/v1/execution-targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List execution targets
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_execution_targets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/job-trigger-availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available trigger kinds
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_job_trigger_availability"];
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
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_integrations_cloudflare_tail"];
        put?: never;
        /**
         * Create a Tail integration
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires the flows:read scope.
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
         * List Linear trigger options
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:read scope.
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
         * List ClickUp trigger options
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:read scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        get: operations["get_api_v1_access_tokens"];
        put?: never;
        /**
         * Create an access token
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
         *
         *     An interactive owner session is required; bearer tokens cannot call this operation.
         */
        delete: operations["delete_api_v1_access_tokens_tokenId"];
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
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_integrations_cloudflare_tail_integrationId"];
        post?: never;
        /**
         * Remove a Tail integration
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:write scope.
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
         * @description Requires the flows:read scope.
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
         * List GitHub issue trigger options
         * @description Requires the flows:read scope.
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
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_integrations_exe_connectionId_diagnostics"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/job-summaries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List bounded job summaries
         * @description Additive list representation, ordered by immutable UUID descending. Cursor is the last ID; filters must remain the same between pages. Literal case-insensitive name/slug search. No prompts or trigger configuration; statistics are batched. Existing GET /jobs remains an array.
         *
         *     Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_job_summaries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/job-selector": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search bounded lifecycle job options
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_job_selector"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List jobs
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_jobs"];
        put?: never;
        /**
         * Create job
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_jobs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/job-conditions/test": {
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
         * @description Evaluates supplied prepared webhook context only; does not authenticate the example, route events, verify GitHub state, or invoke jobs.
         *
         *     Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_job_conditions_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jobId}/invocations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Invoke job
         * @description Requires the runs:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_jobs_jobId_invocations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jobId}/events": {
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_jobs_jobId_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jobId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enable job
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_jobs_jobId_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jobId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Disable job
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_jobs_jobId_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get job
         * @description Requires the flows:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_jobs_jobId"];
        /**
         * Replace job
         * @description Supply expectedUpdatedAt from GET for atomic optimistic concurrency. Stale edits return 409 stale_job. Omission preserves legacy REST/MCP last-writer-wins updates. Trigger identity is preserved.
         *
         *     Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        put: operations["put_api_v1_jobs_jobId"];
        post?: never;
        /**
         * Delete job
         * @description Requires the flows:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        delete: operations["delete_api_v1_jobs_jobId"];
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
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_runs"];
        put?: never;
        post?: never;
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
         * Search jobs and runs
         * @description Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires the runs:read scope.
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
    "/api/v1/runs/{runId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get lightweight run status
         * @description No prompt decryption, invocation context, artifacts, activity or diagnostics assembly. Continue polling terminal runs while finalizing is true. trace_revision changes on generation transition or canonical projection/replay; live appends retain the revision. Full detail remains available at GET /runs/{runId}.
         *
         *     Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
    "/api/v1/runs/{runId}/trace-pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get revision-bound trace page
         * @description First request omits revision and uses after=0. Subsequent requests supply the returned revision. A changed generation or canonical projection returns reset=true and events from zero in the new revision, from one database snapshot. Discard all cached old pages before merging the response. nextCursor=null means caught up, not finalized; poll after the last sequence while active/finalizing. Legacy GET /trace remains unchanged.
         *
         *     Requires the runs:read scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
         *     Accepts a scoped bearer token or interactive owner session.
         */
        get: operations["get_api_v1_runs_runId"];
        put?: never;
        post?: never;
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires runs:write and an interactive tenant owner session. One terminal run per request, limited to 10 attempts per tenant per minute including retries and failures. Projection and result commit atomically; no artifacts are deleted. Retry failed requests with the same requestId. Conflicting reuse is rejected. Missing bytes cannot be recovered. Does not change the source declaration of an active or future run.
         *
         *     Requires the runs:write scope.
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
         *     Accepts a scoped bearer token or interactive owner session.
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
         * @description Requires the runs:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
         */
        post: operations["post_api_v1_runs_runId_stop"];
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
         * @description Requires the runs:write scope.
         *
         *     Accepts a scoped bearer token or interactive owner session.
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
            id: string;
            job_id: string;
            issue_id: string;
            issue_url: string | null;
            issue_title: string;
            run_name: string;
            agent_name: string;
            workspace_name: string;
            agent_kind: string;
            /** @enum {string} */
            state: "queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored";
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
        } & {
            [key: string]: unknown;
        };
        RunPage: {
            items: {
                id: string;
                job_id: string;
                issue_id: string;
                issue_url: string | null;
                issue_title: string;
                run_name: string;
                agent_name: string;
                workspace_name: string;
                agent_kind: string;
                /** @enum {string} */
                state: "queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored";
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
            /** @description Agent trace provider; the outer diagnostics provider remains the trigger provider. */
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
            id: string;
            state: string;
            /** @description Live file generation; clients reset trace pagination when it changes. */
            trace_generation?: string | null;
            trace_projection?: components["schemas"]["TraceProjection"];
            trace_sources?: components["schemas"]["TraceSources"];
            execution_diagnostics: components["schemas"]["ExecutionDiagnostics"];
            harness_log: components["schemas"]["HarnessLog"];
            /** @description Secondary artifact or cleanup error; does not replace execution_diagnostics */
            artifact_error?: string | null;
            /** @description Current job name, included so run content does not require a separate job request. */
            job_name: string;
            prompt: string;
            context: {
                [key: string]: unknown;
            };
            invocation: {
                id: string;
                source: string;
                claim_key: string;
                trigger_id: string | null;
                context: {
                    [key: string]: unknown;
                };
                occurrence: {
                    [key: string]: unknown;
                } | null;
                created_at: string;
            };
            activity: {
                action: string;
                detail: string;
                created_at: string;
            }[];
            tenant_id?: string;
            invocation_id?: string;
            execution_handle?: {
                backendKind: string;
                id: string;
            } | null;
            execution_backend_kind?: string;
            execution_capabilities?: string[];
            claim_released?: boolean;
            vm_cleanup_attempt?: number;
            vm_cleanup_complete?: boolean;
            /** Format: date-time */
            cleanup_next_at?: string | null;
            occurrence?: {
                [key: string]: unknown;
            } | null;
            invocation_source?: string;
            invocation_claim_key?: string;
            invocation_trigger_id?: string | null;
            /** Format: date-time */
            invocation_created_at?: string;
        } & WithRequired<components["schemas"]["Run"], "id" | "state">;
        RunDiagnostics: {
            runId: string;
            jobId: string;
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
        JobInput: {
            name: string;
            slug: string;
            promptTemplate: string;
            runNameTemplate?: string;
            /** @default 1 */
            concurrencyLimit: number;
            executionTargetId: string;
            model?: string;
            effort?: string;
            /** @default [] */
            triggers: ({
                id?: string;
                slug?: string;
                /** @constant */
                kind: "manual";
                /** @default true */
                enabled: boolean;
                /** @default {} */
                config: Record<string, never>;
            } | {
                id?: string;
                slug?: string;
                /** @constant */
                kind: "schedule";
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
                kind: "jobLifecycle";
                /** @default true */
                enabled: boolean;
                config: {
                    sourceJobIds: string[];
                    states: ("succeeded" | "failed" | "stopped" | "edited")[];
                };
            })[];
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
        JobConditionsTest: {
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
                        workspace: {
                            id: string;
                            name: string | null;
                            /** @constant */
                            role: "owner";
                        };
                        capabilities: ("flows:read" | "flows:write" | "runs:read" | "runs:write")[];
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
                    /** Format: email */
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
                    scopes: ("flows:read" | "flows:write" | "runs:read" | "runs:write")[];
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
    get_api_v1_trigger_contexts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paths by trigger kind/provider */
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
                        /** @enum {string} */
                        agentKind: "codex" | "claude" | "pi";
                        /** @default [] */
                        tags: string[];
                        /** @default [] */
                        models: string[];
                        /** @default  */
                        modelsRefreshedAt: string;
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
    get_api_v1_execution_targets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Targets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        kind: "exe-vm" | "amp";
                        name: string;
                        workspace: string;
                        cwd: string;
                        agentKind: string;
                        models?: string[];
                        modelsRefreshedAt?: string | null;
                        efforts?: string[];
                        capabilities: string[];
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
    get_api_v1_job_trigger_availability: {
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
                        jobLifecycle: true;
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
                        referencedJobCount: number;
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
                            /** @enum {string} */
                            agentKind: "codex" | "claude" | "pi";
                            /** @default [] */
                            tags: string[];
                            /** @default [] */
                            models: string[];
                            /** @default  */
                            modelsRefreshedAt: string;
                        } | null;
                        exeConnections: {
                            connectionId: string;
                            /** @enum {string} */
                            agentKind: "codex" | "claude" | "pi";
                            /** @default [] */
                            tags: string[];
                            /** @default [] */
                            models: string[];
                            /** @default  */
                            modelsRefreshedAt: string;
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
                                referencedJobCount: number;
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
                    apiToken: string;
                    /** @enum {string} */
                    agentKind: "codex" | "claude" | "pi";
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
                        models: string[];
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
                    /** @enum {string} */
                    agentKind?: "codex" | "claude" | "pi";
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
                    accessToken: string;
                    project: string;
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
                        scopes: ("flows:read" | "flows:write" | "runs:read" | "runs:write")[];
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
                    scopes: ("flows:read" | "flows:write" | "runs:read" | "runs:write")[];
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
                        scopes: ("flows:read" | "flows:write" | "runs:read" | "runs:write")[];
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
    get_api_v1_job_summaries: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                q?: string;
                enabled?: "true" | "false";
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
                            slug: string;
                            enabled: boolean;
                            model: string;
                            effort: string;
                            agentKind: string;
                            concurrencyLimit: number;
                            runningCount: number;
                            lastRunState: ("queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
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
    get_api_v1_job_selector: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                q?: string;
                enabled?: "true" | "false";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Selector page; same ordering/filter semantics as job-summaries */
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
                            slug: string;
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
    get_api_v1_jobs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Jobs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        slug: string;
                        enabled: boolean;
                        promptTemplate: string;
                        runNameTemplate: string;
                        model: string;
                        effort?: string;
                        executionTarget: {
                            connectionId: string;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                        };
                        executionTargetId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        triggers: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
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
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "jobLifecycle";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceJobIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            jobId: string;
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
    post_api_v1_jobs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JobInput"];
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
                        slug: string;
                        enabled: boolean;
                        promptTemplate: string;
                        runNameTemplate: string;
                        model: string;
                        effort?: string;
                        executionTarget: {
                            connectionId: string;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                        };
                        executionTargetId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        triggers: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
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
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "jobLifecycle";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceJobIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            jobId: string;
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
    post_api_v1_job_conditions_test: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JobConditionsTest"];
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
    post_api_v1_jobs_jobId_invocations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
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
            /** @description queue_full — this job already has one queued run. Retry after it starts. Duplicate idempotency keys return the original run. */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    get_api_v1_jobs_jobId_events: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path: {
                jobId: string;
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
    post_api_v1_jobs_jobId_enable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
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
    post_api_v1_jobs_jobId_disable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
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
    get_api_v1_jobs_jobId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Job */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        id: string;
                        name: string;
                        slug: string;
                        enabled: boolean;
                        promptTemplate: string;
                        runNameTemplate: string;
                        model: string;
                        effort?: string;
                        executionTarget: {
                            connectionId: string;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                        };
                        executionTargetId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        triggers: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
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
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "jobLifecycle";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceJobIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            jobId: string;
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
    put_api_v1_jobs_jobId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    slug: string;
                    promptTemplate: string;
                    runNameTemplate?: string;
                    /** @default 1 */
                    concurrencyLimit?: number;
                    executionTargetId: string;
                    model?: string;
                    effort?: string;
                    /** @default [] */
                    triggers?: ({
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "manual";
                        /** @default true */
                        enabled?: boolean;
                        /** @default {} */
                        config?: Record<string, never>;
                    } | {
                        id?: string;
                        slug?: string;
                        /** @constant */
                        kind: "schedule";
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
                        kind: "jobLifecycle";
                        /** @default true */
                        enabled?: boolean;
                        config: {
                            sourceJobIds: string[];
                            states: ("succeeded" | "failed" | "stopped" | "edited")[];
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
                        slug: string;
                        enabled: boolean;
                        promptTemplate: string;
                        runNameTemplate: string;
                        model: string;
                        effort?: string;
                        executionTarget: {
                            connectionId: string;
                            workspace?: string;
                            cwd?: string;
                            agentKind: string;
                        };
                        executionTargetId: string;
                        agentKind: string;
                        concurrencyLimit: number;
                        runningCount: number;
                        currentRuns: number;
                        maxConcurrency: number;
                        lastRunState: ("queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped" | "done" | "ignored") | null;
                        triggers: ({
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "manual";
                            /** @default true */
                            enabled: boolean;
                            /** @default {} */
                            config: Record<string, never>;
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "schedule";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                cron: string;
                                timezone: string;
                            };
                            /** Format: uuid */
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "webhook";
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
                            jobId: string;
                            createdAt: string;
                            updatedAt: string;
                        } | {
                            /** Format: uuid */
                            id: string;
                            slug: string;
                            /** @constant */
                            kind: "jobLifecycle";
                            /** @default true */
                            enabled: boolean;
                            config: {
                                sourceJobIds: string[];
                                states: ("succeeded" | "failed" | "stopped" | "edited")[];
                            };
                            /** Format: uuid */
                            jobId: string;
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
            /** @description stale_job: reload and reconcile before retrying */
            409: components["responses"]["Error409"];
            415: components["responses"]["Error415"];
            429: components["responses"]["Error429"];
            500: components["responses"]["Error500"];
            503: components["responses"]["Error503"];
        };
    };
    delete_api_v1_jobs_jobId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
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
                jobId?: string;
                state?: "queued" | "starting" | "running" | "done" | "blocked" | "failed" | "ignored" | "succeeded" | "stopping" | "stopped";
                contextQuery?: string;
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
                            kind: "job" | "run";
                            id: string;
                            title: string;
                            subtitle: string;
                            url: string;
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
                jobId?: string;
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
                        job_id: string;
                        /** @enum {string} */
                        state: "queued" | "starting" | "running" | "blocked" | "stopping" | "succeeded" | "failed" | "stopped";
                        run_name: string;
                        job_name: string;
                        destination_url: string | null;
                        created_at: string;
                        updated_at: string;
                        started_at: string | null;
                        /** @enum {string} */
                        artifact_state: "pending" | "collecting" | "stored" | "partial" | "failed";
                        finalizing: boolean;
                        trace_revision: string;
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
    get_api_v1_runs_runId_trace_pages: {
        parameters: {
            query?: {
                after?: number;
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
            /** @description Missing runs:write scope or interactive owner session */
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
type WithRequired<T, K extends keyof T> = T & {
    [P in K]-?: T[P];
};
