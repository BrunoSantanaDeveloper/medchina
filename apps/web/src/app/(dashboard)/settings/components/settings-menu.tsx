import Link from "next/link";

import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";

import NiBasket from "@/icons/nexture/ni-basket";
import NiBell from "@/icons/nexture/ni-bell";
import NiBuilding from "@/icons/nexture/ni-building";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiEmail from "@/icons/nexture/ni-email";
import NiLaptop from "@/icons/nexture/ni-laptop";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiLock from "@/icons/nexture/ni-lock";
import NiMoneyBag from "@/icons/nexture/ni-money-bag";
import NiPaintRoller from "@/icons/nexture/ni-paint-roller";
import NiPlug from "@/icons/nexture/ni-plug";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiStars from "@/icons/nexture/ni-stars";
import NiUser from "@/icons/nexture/ni-user";
import NiUsers from "@/icons/nexture/ni-users";
import NiWallet from "@/icons/nexture/ni-wallet";

export type SettingsMenuActive = "profile" | "organization" | "connections" | "billing";

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

export default function SettingsMenu({ active }: { active: SettingsMenuActive }) {
  return (
    <Box className="flex flex-col gap-4">
      <List className="-mt-6">
        <Group label="Personal" />
        <Item href="/settings" label="Profile" icon={<NiUser size="medium" />} selected={active === "profile"} />
        <Item href="/settings" label="Friends" icon={<NiUsers size="medium" />} />
        <Item href="/settings" label="Account" icon={<NiDocumentFull size="medium" />} />

        <Group label="Organization" />
        <Item
          href="/settings/organization"
          label="Organization"
          icon={<NiBuilding size="medium" />}
          selected={active === "organization"}
        />

        <Item
          href="/settings/connections"
          label="Connections"
          icon={<NiPlug size="medium" />}
          selected={active === "connections"}
        />

        <Group label="Payment" />
        <Item
          href="/settings/billing"
          label="Billing"
          icon={<NiWallet size="medium" />}
          selected={active === "billing"}
        />
        <Item href="/settings" label="Invoice" icon={<NiReceipt size="medium" />} />
        <Item href="/settings" label="Tax Info" icon={<NiMoneyBag size="medium" />} />
        <Item href="/settings" label="Payment Methods" icon={<NiBasket size="medium" />} />

        <Group label="Security" />
        <Item href="/settings" label="Password" icon={<NiLock size="medium" />} />
        <Item href="/settings" label="Two Factor Auth" icon={<NiCheckSquare size="medium" />} />
        <Item href="/settings" label="Devices" icon={<NiLaptop size="medium" />} />
        <Item href="/settings" label="Logs" icon={<NiListCircle size="medium" />} />

        <Group label="Preferences" />
        <Item href="/settings" label="Notifications" icon={<NiBell size="medium" />} />
        <Item href="/settings" label="Emails" icon={<NiEmail size="medium" />} />
        <Item href="/settings" label="Appearance" icon={<NiPaintRoller size="medium" />} />
        <Item href="/settings" label="Moderation" icon={<NiStars size="medium" />} />
      </List>
    </Box>
  );
}
