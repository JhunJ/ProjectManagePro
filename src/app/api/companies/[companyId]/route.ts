import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { companyUpdateSchema } from "@/lib/validations/schemas";

interface Params {
  params: Promise<{ companyId: string }>;
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

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { companyId } = await context.params;
    const body = await request.json();
    const parsed = companyUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid company update request.", parsed.error.flatten());
    }

    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
      return notFound("Company not found.");
    }

    const updated = await prisma.company.update({
      where: { id: companyId },
      data: {
        name: parsed.data.name === undefined ? undefined : parsed.data.name.trim(),
      },
    });

    return ok(serializeCompany(updated));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return badRequest("Company with same name already exists in this project.");
    }
    return serverError(error);
  }
}

export async function DELETE(_: NextRequest, context: Params) {
  try {
    const { companyId } = await context.params;

    const existing = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existing) {
      return notFound("Company not found.");
    }

    await prisma.company.delete({ where: { id: companyId } });
    return ok({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
