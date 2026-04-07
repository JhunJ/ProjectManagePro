import { NextRequest } from "next/server";

import { notFound, ok, serverError } from "@/lib/http";
import { syncProjectVersionSnapshot } from "@/server/services/version-service";

interface Params {
  params: Promise<{ projectId: string; versionId: string }>;
}

export async function POST(_: NextRequest, context: Params) {
  try {
    const { projectId, versionId } = await context.params;
    const version = await syncProjectVersionSnapshot(projectId, versionId);

    if (!version) {
      return notFound("Version not found.");
    }

    return ok(version);
  } catch (error) {
    return serverError(error);
  }
}
