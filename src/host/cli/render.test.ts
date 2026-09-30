import { expect, it } from "vitest";
import { renderListing } from "./render.js";

it("labels skipped sessions and homes as entries, not unreadable homes", () => {
  const listing = {
    rows: [],
    failures: [
      {
        agent: "pi" as const,
        home: "/readable",
        message: "session ambiguous has conflicting repository identity evidence",
      },
    ],
  };
  const lines = renderListing(listing, "/destination");
  expect(lines).toContain("1 entry skipped:");
  expect(lines.join("\n")).toContain(listing.failures[0]?.message);
  expect(
    renderListing(
      { ...listing, failures: [...listing.failures, ...listing.failures] },
      "/destination",
    ),
  ).toContain("2 entries skipped:");
});
