import { NextRequest } from "next/server";

import { badRequest, ok, serverError } from "@/lib/http";
import { projectVersionCompareSchema } from "@/lib/validations/schemas";
import { compareProjectVersions } from "@/server/services/version-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = projectVersionCompareSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid version compare request.", parsed.error.flatten());
    }

    const result = await compareProjectVersions(
      projectId,
      parsed.data.planVersionId,
      parsed.data.actualVersionId,
    );
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
