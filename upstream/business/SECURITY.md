# Security

Test builds can connect to compatible Cloud and Community servers. The sample business uses synthetic data. Connected access and decisions are restricted by current server permissions.

Do not post credentials or private shop records in public issues. Use GitHub's private vulnerability reporting when enabled for this repository; otherwise contact a maintainer privately before sharing sensitive details.

All production data and commands must be authorized server-side. Client visibility is not an authorization boundary. Credentials must be issuer-scoped, revocable, password-free and protected by native secure storage; client PIN unlock alone cannot authorize a financial decision.

The local PIN accepts four or six digits, rejects common patterns, and persists a five-attempt budget before doing verification. Exhaustion requires Cloud/Community sign-in again. The PIN and account password are never saved. An installation secret and the encrypted session are kept in native secure storage. This does not defend a fully compromised operating system.

New PIN records use PBKDF2-HMAC-SHA256 (600,000 iterations) through Quick Crypto's asynchronous C++ worker, with a random salt and installation secret, then AES-GCM authenticated encryption. A ten-second derivation deadline reports a recoverable storage error; backgrounding cancels access and prevents a late enrollment from saving a credential. Existing scrypt records are read with their original algorithm and migrated only after a successful PIN check, preserving the biometric enrollment binding.

Native PIN qualification builds a separate `com.posnic.business.pinqa` app with the actual AccountScreen, Hermes and SecureStore. Only its network transport and account data are synthetic. The test checks four- and six-digit enrollment, process restart, unlock, background locking, durable wrong-PIN lockout and a native cryptographic known-answer vector. This QA entry point and transport are never selected by the release workflow.
