import { z } from 'zod';

export const localeSchema = z.enum(['zh-CN', 'en-US']);
export const platformSchema = z.enum(['x', 'facebook', 'instagram']);

export const problemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string(),
  code: z.string(),
  requestId: z.string(),
  traceId: z.string().optional(),
  action: z.string().optional(),
});

export const platformSettingsSchema = z.discriminatedUnion('platform', [
  z.object({ platform: z.literal('x'), replyToId: z.string().optional() }),
  z.object({
    platform: z.literal('facebook'),
    postType: z.enum(['feed', 'photo', 'video', 'reel']),
    link: z.string().url().optional(),
  }),
  z.object({
    platform: z.literal('instagram'),
    postType: z.enum(['feed', 'carousel', 'reel', 'story']),
    collaborators: z.array(z.string()).max(3).optional(),
  }),
]);

export const createPublicationSchema = z.object({
  contentVersionId: z.string().min(1),
  accountId: z.string().min(1),
  text: z.string(),
  contentLocale: localeSchema,
  scheduledAt: z.iso.datetime().optional(),
  settings: platformSettingsSchema,
});

export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
