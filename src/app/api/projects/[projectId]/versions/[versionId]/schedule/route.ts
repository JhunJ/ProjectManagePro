import { NextRequest } from "next/server";

import { notFound, ok, serverError } from "@/lib/http";
import { getScheduleFromVersion } from "@/server/services/version-service";

interface Params {
  params: Promise<{ projectId: string; versionId: string }>;
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId, versionId } = await context.params;
    const schedule = await getScheduleFromVersion(projectId, versionId);

    if (!schedule) {
      return notFound("Version not found.");
    }

    return ok(schedule);
  } catch (error) {
    return serverError(error);
  }
}
