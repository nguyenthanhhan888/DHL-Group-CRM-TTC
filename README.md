# Kiosk CRM -
# Project Overview

Kiosk CRM is a comprehensive Customer Relationship Management system designed to manage sales, customer data, kiosk lifecycles, and financial reporting for a kiosk-based business model. The system provides both a public-facing registration portal and a private administrative backend for staff to manage operations.

This system serves as the central hub for all business activities, ensuring data integrity, consistent business logic, and operational efficiency.

## 1. Objectives

-   **Centralize Data:** Consolidate all customer, kiosk, and payment information into a single, reliable system.
-   **Automate Lifecycle Management:** Manage the entire lifecycle of a kiosk, from registration and approval to renewal and expiration.
-   **Ensure Financial Accuracy:** Provide accurate and consistent financial reporting for revenue, payments, and customer value.
-   **Streamline Operations:** Equip administrative staff with the tools needed to manage customers, approve payments, and support business growth efficiently.
-   **Provide Business Intelligence:** Offer dashboards and reports to give stakeholders a clear view of key performance indicators (KPIs) and business health.

## 2. System Architecture

The system is architected as a modern web application using a Vanilla JavaScript frontend that communicates directly with a Supabase backend (Backend-as-a-Service).

```
+----------------------+        +---------------------------------------------+
|     End User         |        |         Administrative Staff                |
| (Public/Customer)    |        |        (Admin, Reviewer)                    |
+----------------------+        +---------------------------------------------+
          |                                       |
          v                                       v
+-----------------------------------------------------------------------------+
|                     Frontend: Vanilla JavaScript SPA                          |
|         (Single Page Application running in the browser)                      |
|                                                                             |
|  [UI Components] [Pages/Views] [Services] [Router] [State Management]       |
+-----------------------------------------------------------------------------+
          |                                      ^
          | (Supabase JS Client)                 | (Supabase JS Client)
          v                                      |
+-----------------------------------------------------------------------------+
|                             Backend: Supabase                               |
|                                                                             |
|  [Authentication]  [PostgreSQL DB]  [Database Functions/RPC]  [Edge Functions] |
|                                                                             |
|  - RLS Policies    - Tables/Views   - Business Logic          - Secure Ops    |
|  - User Mgmt       - Triggers       - Data Calculation        - Staff Mgmt    |
+-----------------------------------------------------------------------------+
```

-   **Frontend:** A Single Page Application (SPA) built with plain JavaScript, HTML, and CSS. It is responsible for rendering the user interface and communicating with the backend. It does **not** contain critical business logic.
-   **Backend (Supabase):**
    -   **PostgreSQL Database:** The core data store for all application data.
    -   **Database Functions (RPC):** Contains the critical, authoritative business logic (e.g., creating registrations, calculating KPIs, confirming payments). This ensures logic is centralized and secure.
    -   **Authentication:** Manages user identity, roles, and access control.
    -   **Row-Level Security (RLS):** Enforces data access policies at the database level, ensuring users can only access data they are permitted to see.
    -   **Edge Functions:** Used for secure, server-side operations that require elevated privileges, such as staff management.

## 3. Technology Stack

-   **Frontend:**
    -   **JavaScript (ES6 Modules):** Vanilla JS, no framework.
    -   **HTML5**
    -   **CSS3**
-   **Backend:**
    -   **Supabase:** The primary BaaS provider.
        -   **PostgreSQL:** Database.
        -   **PostgREST:** RESTful API for database interaction.
        -   **GoTrue:** Authentication service.
        -   **Deno:** Runtime for Edge Functions.
-   **Deployment:**
    -   **GitHub Pages:** Hosts the static frontend application.
    -   **GitHub Actions:** Automates the deployment process.

## 4. Project Structure

```
.
├── .github/              # GitHub Actions workflows (e.g., deployment)
├── docs/                 # Non-essential project documentation and audits
├── src/                  # All frontend application source code
│   ├── app.js            # Main application entry point
│   ├── components/       # Reusable UI components (e.g., forms, modals)
│   ├── constants/        # Application-wide constants (e.g., navigation, table configs)
│   ├── layouts/          # Main application layout/shell
│   ├── pages/            # Top-level view components for each page/route
│   ├── router/           # Client-side router
│   ├── services/         # Frontend services for communicating with Supabase API
│   ├── styles/           # CSS stylesheets
│   └── utils/            # Helper functions (e.g., date/currency formatting)
├── supabase/             # Supabase-specific files
│   ├── functions/        # Edge Functions source code
│   └── migrations/       # Database schema migrations
├── BUSINESS_RULES.md     # -> AUTHORITATIVE: Official business rules of the project.
├── OWNER_DECISIONS_REQUIRED.md # Questions for the Product Owner.
├── README.md             # This file.
└── index.html            # The main HTML file for the SPA.
```

## 5. Database Overview

The database is the core of the system, containing all business data. Key tables include:

-   `customers`: Stores customer information.
-   `kiosks`: Stores information about each kiosk, linked to a customer.
-   `payments`: Records all financial transactions, including registrations and renewals.
-   `categories` & `business_types`: Define the service offerings and pricing structure.
-   `users` & `user_roles`: Manage staff accounts and permissions.
-   `logs`: An audit trail for important system events.

Relationships are enforced with foreign keys, and access is controlled by Row-Level Security (RLS) policies.

## 6. Core Modules

-   **Dashboard:** Provides a high-level overview of business KPIs.
-   **Customers:** Module for creating, viewing, and managing customer records.
-   **Kiosks:** Module for viewing and managing kiosk details and lifecycles.
-   **Payments:** Module for reviewing and confirming financial transactions.
-   **Reports:** In-depth analysis of revenue, kiosks, customers, and data integrity.
-   **Registration:** Public and internal forms for registering new kiosks.
-   **Staff Management:** Admin-only module for managing staff accounts.

## 7. User Roles

-   **Public User:** Unauthenticated users who can access the public registration form.
-   **Reviewer:** Authenticated staff member with permissions to review and approve/reject pending registrations and payments. Access to other modules is permission-based.
-   **Admin:** Authenticated staff member with full access to all system modules, including staff management, configuration, and sensitive data repair actions.

## 8. Business Rules

This project is governed by a strict set of business rules that define all system behavior, from revenue calculation to data lifecycle management. These rules are the **single source of truth** and must be consulted before any development work.

A brief summary of key principles:
-   Financial records are immutable.
-   Business data is never hard-deleted.
-   All critical logic (KPIs, approvals) is centralized in the database.
-   Data access is strictly controlled by roles and permissions.

> **For a complete and authoritative guide to all business logic, please read:**
>
> ### &#128214; [BUSINESS_RULES.md](./BUSINESS_RULES.md)

## 9. Development Rules

1.  **Follow the Business Rules:** All code changes must strictly adhere to the rules defined in `BUSINESS_RULES.md`.
2.  **Backend-First Logic:** All new business logic, calculations, or data validation rules must be implemented in the Supabase backend (preferably as RPC functions), not in the frontend.
3.  **Convention over Configuration:** Follow the existing coding style, naming conventions, and project structure.
4.  **Secure by Default:** Assume all user input is untrusted. Implement security best practices, especially when writing database functions.
5.  **No Direct DB Access:** Do not hard-code database connection strings or secrets in the client-side application. Use the Supabase JS client.

## 10. Security Rules

1.  **RLS is Mandatory:** Every table containing business or user data must have Row-Level Security policies enabled. The default policy should be `DENY`.
2.  **Use `auth.uid()` and Roles:** RLS policies must enforce data access rules based on the authenticated user's ID (`auth.uid()`) and their role.
3.  **No `service_role_key` in Frontend/Edge Functions:** The `service_role_key` must never be used in client-side code or in Edge Functions exposed to users. Privileged operations must be handled by secure RPC functions (`security_definer`) or internal backend processes.
4.  **Input Sanitization:** All data submitted to the backend must be validated and sanitized.
5.  **Data Exposure:** Public-facing forms or APIs must never expose sensitive customer information.

## 11. Deployment

The application is deployed via a GitHub Actions workflow defined in `.github/workflows/deploy-pages.yml`.

-   **Trigger:** On a `push` to the `main` branch.
-   **Process:** The workflow checks out the code and uses the `actions/deploy-pages@v4` action to deploy the static files (HTML, CSS, JS) to GitHub Pages.
-   **Environment:** The production environment is `github-pages`.

## 12. Configuration

-   **Frontend:** Supabase URL and `anon_key` are configured in a `config.local.js` file (which is git-ignored) and loaded into the `window` object. For production, these are typically injected during the build/deployment process.
-   **Backend:** Database connection strings, API keys, and other secrets for Supabase are managed in the Supabase project dashboard.

### TTC Facebook verification

The TTC reward endpoint (`api/ttc/verify-facebook-task.js`) is fail-closed in production. It only credits coins after a real verifier confirms the task.

Production options:

-   `FACEBOOK_VERIFY_WEBHOOK_URL`: recommended. The endpoint sends task/action/target/worker Facebook IDs to an external verifier. The verifier must return `{ "verified": true }` before coins are credited.
-   `FACEBOOK_GRAPH_ACCESS_TOKEN` or `FACEBOOK_PAGE_ACCESS_TOKEN`: fallback direct Meta Graph API verifier for content the token is allowed to read. It can verify accessible reactions/comments by matching the worker Facebook ID. Arbitrary private profile, private group, follow, share, or join-group checks may be unsupported by Meta and will not credit coins.
-   `FACEBOOK_GRAPH_API_VERSION`: optional, defaults to `v25.0`.

Local-only testing:

-   `FACEBOOK_VERIFY_DEV_BYPASS=true` can simulate a successful Facebook verification outside production.
-   The bypass is ignored when `NODE_ENV=production` or `VERCEL_ENV=production`.

## 13. Future Roadmap

The `BUSINESS_RULES.md` document contains a section on future considerations, including:

-   A separate "Service Activation" report.
-   A `Suspended` status for kiosks.
-   An extensible KPI architecture.
-   A configurable permission system for the `Reviewer` role.

## 14. AI Development Workflow

AI agents working on this repository must follow this workflow:

1.  **Consult `README.md` (this file):** Understand the project architecture, rules, and structure.
2.  **Consult `BUSINESS_RULES.md`:** Before implementing any feature or fix, read the relevant sections in the business rules document to understand the required logic. **This is the most critical step.**
3.  **Analyze Existing Code:** Review the `src/services/` and `supabase/` directories to understand how data is currently fetched and how business logic is invoked via RPC.
4.  **Implement Changes:**
    -   Place new business logic in the backend (`supabase/migrations/` as new RPC functions).
    -   Call this logic from the frontend services (`src/services/`).
    -   Update UI components (`src/components/`, `src/pages/`) to display data and handle user interactions.
5.  **Verify:** Ensure the implementation does not violate any rules in `BUSINESS_RULES.md`.

## 15. Documentation Index

-   [**Official Business Rules**](./BUSINESS_RULES.md): The authoritative guide to all business logic.
-   [**Owner Decisions Required**](./OWNER_DECISIONS_REQUIRED.md): A log of questions and decisions made with the Product Owner.
-   [**Project Full Audit V2**](./docs/PROJECT_FULL_AUDIT_V2.md): An in-depth technical and business audit of the codebase.
-   [**Supabase Read-Only Audit**](./docs/SUPABASE_READ_ONLY_AUDIT.sql): A SQL script for auditing data integrity.
