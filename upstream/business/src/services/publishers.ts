import { z } from "zod";
import { type Credential } from "./sessionVault";
import { readJson, ConnectionError, type Options } from "./businessConnection";
const id = z.string().min(1).max(128);
const name = z.string().min(1).max(80);
export const publishersSchema = z
  .object({
    branchId: id,
    publisher: z
      .object({
        deviceId: id,
        name,
        epoch: z.number().int().positive().safe(),
        online: z.boolean(),
        lastPublishedAt: z.string().datetime().nullable(),
      })
      .strict()
      .nullable(),
    candidates: z
      .array(
        z
          .object({ deviceId: id, name, lastSeenAt: z.string().datetime() })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.candidates.map((candidate) => candidate.deviceId)).size ===
      value.candidates.length,
  );
export type Publishers = z.infer<typeof publishersSchema>;
function path(branchId: string) {
  if (!/^[a-f\d]{24}$/.test(branchId))
    throw new ConnectionError("accessChanged");
  return "/reporting/publishers/" + branchId;
}
export async function readPublishers(
  credential: Credential,
  branchId: string,
  options: Options,
): Promise<Publishers> {
  const parsed = publishersSchema.safeParse(
    await readJson(
      credential.origin,
      path(branchId),
      options,
      credential.token,
    ),
  );
  if (!parsed.success || parsed.data.branchId !== branchId)
    throw new ConnectionError("invalidResponse");
  return parsed.data;
}
export async function changePublisher(
  credential: Credential,
  state: Publishers,
  deviceId: string,
  options: Options,
) {
  if (!state.candidates.some((candidate) => candidate.deviceId === deviceId))
    throw new ConnectionError("accessChanged");
  const parsed = z
    .object({ changed: z.boolean(), epoch: z.number().int().positive().safe() })
    .strict()
    .safeParse(
      await readJson(
        credential.origin,
        path(state.branchId),
        options,
        credential.token,
        {
          method: "POST",
          body: { deviceId, expectedEpoch: state.publisher?.epoch ?? 0 },
        },
      ),
    );
  if (!parsed.success) throw new ConnectionError("invalidResponse");
  return parsed.data;
}
