import nodemailer, { type Transporter } from "nodemailer";

export interface PasswordResetMailer {
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
}

export interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export class SmtpPasswordResetMailer implements PasswordResetMailer {
  private readonly transporter: Transporter;

  constructor(private readonly configuration: SmtpConfiguration) {
    this.transporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      auth: {
        user: configuration.user,
        pass: configuration.password,
      },
    });
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    const safeResetUrl = resetUrl
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
    await this.transporter.sendMail({
      from: this.configuration.from,
      to: email,
      subject: "Reset your LinkPulse password",
      text: [
        "We received a request to reset your LinkPulse password.",
        "",
        `Choose a new password using this link: ${resetUrl}`,
        "",
        "This link expires in 30 minutes and can only be used once.",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: [
        "<p>We received a request to reset your LinkPulse password.</p>",
        `<p><a href="${safeResetUrl}">Choose a new password</a></p>`,
        "<p>This link expires in 30 minutes and can only be used once.</p>",
        "<p>If you did not request this, you can ignore this email.</p>",
      ].join(""),
    });
  }
}
