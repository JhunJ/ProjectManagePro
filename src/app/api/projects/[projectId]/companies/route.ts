import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { companyCreateSchema } from "@/lib/validations/schemas";

interface Params {
  params: Promise<{ projectId: string }>;
}

function serializeCompany(company: {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...company,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("Project not found.");
    }

    const companies = await prisma.company.findMany({
      where: { projectId },
      orderBy: [{ name: "asc" }],
    });

    return ok(companies.map(serializeCompany));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = companyCreateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid company create request.", parsed.error.flatten());
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("Project not found.");
    }

    const company = await prisma.company.create({
      data: {
        projectId,
        name: parsed.data.name.trim(),
      },
    });

    return ok(serializeCompany(company), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return badRequest("Company with same name already exists in this project.");
    }
    return serverError(error);
  }
}
