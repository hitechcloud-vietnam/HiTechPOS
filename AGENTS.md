# Project rules

## Optional features

Optional workflows and behaviors must default off and require explicit opt-in in their module's settings. Server capability support alone is not user consent. Preserve explicitly saved settings on upgrades. Do not introduce automatic workflow transitions such as table cleaning. Keep duplicate prevention, durable order recovery, payment integrity, authentication and access checks automatic. Settings belong on module pages, never inside Features switch cards. Document default changes and test both unset and explicitly enabled settings.
