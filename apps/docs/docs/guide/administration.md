# Instance Administration & Governance

ModelScript Hub features a comprehensive administrative console accessible directly within the Web interface for instance operators, moderators, and system administrators.

---

## 1. Initial Setup & Admin Provisioning

When launching a ModelScript Hub instance (`apps/api`), an initial administrative account is seeded automatically using environment variables:

```bash
# Production or Docker environment variables
ADMIN_INIT_USERNAME="admin"
ADMIN_INIT_PASSWORD="super-secret-secure-password"
ADMIN_INIT_EMAIL="admin@example.org"
```

If these environment variables are set and the user does not yet exist, the database bootstrap process creates this user with `account_type = "admin"` and `role = "admin"`.

### RBAC Hierarchy

| Role / Account Type             | Permissions                                                                                                                                                      |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standard User (`user`)**      | Public exploration, Morsel code editing, social feeds, personal artifacts, running simulations.                                                                  |
| **Moderator / Admin (`admin`)** | Full access to the `/admin` console, moderation queues, ActivityPub domain governance, DMCA resolution, immutable audit trail, and database maintenance runners. |

---

## 2. Accessing the Admin Console

When an authenticated administrator logs into the Web Hub (`apps/web`):

1. **Sidebar Navigation**: A dedicated **Admin** button with a shield icon (`ShieldLockIcon`) appears above the Settings link in the left sidebar.
2. **Command Palette (`Ctrl+K` / `Cmd+K`)**: Quick actions are dynamically unlocked (e.g., `Admin: Moderation Queue`, `Admin: Federation Domains`, `Admin: Security & Audit Logs`, etc.).
3. **Account Settings**: A direct shortcut to the Administration Console is embedded under the **Your Account** section.
4. **URL Routing**: Direct navigation to `/admin`, `/admin/moderation`, `/admin/federation`, `/admin/dmca`, `/admin/audit`, and `/admin/database`.

> [!NOTE]
> If a standard user or unauthenticated visitor attempts to navigate directly to `/admin/*`, the client-side `AdminRoute` guard intercepts the request and redirects them to `/home`. All backend endpoints (`/api/v1/admin/*`) strictly enforce token-based admin authorization via `requireAdmin` middleware.

---

## 3. Administrative Subsystems

### A. Moderation Queue (`/admin/moderation`)

The Moderation subsystem handles reports submitted by community members against posts, models, or comments:

- **Reviewing Reports**: Inspect the reported artifact, reason, reporter username, and submission timestamp.
- **Filtering**: View reports by status (`pending`, `resolved`, or `dismissed`).
- **Taking Action**:
  - **Dismiss**: Reject reports without punitive action.
  - **Resolve & Retract**: Mark the report as resolved with moderator resolution notes.
  - **Delete Post & Propagate Tombstone**: Remove the post locally and broadcast an ActivityPub `Delete(Tombstone)` activity across federated peer instances.
  - **Quick Domain Restrictions**: Silence or suspend the offending author's remote instance in one click.

---

### B. Federation Domain Controls (`/admin/federation`)

ModelScript Hub communicates across the federated social graph using ActivityPub. The Federation Controls view allows operators to enforce instance-level trust policies:

| Tier          | Behavior                                                                                                     |
| :------------ | :----------------------------------------------------------------------------------------------------------- |
| **`allow`**   | Full bidirectional federation (inbox delivery, outbox dispatch, artifact replication).                       |
| **`silence`** | Content from this domain is hidden from public feeds and discovery queues, visible only to direct followers. |
| **`suspend`** | Total block. Incoming payloads are dropped, outgoing activities are halted, and media fetches are rejected.  |

Operators can add domain rules, specify internal policy reasons, and reset domains to default behavior.

---

### C. DMCA Takedown Management (`/admin/dmca`)

To maintain safe harbor compliance under statutory copyright regulations (DMCA § 512 / EU Copyright Directive), administrators can track and resolve takedown notices:

- View copyright claimant, contact email, original copyrighted work description, and infringing URL/artifact.
- Track intake timestamps and current status (`pending`, `resolved`, `rejected`).
- Submit structured resolution actions (e.g., artifact removal, counter-notice holding period, or notice invalidation).

---

### D. Security & Audit Logs (`/admin/audit`)

All sensitive system and administrative operations are recorded in an append-only, immutable audit log:

- Filter logs by administrative action (`admin.login`, `moderation.resolve`, `federation.tier_change`, `dmca.resolve`, `db.upgrade`, etc.).
- Inspect the actor ID, target resource type and ID, client IP address, timestamp, and JSON metadata payloads.
- Useful for compliance verification, security incident forensics, and operational accountability.

---

### E. Database Maintenance & Migrations (`/admin/database`)

The Database Operations panel monitors underlying database health and migration status without requiring direct SSH/SQL terminal access:

- **Migration Status**: Displays the current applied schema version, baseline version, and pending migration counts.
- **Integrity Verification**: Executes low-level database consistency checks (foreign key constraints, orphan artifact views, index integrity) and presents real-time diagnostic output.
- **Migration Runner**: Allows operators to execute pending schema upgrades with an optional **Dry Run** flag to preview migration statements before applying changes to production tables.

---

## 4. REST API Reference

For automation, GitOps pipelines, or custom CLI scripts, all console operations are backed by the REST API under `/api/v1/admin/*`:

```http
# Fetch moderation queue
GET /api/v1/admin/moderation/queue?status=pending&limit=50

# Resolve a moderation report
POST /api/v1/admin/moderation/reports/:id/resolve
Content-Type: application/json
{
  "action": "resolved",
  "resolutionNotes": "Violated community guidelines. Content removed."
}

# Update federation domain tier
POST /api/v1/admin/federation/domains
Content-Type: application/json
{
  "domain": "bad-actor.example.com",
  "tier": "suspend",
  "reason": "Spam and unmoderated abusive content."
}

# Run database integrity verification
GET /api/v1/admin/db/verify

# Execute database upgrade
POST /api/v1/admin/db/upgrade
Content-Type: application/json
{
  "dryRun": false
}
```

All requests require the `Authorization: Bearer <jwt-token>` header containing an admin-scoped token.
