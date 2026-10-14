import { z } from "zod";
import { credentialSchema, type Credential } from "./sessionVault";
import { readJson, ConnectionError, type Options } from "./businessConnection";
const id = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sessionSchema = z
  .object({
    id,
    name: z.string().min(1).max(80),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    current: z.boolean(),
  })
  .strict();
const sessionsSchema = z
  .array(sessionSchema)
  .max(100)
  .refine(
    (rows) =>
      new Set(rows.map((row) => row.id)).size === rows.length &&
      rows.filter((row) => row.current).length <= 1,
  );
export type BusinessSession = z.infer<typeof sessionSchema>;
export async function listBusinessSessions(
  credential: Credential,
  options: Options,
) {
  credentialSchema.parse(credential);
  const parsed = sessionsSchema.safeParse(
    await readJson(credential.origin, "/sessions", options, credential.token),
  );
  if (!parsed.success) throw new ConnectionError("invalidResponse");
  return parsed.data;
}
export async function removeBusinessSession(
  credential: Credential,
  sessionId: string,
  options: Options,
) {
  credentialSchema.parse(credential);
  const response = await readJson(
    credential.origin,
    "/sessions/" + id.parse(sessionId),
    options,
    credential.token,
    { method: "DELETE" },
  );
  if (
    !z
      .object({ revoked: z.literal(true) })
      .strict()
      .safeParse(response).success
  )
    throw new ConnectionError("invalidResponse");
}
