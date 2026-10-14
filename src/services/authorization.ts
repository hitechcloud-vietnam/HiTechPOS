import { z } from "zod";
import { contextSchema } from "../domain/contracts";
import { communityOrigin } from "../domain/server";
import {
  BUSINESS_PATH,
  CLOUD_ORIGIN,
  ConnectionError,
  readJson,
  type Options,
} from "./businessConnection";

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const requestSchema = z
  .object({
    request: opaque,
    authorizationUrl: z.string().url(),
    expiresIn: z.number().int().min(1).max(600),
    interval: z.number().int().min(5).max(30),
  })
  .strict();
export const grantSchema = z
  .object({
    token: z.string().regex(/^pb1_[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime(),
    context: contextSchema,
  })
  .strict();
export type Grant = z.infer<typeof grantSchema>;
export type Session = Grant & { origin: string; authorizationOrigin?: string };
export type AuthorizationAttempt = {
  origin: string;
  request: string;
  verifier: string;
  authorizationUrl: string;
  expiresAt: number;
  interval: number;
  matchingCode: string;
};
export type ProofSource = {
  random: () => Promise<string>;
  challenge: (verifier: string) => Promise<string>;
};

export async function startAuthorization(
  address: string,
  crypto: ProofSource,
  options: Options & { stepUp?: boolean },
): Promise<AuthorizationAttempt> {
  const origin = communityOrigin(address),
    verifier = await crypto.random();
  opaque.parse(verifier);
  const codeChallenge = opaque.parse(await crypto.challenge(verifier));
  const parsed = requestSchema.safeParse(
    await readJson(origin, "/requests", options, undefined, {
      method: "POST",
      body: {
        codeChallenge,
        deviceName: "Posnic Business",
        ...(options.stepUp ? { stepUp: true } : {}),
      },
    }),
  );
  if (!parsed.success) throw new ConnectionError("invalidResponse");
  const value = parsed.data;
  // Never open an attacker-provided page asking for an account password.
  const expected =
    origin + BUSINESS_PATH + "/authorize?request=" + value.request;
  if (value.authorizationUrl !== expected)
    throw new ConnectionError("invalidResponse");
  return {
    origin,
    request: value.request,
    verifier,
    authorizationUrl: expected,
    expiresAt: Date.now() + value.expiresIn * 1000,
    interval: value.interval * 1000,
    matchingCode: value.request.slice(-6).toUpperCase(),
  };
}
export async function checkAuthorization(
  attempt: AuthorizationAttempt,
  options: Options,
): Promise<Session | null> {
  if (Date.now() >= attempt.expiresAt)
    throw new ConnectionError("signInRequired");
  let value = await readJson(attempt.origin, "/token", options, undefined, {
    method: "POST",
    body: { request: attempt.request, codeVerifier: attempt.verifier },
  });
  if (
    z
      .object({
        error: z.object({ code: z.literal("authorization_pending") }).strict(),
      })
      .strict()
      .safeParse(value).success
  )
    return null;
  let sessionOrigin = attempt.origin;
  const handoff = z
    .object({
      handoff: z.object({ origin: z.string(), request: opaque }).strict(),
    })
    .strict()
    .safeParse(value);
  if (handoff.success) {
    if (attempt.origin !== CLOUD_ORIGIN)
      throw new ConnectionError("invalidResponse");
    try {
      sessionOrigin = communityOrigin(handoff.data.handoff.origin);
    } catch {
      throw new ConnectionError("invalidResponse");
    }
    if (
      sessionOrigin !== handoff.data.handoff.origin ||
      sessionOrigin === CLOUD_ORIGIN
    )
      throw new ConnectionError("invalidResponse");
    value = await readJson(sessionOrigin, "/token", options, undefined, {
      method: "POST",
      body: {
        request: handoff.data.handoff.request,
        codeVerifier: attempt.verifier,
      },
    });
  }
  const parsed = grantSchema.safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
    throw new ConnectionError("invalidResponse");
  return {
    ...parsed.data,
    origin: sessionOrigin,
    authorizationOrigin: attempt.origin,
  };
}
export async function revokeSession(
  session: Pick<Session, "origin" | "token">,
  options: Options,
) {
  await readJson(session.origin, "/session", options, session.token, {
    method: "DELETE",
  });
}
