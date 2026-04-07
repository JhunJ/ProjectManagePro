import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { projectVersionCreateSchema } from "@/lib/validations/schemas";
import { createProjectVersion, listProjectVersions } from "@/server/services/version-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("Project not found.");
    }

    const versions = await listProjectVersions(projectId);
    return ok(versions);
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = projectVersionCreateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid version create request.", parsed.error.flatten());
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("Project not found.");
    }

    const version = await createProjectVersion({
      projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      createdBy: parsed.data.createdBy,
      versionType: parsed.data.versionType,
    });

    return ok(version, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
