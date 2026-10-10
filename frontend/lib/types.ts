export type Lang = "en" | "kn" | "hi";
export type Channel = "instagram_post" | "instagram_story" | "whatsapp" | "poster";

export interface LedgerEvent {
  id: number;
  business_id: string;
  campaign_id: string | null;
  actor: "owner" | "agent" | "system" | "customer";
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  locality: string;
  city: string;
  languages: Lang[];
  profile: Record<string, any>;
}

export interface Finding {
  priority: number;
  kind: string;
  message: string;
  [k: string]: unknown;
}

export interface InboxItem {
  id: string;
  campaign_id: string | null;
  kind: "approval" | "recommendation" | "finding" | "notice";
  title: string;
  body: string | null;
  payload: { tool?: string; args?: Record<string, any>; effect?: string; evidence?: string[]; expected_impact?: string };
  status: string;
  created_at: string;
}

export interface Memory {
  id: string;
  kind: string;
  status: string;
  content: string;
  scope: Record<string, string>;
  confidence: number | null;
  created_by: string;
  created_at: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  is_historical: boolean;
  created_at: string;
  assets: number;
  redemptions: number;
  live: number;
  cover_url: string | null;
}

export interface Overview {
  business: Business;
  brand: { version: number; dna: Record<string, any> } | null;
  campaigns: CampaignSummary[];
  inbox: InboxItem[];
  learnings: Memory[];
  findings: Finding[];
}

export interface Fact {
  key: string;
  label: string;
  type: string;
  value: unknown;
  display: Partial<Record<Lang, string>>;
  required: boolean;
}

export interface FactsVersion {
  id: string;
  version: number;
  status: "draft" | "locked" | "superseded";
  facts: Fact[];
  forbidden_claims: Partial<Record<Lang, string[]>>;
  change_reason: string | null;
  locked_at: string | null;
  wording_check: WordingCheck | null;
}

/** Each translated fact wording read back into English and compared before locking. */
export interface WordingCheck {
  status: "passed" | "failed" | "unchecked";
  issues: { key: string; lang: Lang; wording: string; back_translation?: string; issue: string }[];
  back_translations: Record<string, Partial<Record<Lang, string>>>;
  note: string | null;
  /** Facts with numbers the owner never gave (e.g. dates Counterpart picked). Locking confirms them. */
  assumed?: { key: string; label: string; numbers: string[] }[];
}

export interface Segment {
  text: string;
  sources: string[];
}

export interface Check {
  layer: string;
  name: string;
  passed: boolean;
  detail: string;
  severity: "block" | "warn";
  evidence: string[];
}

export interface Validation {
  passed: boolean;
  facts_version: number;
  l3: string;
  checks: Check[];
  back_translation?: string;
}

export interface Revision {
  n: number;
  content: { headline: Segment[]; body: Segment[]; cta: Segment[]; hashtags: string[] };
  rendered: { headline: string; body: string; cta: string; hashtags: string[]; offer?: string[] } | null;
  facts_version: number | null;
  features: Record<string, any> | null;
  validation: Validation | null;
  created_by: "agent" | "owner";
  reason: string | null;
}

export interface Asset {
  id: string;
  campaign_id: string;
  segment: string;
  channel: Channel;
  language: Lang;
  variant: string | null;
  experiment_id: string | null;
  status: string;
  current_revision: number | null;
  revision: Revision | null;
  touchpoints: { code: string; kind: string }[] | null;
  outcomes: Record<string, number> | null;
  image_url: string | null;
  image_source?: { source: Photo["source"]; attribution?: string | null; caption?: string | null } | null;
  instagram?: { media_id: string; permalink: string | null } | null;
}

export interface ExperimentArm {
  asset_id: string;
  variant: string | null;
  successes?: number;
  trials?: number;
  mean?: number;
  ci90_low?: number;
  ci90_high?: number;
  p_best?: number;
  expected_loss?: number;
}

export interface ExperimentStatus {
  experiment: { id: string; hypothesis: string; dimension: string; status: string; trial_type: string; success_type: string };
  prior: { alpha: number; beta: number; from_campaign_assets: number };
  arms: ExperimentArm[];
  decision: { winner: string | null; reason: string; min_trials?: number; loss_threshold?: number };
}

export interface CampaignDetail {
  campaign: {
    id: string;
    name: string;
    status: string;
    brief: string | null;
    goal: Record<string, any>;
    plan: Record<string, any> | null;
    intent: Record<string, any> | null;
    is_historical: boolean;
    autopublish_version?: number | null;
  };
  facts: FactsVersion[];
  assets: Asset[];
  experiments: ExperimentStatus[];
  inbox: InboxItem[];
  culture?: Festival[];
}

export interface ResultRow {
  campaign_id: string;
  campaign: string;
  asset_id: string;
  channel: Channel;
  language: Lang;
  segment: string;
  variant: string | null;
  code: string;
  scans: number;
  claims: number;
  redeemed: number;
  sales: number;
  link: string;
  conversion: number | null;
}
export interface Results {
  posts: ResultRow[];
  totals: { scans: number; claims: number; redeemed: number; sales: number; simulated: number; conversion: number | null };
}

export interface Photo {
  id: string;
  source: "upload" | "website" | "google" | "generated";
  source_url: string | null;
  attribution: string | null;
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  tags: string[];
  kind: string | null;
  status: "active" | "hidden";
  created_at: string;
}

export interface ModelCall {
  at: number;
  role: string;
  provider: string;
  model: string;
  ok: boolean;
  replayed: boolean;
  latency_ms: number;
  error: string | null;
  task: string | null;
}
export interface AgentInfo {
  role: string;
  name: string;
  job: string;
  models: string[];
  calls: number;
  last: ModelCall | null;
}

export interface Festival {
  key: string;
  name: string;
  meaning: string;
  greetings: Partial<Record<Lang, string>>;
  sayings: Partial<Record<Lang, string>>;
  customs: string[];
  angles: string[];
  imagery: string;
  avoid: string[];
  colours: string[];
  dates: { start: string; end: string; label: string }[];
  region: string;
  starts_in_days?: number | null;
}

export interface FunnelGroup {
  key: string;
  posts: number;
  scans: number;
  claims: number;
  redeems: number;
  conversion: number | null;
  likely: [number, number] | null;
}

export interface Tip {
  priority: number;
  kind: string;
  title: string;
  detail: string;
  ask: string | null;
}

export interface Analytics {
  totals: { posts: number; scans: number; claims: number; redeems: number; sales: number; bills: number; average_bill: number | null; claim_rate: number | null; redeem_rate: number | null; conversion: number | null };
  daily: { date: string; scans: number; claims: number; redeems: number }[];
  hours: { hour: number; scans: number; redeems: number }[];
  by: { channel: FunnelGroup[]; language: FunnelGroup[]; segment: FunnelGroup[] };
  posts: (FunnelGroup & { asset_id: string; code: string; channel: Channel; language: Lang; segment: string; variant: string | null; headline: string | null })[];
  simulated: number;
  tips: Tip[];
  ratings?: Record<string, { n: number; average: number }>; // stars from verified visits, per post
  channels?: {
    whatsapp: Record<string, WhatsAppStats>;
    instagram: Record<string, InstagramStats>;
    whatsapp_connected: boolean;
    instagram_connected: boolean;
  };
}

export interface WhatsAppStats {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  clicked: number;
  claimed_on_whatsapp?: number;
  redeemed_from_whatsapp?: number;
}

export interface InstagramStats {
  media_id: string;
  permalink: string | null;
  metrics_at: string | null;
  published_by: "counterpart" | "owner";
  reach?: number;
  likes?: number;
  comments?: number;
  saved?: number;
  shares?: number;
  views?: number;
  total_interactions?: number;
  engagement_rate: number | null;
}

export interface ChannelsStatus {
  public_url: string;
  public_ok: boolean;
  webhook: { url: string; verify_token_set: boolean; app_secret_set: boolean; last_message_at: string | null };
  whatsapp: {
    display: string;
    phone_number_id: string;
    template: { name: string; language: string } | null;
    connected_at: string;
    contacts: { all: number; reachable: number; free_now: number };
  } | null;
  instagram: { username: string; connected_at: string; posts_linked: number } | null;
}
