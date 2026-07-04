import Link from "next/link";

import { Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import NextureIcons from "@/icons/nexture-icons";

export default function ExtensionMore() {
  return (
    <Card className="mb-5">
      <CardContent>
        <Typography variant="h6" component="h6" className="card-title">
          More From Flyee
        </Typography>
        <Grid container size={12} className="w-full" spacing={2.5}>
          <Grid size={{ lg: 6, xs: 12 }}>
            <Card className="border-grey-50 rounded-lg border shadow-none!">
              <CardContent className="flex flex-col">
                <Box className="mb-4 flex flex-row justify-between">
                  <Link
                    href="/applications/ai-chat/extension-detail?extension=flash"
                    className="transition-all hover:scale-110"
                  >
                    <Box className="bg-primary/10 me-3 flex h-12 w-12 flex-none items-center justify-center rounded-full">
                      <NextureIcons icon="NiMessage" size="medium" className="text-primary" />
                    </Box>
                  </Link>

                  <Box className="flex flex-row items-center gap-4">
                    <Typography variant="body2">274,521 Users</Typography>
                    <Button variant="outlined" color="grey" size="tiny">
                      Install
                    </Button>
                  </Box>
                </Box>

                <Box className="mb-4">
                  <Link
                    href="/applications/ai-chat/extension-detail?extension=flash"
                    className="link-text-primary link-underline-hover"
                  >
                    <Typography variant="subtitle2">Grammar Checker</Typography>
                  </Link>

                  <Typography variant="body2" className="text-text-secondary mb-3">
                    Writing
                  </Typography>
                  <Typography variant="body1" className="text-text-secondary line-clamp-2">
                    Polish your writing with AI precision. Instantly fix grammar, enhance style, and boost clarity
                    across emails, documents, and content—so you always...
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ lg: 6, xs: 12 }}>
            <Card className="border-grey-50 rounded-lg border shadow-none!">
              <CardContent className="flex flex-col">
                <Box className="mb-4 flex flex-row justify-between">
                  <Link
                    href="/applications/ai-chat/extension-detail?extension=flash"
                    className="transition-all hover:scale-110"
                  >
                    <Box className="bg-accent-1/10 me-3 flex h-12 w-12 flex-none items-center justify-center rounded-full">
                      <NextureIcons icon="NiMusic" size="medium" className="text-accent-1" />
                    </Box>
                  </Link>

                  <Box className="flex flex-row items-center gap-4">
                    <Typography variant="body2">187,114 Users</Typography>
                    <Button variant="outlined" color="grey" size="tiny">
                      Install
                    </Button>
                  </Box>
                </Box>

                <Box className="mb-4">
                  <Link
                    href="/applications/ai-chat/extension-detail?extension=flash"
                    className="link-text-primary link-underline-hover"
                  >
                    <Typography variant="subtitle2">Melody Maker</Typography>
                  </Link>

                  <Typography variant="body2" className="text-text-secondary mb-3">
                    Lifestyle
                  </Typography>
                  <Typography variant="body1" className="text-text-secondary line-clamp-2">
                    Music creation app that helps users compose original melodies, harmonize tracks, and explore
                    different musical styles. It offers intuitive tools for songwriti...
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
