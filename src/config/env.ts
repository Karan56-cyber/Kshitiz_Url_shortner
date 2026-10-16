import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  REDIS_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),
  CLICK_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  EMBEDDED_WORKER: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(input);
}
