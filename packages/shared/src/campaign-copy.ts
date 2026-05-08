import type { LocaleCode } from "./index";

export type LocaleDirection = "ltr" | "rtl";

export interface CampaignCopyConceptHint {
  conceptId?: string;
  name?: string;
  strategicIdea?: string;
}

export interface CampaignCopyRequest {
  brief: {
    marketingMessage: string;
    campaignGoal: "awareness" | "consideration" | "conversion" | "retention";
    targetAudience?: string;
    notes?: string;
  };
  targetLocale: LocaleCode;
  tone: string | string[];
  complianceNotes?: string;
  conceptHint?: CampaignCopyConceptHint;
  riskWarningRequired?: boolean;
}

export interface CampaignCopyResponse {
  locale: LocaleCode;
  direction: LocaleDirection;
  headline: string;
  subheadline: string;
  body?: string;
  cta: string;
  disclaimer: string;
  complianceNotes: string[];
}
