import { apiFetch } from "./http";

export type StartForm = {
  branding?: import("@repo/shared/branding").AccountBranding;
  account_name: string;
  template_name: string;
  shared_link: boolean;
  require_email_2fa: boolean;
  link_form_fields: string[];
};

export type StartFormSubmitter = {
  email?: string;
  name?: string;
  phone?: string;
};

export type StartFormSubmitResponse = {
  signing_slug: string;
  signing_url: string;
};

export function getStartForm(slug: string): Promise<StartForm> {
  return apiFetch<StartForm>(`/start-form/${slug}`);
}

export function submitStartForm(
  slug: string,
  input: StartFormSubmitter & { one_time_code?: string },
): Promise<StartFormSubmitResponse> {
  return apiFetch<StartFormSubmitResponse>(`/start-form/${slug}`, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function sendStartFormEmailVerification(
  slug: string,
  input: StartFormSubmitter & { email: string },
): Promise<{ email: string; status: "sent" }> {
  return apiFetch<{ email: string; status: "sent" }>(
    `/start-form/${slug}/email-verification/send`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

export function verifyStartFormEmail(
  slug: string,
  input: StartFormSubmitter & { one_time_code: string },
): Promise<StartFormSubmitResponse> {
  return apiFetch<StartFormSubmitResponse>(
    `/start-form/${slug}/email-verification/check`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

