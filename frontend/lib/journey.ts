// Every campaign moves through the same five steps. The UI always shows where a campaign is and what the owner
// does next, so the product reads as one flow instead of a set of tabs.
import type { CampaignDetail, CampaignSummary } from "./types";

export const STEPS = [
  { key: "brief", label: "Brief", who: "You" },
  { key: "offer", label: "Offer", who: "You lock it" },
  { key: "posts", label: "Posts", who: "You approve" },
  { key: "share", label: "Share", who: "You post" },
  { key: "results", label: "Results", who: "Counted" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

/** Index of the step the campaign is on (0..4); 5 means finished. */
export function stepOfSummary(c: CampaignSummary): number {
  if (c.is_historical || c.status === "concluded" || c.status === "retired") return 5;
  if ((c.redemptions ?? 0) > 0) return 4;
  if ((c.live ?? 0) > 0) return 3;
  if (c.assets > 0) return 2;
  return 1;
}

export function stepOfDetail(d: CampaignDetail): number {
  if (d.campaign.is_historical || d.campaign.status === "concluded") return 5;
  const locked = d.facts.some((f) => f.status === "locked");
  if (!locked) return 1;
  const assets = d.assets.filter((a) => a.status !== "rejected");
  const live = assets.filter((a) => a.status === "live");
  if (!live.length) return 2;
  const redeemed = assets.reduce((n, a) => n + (a.outcomes?.redeem ?? 0), 0);
  return redeemed > 0 ? 4 : 3;
}

/** What the owner should do next on a campaign, in plain words. */
export function nextAction(step: number, d?: CampaignDetail): string {
  switch (step) {
    case 1:
      return d?.facts.some((f) => f.status === "draft") ? "Check the offer and lock it" : "Counterpart is writing the offer down";
    case 2: {
      const ready = d?.assets.filter((a) => a.status === "valid").length ?? 0;
      return d && !ready ? "Counterpart is writing the posts" : "Approve the posts you like";
    }
    case 3:
      return "Post them and put the QR code on your counter";
    case 4:
      return "Customers are redeeming";
    default:
      return "Finished";
  }
}
