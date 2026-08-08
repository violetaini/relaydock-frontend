import { describe, expect, it } from "vitest";
import { filterTrafficHistory } from "./console";

const history = [
  { date: "2026-07-31", used_gb: 1 },
  { date: "2026-08-01", used_gb: 2 },
  { date: "2026-08-03", used_gb: 3 },
  { date: "2026-08-08", used_gb: 4 },
];

describe("dashboard traffic periods", () => {
  const now = new Date(2026, 7, 8, 12);

  it("uses the current local calendar day", () => {
    expect(filterTrafficHistory(history, "today", now).map((item) => item.date)).toEqual(["2026-08-08"]);
  });

  it("uses Monday as the start of the current week", () => {
    expect(filterTrafficHistory(history, "week", now).map((item) => item.date)).toEqual(["2026-08-03", "2026-08-08"]);
  });

  it("does not include the previous month", () => {
    expect(filterTrafficHistory(history, "month", now).map((item) => item.date)).toEqual(["2026-08-01", "2026-08-03", "2026-08-08"]);
  });
});
