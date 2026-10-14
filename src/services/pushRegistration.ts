import { z } from "zod";
import { type Credential } from "./sessionVault";
import { readJson, ConnectionError, type Options } from "./businessConnection";
const statusSchema = z
  .object({
    channelVersion: z.literal(2).optional(),
    available: z.boolean(),
    projectId: z.string().uuid().nullable(),
    enabled: z.boolean(),
    supportedLanguages: z
      .array(z.string().regex(/^[a-z]{2}$/))
      .max(18)
      .optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
  })
  .strict()
  .refine((value) =>
    value.supportedLanguages === undefined
      ? value.locale === undefined
      : new Set(value.supportedLanguages).size ===
          value.supportedLanguages.length &&
        !!value.locale &&
        value.supportedLanguages.includes(value.locale),
  )
  .refine((value) =>
    value.available
      ? !!value.projectId
      : !value.enabled && value.projectId === null,
  );
export type PushStatus = z.infer<typeof statusSchema>;
export async function readPushStatus(credential: Credential, options: Options) {
  const result = statusSchema.safeParse(
    await readJson(
      credential.origin,
      "/notifications/device?language=1&channels=2",
      options,
      credential.token,
    ),
  );
  if (!result.success) throw new ConnectionError("invalidResponse");
  return result.data;
}
export async function setPushRegistration(
  credential: Credential,
  registration: {
    token: string;
    projectId: string;
    platform: "ios" | "android";
    locale?: string;
    channelVersion?: 2;
  } | null,
  options: Options,
) {
  const result = z
    .object({ enabled: z.boolean() })
    .strict()
    .safeParse(
      await readJson(
        credential.origin,
        "/notifications/device",
        options,
        credential.token,
        {
          method: registration ? "POST" : "DELETE",
          ...(registration ? { body: registration } : {}),
        },
      ),
    );
  if (!result.success || result.data.enabled !== !!registration)
    throw new ConnectionError("invalidResponse");
}
