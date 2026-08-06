# Kiosk CRM - Database Architecture

- **Version:** 1.0
- **Date:** July 25, 2026

## 1. Database Overview

The Kiosk CRM database is built on **PostgreSQL** and hosted on **Supabase**. It serves as the central data store and the single source of truth for all business logic and application data.

The architecture heavily relies on Supabase's features, including:
-   Direct database access via the Supabase JS client.
-   **Row-Level Security (RLS)** to control data access per user role.
-   **Database Functions (RPC)** to encapsulate critical business logic.
-   **Authentication** managed by Supabase GoTrue.
-   **Database Triggers** for auditing purposes.

The design philosophy is to keep the frontend ("client") thin and move all authoritative calculations, state transitions, and business rule enforcement into the database layer.

## 2. Entity Relationship Diagram (Markdown)

This diagram illustrates the core relationships between the main tables.

```
+----------------+      +----------------+      +-----------------+
|   customers    |<--+--|     kiosks     |<--+--|     payments    |
|----------------|   |  |----------------|   |  |-----------------|
| id (PK)        |   |  | id (PK)        |   |  | id (PK)         |
| facebook_name  |   |  | customer_id(FK)|---'  | customer_id(FK) |
| phone          |   |  | business_type  |      | kiosk_id (FK)   |---'
| status         |   |  | (FK)           |      | total_amount    |
| total_kiosks   |   |  | start_date     |      | payment_status  |
| total_paid     |   |  | end_date       |      | confirmed_at    |
+----------------+   |  | status         |      +-----------------+
                     |  +----------------+               |
+----------------+   |          |                        |
|   user_roles   |---'          |                        |
|----------------|              |                        |
| user_id (PK,FK)|      +-----------------+      +-----------------+
| role           |      | business_types  |<--+--|   categories    |
| username       |      |-----------------|   |  |-----------------|
+----------------+      | id (PK)         |   |  | id (PK)         |
                        | category_id(FK) |---'  | name            |
                        | name            |      | is_active       |
                        | price_per_month |      +-----------------+
                        +-----------------+

+--------------------------+
|          logs            |
|--------------------------|
| id (PK)                  |
| table_name               |
| record_id                |
| action                   |
| new_data (jsonb)         |
| created_by (FK user_id)  |
+--------------------------+
```

## 3. Tables

### `customers`
- **Purpose:** Stores information about a business client. A customer can own one or more kiosks.
- **Primary Key:** `id` (bigint, auto-incrementing)
- **Foreign Keys:** None.
- **Important Columns:**
    - `facebook_name` (text): The customer's display name.
    - `phone` (text): Contact phone number. **Not unique.**
    - `facebook_id` (text): The customer's numeric Facebook ID. **NEEDS_CONFIRMATION**: Should have a UNIQUE constraint after data cleanup.
- **Cache Columns:**
    - `total_kiosks` (int): A cached count of all kiosks associated with the customer.
    - `total_paid` (numeric): A cached sum of all completed payments from the customer.
- **Status Fields:** `status` (text): Can be 'Active' or 'Inactive'.
- **Timestamps:** `created_at`, `updated_at`.

### `kiosks`
- **Purpose:** Represents a single service/product instance registered by a customer.
- **Primary Key:** `id` (bigint, auto-incrementing)
- **Foreign Keys:**
    - `customer_id` -> `customers.id`
    - `category_id` -> `categories.id`
    - `business_type_id` -> `business_types.id`
- **Important Columns:**
    - `facebook_name` (text): The name of the kiosk (e.g., a Facebook page name).
    - `facebook_id` (text): The unique Facebook ID for this kiosk. **This is the primary unique identifier for a kiosk.**
    - `start_date` (date): The start of the current service period.
    - `end_date` (date): The end of the current service period.
- **Status Fields:** `status` (text): Can be 'Pending', 'Active', 'Expired', 'Suspended'.
- **Timestamps:** `created_at`, `updated_at`.

### `payments`
- **Purpose:** An immutable financial record of a transaction for a kiosk.
- **Primary Key:** `id` (bigint, auto-incrementing)
- **Foreign Keys:**
    - `customer_id` -> `customers.id`
    - `kiosk_id` -> `kiosks.id`
    - `confirmed_by` -> `user_roles.user_id`
- **Important Columns:**
    - `total_amount` (numeric): The final amount paid after discounts.
    - `price_per_month` (numeric): The price per month at the time of payment.
    - `months` (int): The number of months purchased.
    - `payment_method` (text): e.g., 'transfer', 'cash'.
- **Status Fields:** `payment_status` (text): 'Pending', 'Completed', 'Rejected', 'Cancelled'.
- **Timestamps:**
    - `created_at`: When the payment record was created.
    - `confirmed_at`: When an Admin confirmed the payment. **This is the official revenue recognition date.**

### `categories` & `business_types`
- **Purpose:** Defines the service hierarchy and pricing. A Category contains multiple Business Types.
- **Primary Keys:** `id` for both.
- **Foreign Keys:** `business_types.category_id` -> `categories.id`.
- **Important Columns:**
    - `name` (text): The display name.
    - `price_per_month` (numeric) in `business_types`: The base price for a service.
- **Status Fields:** `is_active` (boolean) for both.

### `user_roles`
- **Purpose:** Manages staff accounts and their roles within the system.
- **Primary Key:** `user_id` (uuid), which is also a foreign key to `auth.users.id`.
- **Foreign Keys:** `user_id` -> `auth.users.id`.
- **Important Columns:**
    - `role` (text): User's role, e.g., 'admin' or 'reviewer'.
    - `username` (text): Unique username for the staff member.
- **Status Fields:** `is_active` (boolean): To lock or unlock staff accounts.
- **Timestamps:** `created_at`, `updated_at`.

### `audit_logs` (canonical audit source)
- **Purpose:** Immutable audit history for frontend, RPC, Edge Function, system, and
  database-trigger operations.
- **Primary Key:** `id` (bigint identity).
- **Actor columns:**
    - `actor_id` references `auth.users.id` when a concrete authenticated actor is
      known.
    - `actor_name` stores the resolved display name at write time.
    - `actor_type` is `staff`, `public`, `system`, or `database_trigger`.
    - `actor_role` stores the configured staff role or `public`/`system`.
- **Action target columns:**
    - `module` is the application area.
    - `entity` is the affected entity/table/domain object.
    - `record_id` is the affected record identifier when one exists.
    - `action` is the normalized action name.
- **Change columns:** `before`, `after`, and mandatory/optional business `reason`.
- **Timestamp:** `created_at` is database generated.
- **Integrity:** Updates and deletes are rejected by database trigger. Normal users
  have no direct table privileges; reads and writes use permission-checked RPCs.
- **Querying:** `get_audit_logs()` performs actor/module/action/time/search filters,
  ordering, counting, and pagination in PostgreSQL.

### `logs` (legacy compatibility source)
- Historical rows are retained and copied once into `audit_logs` using
  `legacy_log_id` for idempotency.
- New legacy inserts are mirrored into `audit_logs` by database trigger.
- Legacy rows cannot be updated or deleted.
- Application services no longer query this table; `audit_logs` is the only
  application audit source.

### `registration_requests`
- **Purpose:** A temporary holding table for public-facing new kiosk registrations before they are approved and converted into actual customers, kiosks, and payments.
- **Primary Key:** `id`
- **Foreign Keys:** `reviewed_by` -> `user_roles.user_id`.
- **Status Fields:** `status` (text): 'pending', 'approved', 'rejected'.
- **Timestamps:** `submitted_at`, `reviewed_at`.

## 4. Relationships and Business Meaning

-   **`customers` 1--* `kiosks`**: A customer can own many kiosks. A kiosk must belong to exactly one customer. This is the core ownership relationship.
-   **`kiosks` 1--* `payments`**: A kiosk can have many payments over its lifetime (initial registration, multiple renewals). A payment is for a specific kiosk.
-   **`customers` 1--* `payments`**: A payment is also directly linked to a customer for easier querying and aggregation of customer value.
-   **`categories` 1--* `business_types`**: A category groups multiple business types. This defines the service catalog.
-   **`business_types` *--1 `kiosks`**: Each kiosk is an instance of a specific business type.
-   **`user_roles` 1--* `payments`**: The `confirmed_by` field links a completed payment to the staff member who approved it.
-   **`user_roles` 1--* `audit_logs`**: `actor_id` identifies a concrete staff
    actor. Actor names are resolved from `user_roles` rather than guessed in the
    frontend. Rows without a concrete user are attributed to Public User, System,
    or Database Trigger.

## 5. Cache Columns

As defined in `BUSINESS_RULES.md`, the `customers` table contains two cached columns for performance.

-   **`total_kiosks`**:
    -   **Purpose:** To quickly see how many kiosk records a customer has without performing a `COUNT` query every time the customer list is displayed.
    -   **Source of Truth:** The actual count of records in the `kiosks` table where `customer_id` matches.
    -   **Update Rule:** Must be updated automatically by the database (via trigger or RPC) whenever a kiosk is created or its `customer_id` is reassigned.

-   **`total_paid`**:
    -   **Purpose:** To quickly see the lifetime value of a customer.
    -   **Source of Truth:** The sum of `final_amount` from all records in the `payments` table where `customer_id` matches and `payment_status` is 'Completed'.
    -   **Update Rule:** Must be updated automatically by the database (via trigger or RPC) whenever a payment is confirmed ('Completed') or a correction/reversal transaction is processed.

## 6. Business Flows in the Database

### Registration Flow
1.  **Public Form:** A user submits the public registration form.
2.  **RPC `submit_registration_request`:** The frontend calls this function.
3.  **Database:** The RPC creates a new record in the `registration_requests` table with a 'pending' status. No records are created in `customers` or `kiosks` at this stage.

### Approval Flow
1.  **Admin Action:** An Admin reviews a pending record (either from `registration_requests` or a `payments` record for renewal).
2.  **RPC `confirm_payment` or `approve_registration_request`:** The frontend calls the relevant RPC.
3.  **Database:** The RPC executes a complex, transactional logic:
    -   Creates `customers` and `kiosks` records if they don't exist.
    -   Updates the `payments` record status to 'Completed'.
    -   Sets `confirmed_at` and `confirmed_by`.
    -   Calculates the correct `start_date` and `end_date` for the kiosk.
    -   Updates the `kiosks` table with the new service period.
    -   (Should) Update the `customers.total_paid` and `customers.total_kiosks` cache columns.
    -   Inserts a record into the `logs` table.

### Payment & Renewal Flow
1.  A new `payments` record is created with `payment_status = 'pending'`.
2.  This has no effect on any other table.
3.  The **Approval Flow** is triggered when an Admin confirms this payment. The `confirm_payment` RPC contains the logic to handle both new activations and renewals based on the kiosk's current `end_date`.

### Audit Flow
1.  **NEEDS_CONFIRMATION:** It appears an audit trigger is configured on key tables (`customers`, `kiosks`, `payments`, etc.).
2.  When a record is `INSERT`ed, `UPDATE`d, or `DELETE`d, the trigger fires.
3.  The trigger function captures the old and new state of the row, the user performing the action (`auth.uid()`), and inserts this information into the `logs` table.
4.  Some RPC functions, like `private.complete_payment`, also perform manual logging. This should be consolidated.

## 7. Security

-   **RLS (Row-Level Security):**
    -   **Current State:** **CRITICAL RISK.** As per the audit, RLS is not enabled or properly configured on most critical tables. Any user with the `anon_key` can potentially read all data.
    -   **Required State:** All tables must have RLS enabled with a default `DENY` policy. Policies must grant access based on user role (e.g., `(get_my_role() = 'admin')`) or ownership (e.g., `auth.uid() = user_id`).
-   **Roles:**
    -   `anon`: Public, unauthenticated users.
    -   `authenticated`: Any logged-in user.
    -   `admin`: Custom role with elevated privileges, managed in `user_roles`.
    -   `reviewer`: Custom role with limited privileges, managed in `user_roles`.
-   **Permissions:** Permissions are currently enforced at the application level (UI hiding/showing buttons) and within RPC calls. This is insufficient and must be backed by database-level RLS policies.

## 8. Future Database Roadmap

The following concepts have been discussed and may influence future database design, but do **not** require immediate schema changes:

-   **Customer Portal:** May require a new table to store customer-specific settings or preferences, with RLS policies allowing a customer to only see their own data (`auth.uid() = customer_id`). **NEEDS_CONFIRMATION**: The link between `auth.users` and `customers` is not currently defined.
-   **TTC (Thông tin cước):** **NEEDS_CONFIRMATION**: The meaning of this is unclear from the current context. It may imply more detailed pricing or package management tables.
-   **Wallet:** May require a `wallets` table linked to customers to manage pre-paid balances or credits. This would involve significant new tables and transactional logic.
