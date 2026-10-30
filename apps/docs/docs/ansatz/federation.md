# ActivityPub Federation & Engineering Morsels

Ansatz implements the **W3C ActivityPub** standard (Server-to-Server and Client-to-Server) to enable decentralized collaboration among engineers. Rather than confining simulations and discussions to a single walled garden, independent Ansatz nodes can federate, exchange posts, and follow engineers across the network.

---

## What is an Engineering Morsel?

In conventional social networks, posts consist of plain text, images, or static video. In Ansatz, posts can carry **Morsels**—rich, structured payloads representing verifiable engineering artifacts:

1. **Simulation Runs:** Encapsulated DAE/ODE trajectory datasets with time-series plots, parameter configurations, and solver settings.
2. **Interactive 3D CAD/FEA/CFD Views:** Compressed STEP geometries or VTK Unstructured Grid (`.vtu`) stress fields viewable directly in the feed using Three.js and WebXR.
3. **Schematic & Architecture Diffs:** Visual diffs (`PolyglotVersionDiffView`) showing added, modified, or removed components across Modelica and SysML diagrams.
4. **Executable Scripts:** Self-contained ModelScript scripts that other engineers can open in `/playground` with a single click.

---

## Federation Protocol Details

### Actor Identification & WebFinger

Every engineer on an Ansatz node has a federated handle formatted as `@username@domain.com`. Remote instances resolve actor profiles via RFC 7033 WebFinger:

```text
GET /.well-known/webfinger?resource=acct:alice@ansatz.social
```

The server returns a JSON Resource Descriptor pointing to the actor's ActivityPub actor object at `/api/v1/users/alice`.

### Cryptographic Signatures (HTTP Signatures)

Outbound server-to-server HTTP requests are cryptographically signed using **HTTP Signatures** (draft-cavage) with an RSA-2048 keypair generated during account creation:

- The public key is published in the actor document (`publicKey.publicKeyPem`).
- Incoming activities are verified against the sender's public key before being accepted into the instance inbox (`/api/v1/inbox`).

### Activity Types

Ansatz supports standard ActivityStreams 2.0 activities:

- `Create(Note)`: Publishing a new engineering post or morsel.
- `Follow(Actor)`: Following an engineer on a remote node.
- `Accept(Follow)`: Confirming a follow request.
- `Announce(Note)`: Boosting or sharing a post to local followers.
- `Like(Note)`: Favoriting an engineering post.
- `Delete(Tombstone)`: Permanently retracting a post.

---

## Domain Moderation & Federation Policies

Administrators control outbound and inbound federation via the **Federation** tab in `/admin`:

| Policy Tier          | Behavior                                                                                 |
| :------------------- | :--------------------------------------------------------------------------------------- |
| **Open Federation**  | Connects to any valid ActivityPub node with verified HTTP signatures.                    |
| **Domain Allowlist** | Only allows federation with explicitly approved partner instances.                       |
| **Silenced Domain**  | Remote posts are hidden from public and explore feeds, visible only to direct followers. |
| **Suspended Domain** | All incoming and outgoing federation traffic with the domain is blocked.                 |
