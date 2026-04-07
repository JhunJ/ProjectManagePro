import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { projectVersionUpdateSchema } from "@/lib/validations/schemas";
import { getProjectVersionDetail, updateProjectVersionMeta } from "@/server/services/version-service";

interface Params {
  params: Promise<{ projectId: string; versionId: string }>;
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId, versionId } = await context.params;
    const version = await getProjectVersionDetail(projectId, versionId);

    if (!version) {
      return notFound("Version not found.");
    }

    return ok(version);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { projectId, versionId } = await context.params;
    const body = await request.json();
    const parsed = projectVersionUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid version update request.", parsed.error.flatten());
    }

    if (
      parsed.data.title === undefined &&
      parsed.data.description === undefined &&
      parsed.data.createdBy === undefined
    ) {
      return badRequest("No fields to update.");
    }

    const updated = await updateProjectVersionMeta({
      projectId,
      versionId,
      title: parsed.data.title,
      description: parsed.data.description,
      createdBy: parsed.data.createdBy,
    });

    if (!updated) {
      return notFound("Version not found.");
    }

    return ok(updated);
  } catch (error) {
    return serverError(error);
  }
}
