"use client";

import { SettingsSectionShell } from "../../../components/settings/SettingsSectionShell";
import { DisplaySettingsClient } from "../../../components/settings/DisplaySettingsClient";

export default function DisplaySettingsPage() {
  return (
    <SettingsSectionShell portfolioConfigMode="eager">
      <DisplaySettingsClient />
    </SettingsSectionShell>
  );
}
