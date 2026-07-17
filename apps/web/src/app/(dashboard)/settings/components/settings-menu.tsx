import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";

import NiBuilding from "@/icons/nexture/ni-building";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiUser from "@/icons/nexture/ni-user";
import NiWallet from "@/icons/nexture/ni-wallet";

export type SettingsMenuActive = "profile" | "organization" | "preferences" | "billing" | "security";

type GroupProps = { label: string };

const Group = ({ label }: GroupProps) => (
  <ListItem disablePadding>
    <ListItemButton className="pointer-events-none mt-4">
      <ListItemText
        primary={label}
        slotProps={{
          primary: { className: "text-xs! font-semibold! opacity-40" },
        }}
      />
    </ListItemButton>
  </ListItem>
);

type ItemProps = {
  href: string;
  label: string;
  icon: React.ReactNode;
  selected?: boolean;
};

const Item = ({ href, label, icon, selected }: ItemProps) => (
  <ListItem disablePadding>
    <ListItemButton href={href} LinkComponent={Link} selected={selected}>
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText primary={label} />
    </ListItemButton>
  </ListItem>
);

/** Only real destinations — every item leads to a working settings page. */
export default function SettingsMenu({ active }: { active: SettingsMenuActive }) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-4">
      <List className="-mt-6">
        <Group label={t("settings-group-personal")} />
        <Item
          href="/settings"
          label={t("settings-profile")}
          icon={<NiUser size="medium" />}
          selected={active === "profile"}
        />
        <Item
          href="/settings/security"
          label={t("settings-security")}
          icon={<NiCheckSquare size="medium" />}
          selected={active === "security"}
        />

        <Group label={t("settings-group-practice")} />
        <Item
          href="/settings/organization"
          label={t("settings-practice")}
          icon={<NiBuilding size="medium" />}
          selected={active === "organization"}
        />
        <Item
          href="/settings/preferences"
          label={t("settings-preferences")}
          icon={<NiMicrophone size="medium" />}
          selected={active === "preferences"}
        />
        <Group label={t("settings-group-payment")} />
        <Item
          href="/settings/billing"
          label={t("settings-billing")}
          icon={<NiWallet size="medium" />}
          selected={active === "billing"}
        />
      </List>
    </Box>
  );
}
