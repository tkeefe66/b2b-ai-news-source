import { z } from "zod";

export const briefPayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headline: z.string().min(1).max(160),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  topStories: z
    .array(
      z.object({
        title: z.string().min(1),
        whyItMatters: z.string().min(1),
        dbAngle: z
          .object({
            strength: z.enum(["strong", "moderate"]),
            text: z.string().min(1),
          })
          .optional(),
        sourceName: z.string().min(1),
        link: z.string().url(),
        articleId: z.number(),
      }),
    )
    .min(1)
    .max(5),
  competitorWatch: z.array(
    z.object({
      competitor: z.string().min(1),
      summary: z.string().min(1),
      links: z.array(z.object({ title: z.string(), url: z.string() })),
    }),
  ),
  trendPulse: z.array(
    z.object({
      trend: z.string().min(1),
      direction: z.enum(["rising", "cooling"]),
      note: z.string().min(1),
    }),
  ),
  radar: z
    .array(z.object({ title: z.string().min(1), sourceName: z.string(), link: z.string() }))
    .max(8),
  contentIdea: z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      deepLink: z.string().min(1),
    })
    .optional(),
  quietDay: z.boolean(),
});

export type BriefPayload = z.infer<typeof briefPayloadSchema>;
export type TopStory = BriefPayload["topStories"][number];
