import { describe, expect, it } from "vitest";

import {
  isSiteDisplayTextManual,
  resolveActivityName,
  resolveSiteDisplayText,
  toStoredSiteDisplayText,
} from "@/lib/site-display-text";

describe("site display text helpers", () => {
  it("resolves activity and site display text with activity fallback", () => {
    expect(resolveActivityName("  타설  ", null)).toBe("타설");
    expect(resolveSiteDisplayText({ siteDisplayText: null, activityName: "타설" })).toBe("타설");
  });

  it("treats matching site display text as automatic", () => {
    expect(
      isSiteDisplayTextManual({
        siteDisplayText: "먹메김",
        activityName: "먹메김",
      }),
    ).toBe(false);

    expect(
      toStoredSiteDisplayText({
        siteDisplayText: "먹메김",
        activityName: "먹메김",
      }),
    ).toBeNull();
  });

  it("keeps different site display text as manual override", () => {
    expect(
      isSiteDisplayTextManual({
        siteDisplayText: "201동 1~8층 먹메김",
        activityName: "201동 먹메김",
      }),
    ).toBe(true);

    expect(
      toStoredSiteDisplayText({
        siteDisplayText: "201동 1~8층 먹메김",
        activityName: "201동 먹메김",
      }),
    ).toBe("201동 1~8층 먹메김");
  });
});

