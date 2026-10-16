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
  PUBLIC_BASE_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  }, "PUBLIC_BASE_URL must be an HTTP(S) URL without credentials"),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: z.string().trim().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.string().trim().min(1).optional(),
  CLICK_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  EMBEDDED_WORKER: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1")
    .default("false"),
}).superRefine((environment, context) => {
  const smtpValues = [
    environment.SMTP_HOST,
    environment.SMTP_PORT,
    environment.SMTP_USER,
    environment.SMTP_PASS,
    environment.SMTP_FROM,
  ];
  if (smtpValues.some((value) => value !== undefined)) {
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const) {
      if (environment[key] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "All SMTP settings are required to enable password reset email",
        });
      }
    }
  }
  if (environment.DEMO_MODE && environment.NODE_ENV === "production") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DEMO_MODE"],
      message: "Demo mode cannot be enabled in production",
    });
  }
  if (
    environment.NODE_ENV === "production" &&
    new URL(environment.PUBLIC_BASE_URL).protocol !== "https:"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PUBLIC_BASE_URL"],
      message: "PUBLIC_BASE_URL must use HTTPS in production",
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
