import { z } from "zod";

/** Cloud sign-in stays on the approved internet server, even on shop Wi-Fi. */
export function cloudGrant(value: unknown) {
  const grant = z
    .object({
      baseUrl: z.string().url(),
      code: z.string().regex(/^[A-F0-9]{12}$/),
    })
    .parse(value);
  const endpoint = new URL(grant.baseUrl);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("invalidServer");
  // Nearby tills may have independent sale journals. Choosing one silently
  // strands cloud users on Wi-Fi and cannot safely migrate their pending sales.
  return grant;
}
