import { describe, expect, it } from "vitest";
import { forwardingBillingModeLabel, normalizeForwardingBillingMode } from "./forwarding-billing";

describe("forwarding billing normalization", () => {
  it("keeps explicit modes and defaults unknown legacy values to both", () => {
    expect(normalizeForwardingBillingMode("both")).toBe("both");
    expect(normalizeForwardingBillingMode("upload")).toBe("upload");
    expect(normalizeForwardingBillingMode("download")).toBe("download");
    expect(normalizeForwardingBillingMode(null, "download")).toBe("download");
    expect(normalizeForwardingBillingMode(null, "invalid")).toBe("both");
    expect(forwardingBillingModeLabel("upload")).toBe("仅算上行");
    expect(forwardingBillingModeLabel("download")).toBe("仅算下行");
    expect(forwardingBillingModeLabel("both")).toBe("双向");
  });
});
