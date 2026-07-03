import * as React from "react";

import Box from "@mui/material/Box";
import SpeedDial from "@mui/material/SpeedDial";
import SpeedDialAction from "@mui/material/SpeedDialAction";

import NiDuplicate from "@/icons/nexture/ni-duplicate";
import NiFloppyDisk from "@/icons/nexture/ni-floppy-disk";
import NiPlus from "@/icons/nexture/ni-plus";
import NiPrinter from "@/icons/nexture/ni-printer";
import NiShare from "@/icons/nexture/ni-share";

const actions = [
  { icon: <NiDuplicate />, name: "Copy" },
  { icon: <NiFloppyDisk />, name: "Save" },
  { icon: <NiPrinter />, name: "Print" },
  { icon: <NiShare />, name: "Share" },
];

export default function SpeedDialControlled() {
  const [open, setOpen] = React.useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <Box className="h-60 grow translate-z-0 transform">
      <SpeedDial
        className="absolute"
        ariaLabel="SpeedDial"
        direction="down"
        icon={<NiPlus size="large" />}
        onClose={handleClose}
        onOpen={handleOpen}
        open={open}
      >
        {actions.map((action) => (
          <SpeedDialAction
            key={action.name}
            icon={action.icon}
            slotProps={{ tooltip: { title: action.name, placement: "right" } }}
            onClick={handleClose}
          />
        ))}
      </SpeedDial>
    </Box>
  );
}
