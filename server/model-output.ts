import { z } from "zod";

export function assertCompletion(reason: unknown): void {
  if (reason !== "end_turn" && reason !== "STOP") {
    throw new Error("AI response was incomplete or refused. Please retry with a smaller request.");
  }
}

export function parseAIJson<S extends z.ZodTypeAny>(text: string | null | undefined, schema: S): z.infer<S> {
  if (!text?.trim()) throw new Error("AI returned no structured content. Please retry.");
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
  const result = JSON.parse(cleaned);
  if (result === null || typeof result !== "object") {
    throw new Error("AI returned an invalid structured result. Please retry.");
  }
  const validated = schema.safeParse(result);
  if (!validated.success) throw new Error("AI returned structured content with missing or invalid fields. Please retry.");
  return validated.data;
}
const text = z.string().trim().min(1);
const texts = z.array(text);
const ids = z.array(z.number().int().positive());
const percent = z.number().min(0).max(100);
const question = z.object({id:text,question:text,why:text});
const slideOutline = z.array(z.object({slideNumber:z.number().int().positive(),title:text,keyPoints:texts,speakerNotes:z.string()})).min(1);
const crawlEntry = z.object({category:text,title:text,content:text});
const opportunity = z.object({
  title:text,format:text,audience:text,thesis:text,demandbase_angle:text,
  talking_points:texts,timeliness:text,competitive_differentiation:text,
});

export const modelOutputSchemas = {
  slideOutline,
  presentation:z.object({headline:text,storyArc:text,slideOutline,talkTrack:text}),
  rewrite:z.object({title:text,content:text}),
  consolidation:crawlEntry,
  crawlEntries:z.array(crawlEntry),
  imageDescriptions:z.array(z.object({imageIndex:z.number().int().nonnegative(),description:text})),
  slideProposal:z.object({explanation:text,proposedDesignNotes:text,proposedSampleTitle:text,proposedSampleBody:text}),
  slideDesigns:z.array(z.object({
    name:text,description:text,isNew:z.boolean(),
    existingLayoutId:z.enum(["title","content","stats","comparison","section","statement","quote","objection","callout","closing","speakers","timeline"]),
    designNotes:text,designDetails:text,suggestedChanges:z.string(),sampleTitle:text,sampleBody:text,slideNums:ids,
  })),
  trendAnalysis:z.object({
    title:text,summary:text,keyThemes:texts,insights:text,
    visualData:z.object({
      topCompanies:z.array(z.object({name:text,mentions:z.number().int().nonnegative(),sentiment:z.enum(["positive","neutral","negative"])})),
      categoryBreakdown:z.array(z.object({category:text,percentage:percent,articleCount:z.number().int().nonnegative()})),
      emergingSignals:z.array(z.object({name:text,type:z.enum(["rising","emerging","breakout"]),description:text,confidence:percent,relatedCompanies:texts})),
      trendDirection:z.array(z.object({topic:text,direction:z.enum(["up","down","stable"]),momentum:percent})),
    }),
  }),
  thoughtLeadership:z.object({title:text,summary:text,opportunities:z.array(opportunity)}),
  opportunity,
  questions:z.object({acknowledgment:text,questions:z.array(question).min(1)}),
  followup:z.object({ready:z.boolean(),reaction:text,questions:z.array(question)}).refine(v => v.ready || v.questions.length > 0,"Unready response requires questions"),
  snapshot:z.object({
    trends:z.array(z.object({name:text,description:text,category:text,momentum:z.enum(["rising","stable","declining"]),confidence:z.number().min(0).max(1),articleIds:ids})),
    emergingSignals:z.array(z.object({name:text,description:text,category:text})),
    companySentiment:z.array(z.object({company:text,sentiment:z.number().min(-1).max(1),label:z.enum(["positive","negative","neutral","mixed"]),trending:z.enum(["improving","declining","stable"]),reason:text})),
  }),
  knowledgeReview:z.object({
    conflicts:z.array(z.object({type:z.enum(["contradiction","outdated","duplicate","vague"]),severity:z.enum(["high","medium","low"]),entryIds:ids,description:text,recommendation:text})),
    suggestions:z.array(z.object({type:z.enum(["merge","update","delete","clarify"]),entryIds:ids,description:text,conflictIndex:z.number().int().nonnegative()})),
  }).refine(v => v.conflicts.length === v.suggestions.length && v.suggestions.every((s,i) => s.conflictIndex === i),"Each conflict requires its matching suggestion"),
  knowledgeResolution:z.discriminatedUnion("needsClarification",[
    z.object({needsClarification:z.literal(true),questions:texts.min(1).max(2)}),
    z.object({needsClarification:z.literal(false),resolution:z.enum(["keep","merge","update","delete","clarify"]),explanation:text,title:z.string(),content:z.string(),category:z.string(),deleteIds:ids}),
  ]),
  companyAnalysis:z.object({companyName:text,ticker:text.nullable(),financialOutlook:text,strategicDirection:text,growthSignals:text,risksAndChallenges:text,demandbaseOpportunity:text,sourcesUsed:texts}),
  knowledgeEntries:z.array(z.object({category:text,title:text,content:text,sourceUrl:text.nullable(),confidence:z.number().min(0).max(1).optional()})),
};
