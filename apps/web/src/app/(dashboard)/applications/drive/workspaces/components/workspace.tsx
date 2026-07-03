import { WorkspaceData } from "../page";
import Link from "next/link";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import NiEllipsisHorizontal from "@/icons/nexture/ni-ellipsis-horizontal";
import NextureIcons from "@/icons/nexture-icons";
import { cn } from "@/lib/utils";

export default function Workspace(workdspaceData: WorkspaceData) {
  return (
    <Card>
      <CardContent className="flex flex-col">
        <Box className="mb-4 flex flex-row justify-between">
          <Link href={workdspaceData.link} className="transition-all hover:scale-110">
            <Box
              className={cn(
                "me-3 flex h-12 w-12 flex-none items-center justify-center rounded-full",
                workdspaceData.iconBgClassName,
              )}
            >
              <NextureIcons icon={workdspaceData.icon} size="medium" className="text-white" />
            </Box>
          </Link>

          <Box className="flex flex-row items-center gap-4">
            <Typography variant="body2">{workdspaceData.users}</Typography>
            <Button
              className="icon-only"
              variant="outlined"
              color="grey"
              size="small"
              startIcon={<NiEllipsisHorizontal size={"small"} />}
            ></Button>
          </Box>
        </Box>

        <Box className="mb-4">
          <Link href={workdspaceData.link} className="link-text-primary link-underline-hover">
            <Typography variant="subtitle2">{workdspaceData.name}</Typography>
          </Link>

          <Typography variant="body2" className="text-text-secondary mb-3">
            {workdspaceData.ownership}
          </Typography>
          <Typography variant="body1" className="text-text-secondary">
            {workdspaceData.description}
          </Typography>
        </Box>

        <Box className="flex flex-row items-end gap-6">
          {workdspaceData.fileTypes.map((file) => {
            return (
              <Box key={file.id} className="flex flex-row items-center gap-1.5">
                <Box className={cn("h-4 w-4 rounded-lg border-2", file.background, file.border)}></Box>
                <Box className="leading-4">{file.name}</Box>
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}
