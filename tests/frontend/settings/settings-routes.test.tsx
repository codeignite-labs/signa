import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AccountPage from "../../../apps/frontend/app/settings/account/page";
import ApiPage from "../../../apps/frontend/app/settings/api/page";
import ESignaturePage from "../../../apps/frontend/app/settings/e-signature/page";
import IntegrationsPage from "../../../apps/frontend/app/settings/integrations/page";
import NotificationsPage from "../../../apps/frontend/app/settings/notifications/page";
import PersonalizationPage from "../../../apps/frontend/app/settings/personalization/page";
import PlansPage from "../../../apps/frontend/app/settings/plans/page";
import ProfilePage from "../../../apps/frontend/app/settings/profile/page";
import TeamsPage from "../../../apps/frontend/app/settings/teams/page";
import UsersPage from "../../../apps/frontend/app/settings/users/page";
import WebhooksPage from "../../../apps/frontend/app/settings/webhooks/page";
// The bodies have independent behavior suites; this verifies each route's page and navigation wiring.
vi.mock(
  "../../../apps/frontend/app/templates/_components/console-header",
  () => ({ ConsoleHeader: () => <nav aria-label="Application navigation" /> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/account-settings-body",
  () => ({ AccountSettingsBody: () => <h1>Account</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/api-settings-body",
  () => ({ ApiSettingsBody: () => <h1>API</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/e-signature-settings-body",
  () => ({ ESignatureSettingsBody: () => <h1>E-Signature</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/integrations-settings-body",
  () => ({ IntegrationsSettingsBody: () => <h1>Integrations</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/notifications-settings-body",
  () => ({ NotificationsSettingsBody: () => <h1>Notifications</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/personalization-settings-body",
  () => ({ PersonalizationSettingsBody: () => <h1>Personalization</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/plans-settings-body",
  () => ({ PlansSettingsBody: () => <h1>Plans</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/profile-settings-body",
  () => ({ ProfileSettingsBody: () => <h1>Profile</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/teams-settings-body",
  () => ({ TeamsSettingsBody: () => <h1>Teams</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/users-settings-body",
  () => ({ UsersSettingsBody: () => <h1>Users</h1> }),
);
vi.mock(
  "../../../apps/frontend/app/settings/_components/webhooks-settings-body",
  () => ({ WebhooksSettingsBody: () => <h1>Webhooks</h1> }),
);
it.each([
  ["Account", AccountPage],
  ["API", ApiPage],
  ["E-Signature", ESignaturePage],
  ["Integrations", IntegrationsPage],
  ["Notifications", NotificationsPage],
  ["Personalization", PersonalizationPage],
  ["Plans", PlansPage],
  ["Profile", ProfilePage],
  ["Teams", TeamsPage],
  ["Users", UsersPage],
  ["Webhooks", WebhooksPage],
] as const)(
  "renders the %s settings route with the expected body and skip-link target",
  (title, Page) => {
    render(<Page />);
    const main = screen.getByRole("main");
    expect(main.id).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(
      within(main).getByRole("navigation", { name: "Application navigation" }),
    ).toBeTruthy();
    expect(within(main).getByRole("heading", { name: title })).toBeTruthy();
  },
);
