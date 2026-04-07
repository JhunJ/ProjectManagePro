function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveActivityName(activityName: string | null | undefined, name: string | null | undefined) {
  return normalizeText(activityName) ?? normalizeText(name) ?? "";
}

export function resolveSiteDisplayText(params: {
  siteDisplayText: string | null | undefined;
  activityName: string | null | undefined;
  name?: string | null | undefined;
}) {
  const activity = resolveActivityName(params.activityName, params.name);
  return normalizeText(params.siteDisplayText) ?? activity;
}

export function isSiteDisplayTextManual(params: {
  siteDisplayText: string | null | undefined;
  activityName: string | null | undefined;
  name?: string | null | undefined;
}) {
  const display = normalizeText(params.siteDisplayText);
  if (!display) {
    return false;
  }

  return display !== resolveActivityName(params.activityName, params.name);
}

export function toStoredSiteDisplayText(params: {
  siteDisplayText: string | null | undefined;
  activityName: string | null | undefined;
  name?: string | null | undefined;
}) {
  const display = normalizeText(params.siteDisplayText);
  if (!display) {
    return null;
  }

  return isSiteDisplayTextManual(params) ? display : null;
}

