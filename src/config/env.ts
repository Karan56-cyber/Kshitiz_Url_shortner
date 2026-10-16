import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  REDIS_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.string().url(),
  CLICK_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
}).superRefine((environment, context) => {
  if (environment.DEMO_MODE && environment.NODE_ENV === "production") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DEMO_MODE"],
      message: "Demo mode cannot be enabled in production",
    });
  }
  if (!environment.DEMO_MODE && !environment.DATABASE_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message: "DATABASE_URL is required unless DEMO_MODE is enabled",
    });
  }
  if (!environment.DEMO_MODE && !environment.REDIS_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REDIS_URL"],
      message: "REDIS_URL is required unless DEMO_MODE is enabled",
    });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(input);
}
