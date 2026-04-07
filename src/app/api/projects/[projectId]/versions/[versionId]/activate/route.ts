import { NextRequest } from "next/server";

import { notFound, ok, serverError } from "@/lib/http";
import { activateProjectVersion } from "@/server/services/version-service";

interface Params {
  params: Promise<{ projectId: string; versionId: string }>;
}

export async function POST(_: NextRequest, context: Params) {
  try {
    const { projectId, versionId } = await context.params;
    const schedule = await activateProjectVersion(projectId, versionId);

    if (!schedule) {
      return notFound("Version not found.");
    }

    return ok(schedule);
  } catch (error) {
    return serverError(error);
  }
}
