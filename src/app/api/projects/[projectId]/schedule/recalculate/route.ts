import { NextRequest } from "next/server";

import { badRequest, ok, serverError } from "@/lib/http";
import { recalculateSchema } from "@/lib/validations/schemas";
import { recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = recalculateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("재계산 요청이 유효하지 않습니다.", parsed.error.flatten());
    }

    const changed = await recalculateAndPersistSchedule({
      projectId,
      anchorTaskIds: parsed.data.anchorTaskIds,
    });

    return ok({
      changedTaskIds: changed.map((task) => task.id),
      count: changed.length,
    });
  } catch (error) {
    return serverError(error);
  }
}
