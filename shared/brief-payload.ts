import { z } from "zod";

// zod v3 `.url()` accepts any WHATWG-parseable URL, including `javascript:` and
// `data:` schemes. These fields land in `<a href>` in the rendered email and the
// client archive page, so restrict to http(s) only.
const httpUrl = z
  .string()
  .url()
  .refine(u => /^https?:\/\//i.test(u), { message: "must be an http(s) URL" });

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
        link: httpUrl,
        articleId: z.number(),
      }),
    )
    .min(1)
    .max(5),
  competitorWatch: z.array(
    z.object({
      competitor: z.string().min(1),
      summary: z.string().min(1),
      links: z.array(z.object({ title: z.string(), url: httpUrl })),
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
    .array(z.object({ title: z.string().min(1), sourceName: z.string(), link: httpUrl }))
    .max(8),
  contentIdea: z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      deepLink: z.string().regex(/^\//, "must be an app-relative path"),
    })
    .optional(),
  quietDay: z.boolean(),
});

export type BriefPayload = z.infer<typeof briefPayloadSchema>;
export type TopStory = BriefPayload["topStories"][number];
