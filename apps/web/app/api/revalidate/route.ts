import { revalidatePath } from "next/cache";
import { isAuthorized, parseRevalidateBody } from "@/lib/revalidate";

/**
 * Called by the daily collection (Authorization: Bearer REVALIDATE_SECRET): { "slugs": [...] } after each store for
 * the products whose price changed, { "all": true } after `pnpm stats`. The pages render again on their next visit.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), process.env.REVALIDATE_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Not JSON: rejected below like any other invalid body.
  }
  const parsed = parseRevalidateBody(body);
  if (parsed === null) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (parsed.all) {
    revalidatePath("/", "layout");
    return Response.json({ revalidated: "all" });
  }
  for (const slug of parsed.slugs) {
    revalidatePath(`/p/${slug}`);
  }
  return Response.json({ revalidated: parsed.slugs.length });
}
