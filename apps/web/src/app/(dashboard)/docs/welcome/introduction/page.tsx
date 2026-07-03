"use client";

import DocsMenu from "../../sections/docs-menu";
import Link from "next/link";
import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark, atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";

import { Box, Breadcrumbs, Button, Card, CardContent, Drawer, Tooltip, Typography } from "@mui/material";
import { Grid } from "@mui/material";

import NiCatalog from "@/icons/nexture/ni-catalog";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import { useThemeContext } from "@/theme/theme-provider";

const MenuContent = () => {
  return (
    <Box className="flex flex-col gap-4">
      <DocsMenu selectedID="docs-introduction" />
    </Box>
  );
};

export default function DocsWelcomeIntroduction() {
  const [openDrawer, setOpenDrawer] = useState(false);
  const toggleDrawer = (newOpen: boolean) => () => {
    setOpenDrawer(newOpen);
  };

  const { isDarkMode } = useThemeContext();

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <MenuContent />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              Introduction
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/dashboards/default">
                Home
              </Link>
              <Link color="inherit" href="/docs">
                Docs
              </Link>
              <Link color="inherit" href="/docs/welcome">
                Welcome
              </Link>
              <Typography variant="body2">Introduction</Typography>
            </Breadcrumbs>
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title="Table of Contents">
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={toggleDrawer(true)}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        <Grid size={12}>
          <Card>
            <CardContent>
              <Typography variant="h5" component="h5" className="card-title">
                Gogo-Next React MUI Tailwind Admin Template
              </Typography>
              <Box>
                <Typography variant="body1" component="p">
                  Components, plugins, blocks, and layouts built with MUI, styled with Tailwind, and routed with Nextjs
                  in a beautiful harmony.
                </Typography>
                <br />
                <Typography variant="body1" component="ul">
                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      Author
                    </Typography>
                    <Typography variant="body1" component="p">
                      ColoredStrategies
                    </Typography>
                  </Typography>
                  <br />
                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      Version
                    </Typography>
                    <Typography variant="body1" component="p">
                      6.3.0
                    </Typography>
                  </Typography>
                  <br />

                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      React Version
                    </Typography>
                    <Typography variant="body1" component="p">
                      19.1.0
                    </Typography>
                  </Typography>
                  <br />

                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      MUI Version
                    </Typography>
                    <Typography variant="body1" component="p">
                      7.2.0
                    </Typography>
                  </Typography>
                  <br />

                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      MUI X Version
                    </Typography>
                    <Typography variant="body1" component="p">
                      8.8.0
                    </Typography>
                  </Typography>
                  <br />

                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      Tailwind Version
                    </Typography>
                    <Typography variant="body1" component="p">
                      4.1.10
                    </Typography>
                  </Typography>
                  <br />

                  <Typography variant="body1" component="li">
                    <Typography variant="subtitle1" component="p">
                      Next Version
                    </Typography>
                    <Typography variant="body1" component="p">
                      15.3
                    </Typography>
                  </Typography>
                  <br />
                </Typography>
                <br />

                <Box className="flex flex-row justify-start gap-2">
                  <Button
                    size="medium"
                    color="primary"
                    variant="contained"
                    startIcon={<NiSendUpRight size={"medium"} />}
                    href="/"
                    target="_blank"
                    component={Link}
                  >
                    View Home
                  </Button>

                  <Button
                    size="medium"
                    color="primary"
                    variant="pastel"
                    startIcon={<NiCatalog size={"medium"} />}
                    href="https://www.figma.com/design/CCUQejXdGzW2wMj2SCt8Sz/Gogo-Design---Preview?node-id=1381-11546&t=ZvHFuhjjUoY6u9ul-1"
                    target="_blank"
                    component={Link}
                  >
                    Figma
                  </Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={12}>
          <Card>
            <CardContent>
              <Typography variant="h5" component="h5" className="card-title">
                Package Versions
              </Typography>
              <Typography variant="body1" component="p">
                Below is the full package.json file with all the project dependencies.
              </Typography>

              <Box className="bg-grey-20 syntax-highlighter mt-3 rounded-lg p-4">
                <SyntaxHighlighter
                  className="bg-transparent!"
                  language="json"
                  style={isDarkMode ? atomOneDark : atomOneLight}
                  codeTagProps={{ className: "border-none" }}
                  showLineNumbers
                >
                  {`{
  "name": "gogo-next-mui-admin",
  "version": "6.3.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "lint:fix": "next lint --fix",
    "prettier": "prettier --write './src/**/*.{js,jsx,json,ts,tsx,scss,css,md}'"
  },
  "dependencies": {
    "@emotion/cache": "11.14.0",
    "@emotion/react": "11.14.0",
    "@emotion/styled": "11.14.0",
    "@mui/icons-material": "7.1.2",
    "@mui/lab": "7.0.0-beta.14",
    "@mui/material": "7.2.0",
    "@mui/material-nextjs": "7.2.0",
    "@mui/x-charts": "8.8.0",
    "@mui/x-charts-pro": "8.8.0",
    "@mui/x-data-grid": "8.8.0",
    "@mui/x-data-grid-generator": "8.8.0",
    "@mui/x-data-grid-premium": "8.8.0",
    "@mui/x-data-grid-pro": "8.8.0",
    "@mui/x-date-pickers": "8.8.0",
    "@mui/x-date-pickers-pro": "8.8.0",
    "@mui/x-tree-view": "8.8.0",
    "@mui/x-tree-view-pro": "8.8.0",
    "@react-spring/web": "10.0.1",
    "@types/autosuggest-highlight": "3.2.3",
    "@types/react-scroll-to-bottom": "4.2.5",
    "@types/react-syntax-highlighter": "15.5.13",
    "@vidstack/react": "1.12.13",
    "autosuggest-highlight": "3.3.4",
    "dayjs": "1.11.13",
    "formik": "2.4.6",
    "material-ui-popup-state": "5.3.6",
    "next": "15.3.3",
    "next-intl": "4.1.0",
    "notistack": "3.0.2",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-draggable": "4.4.6",
    "react-dropzone": "14.3.8",
    "react-quill-new": "3.4.6",
    "react-scroll-to-bottom": "4.2.0",
    "react-syntax-highlighter": "15.6.1",
    "react-to-print": "3.1.0",
    "react-use": "17.6.0",
    "swiper": "11.2.8",
    "tailwind-merge": "3.3.1",
    "tw-screens": "1.1.0",
    "yet-another-react-lightbox": "3.23.3",
    "yup": "1.6.1"
  },
  "devDependencies": {
    "@eslint/js": "9.29.0",
    "@next/eslint-plugin-next": "15.3.3",
    "@tailwindcss/postcss": "4.1.10",
    "@types/node": "22.15.32",
    "@types/react": "19.1.8",
    "@types/react-dom": "19.1.6",
    "eslint": "9.29.0",
    "eslint-config-prettier": "10.1.5",
    "eslint-plugin-prettier": "5.5.0",
    "eslint-plugin-react": "7.37.5",
    "eslint-plugin-react-hooks": "5.2.0",
    "eslint-plugin-simple-import-sort": "12.1.1",
    "globals": "16.2.0",
    "husky": "9.1.7",
    "jiti": "2.4.2",
    "lint-staged": "16.1.2",
    "postcss": "8.5.6",
    "prettier": "3.5.3",
    "prettier-plugin-tailwindcss": "0.6.13",
    "tailwindcss": "4.1.10",
    "typescript": "5.8.3",
    "typescript-eslint": "8.34.1"
  }
}`}
                </SyntaxHighlighter>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Drawer open={openDrawer} anchor="right" onClose={toggleDrawer(false)}>
          <Box className="min-w-80 p-7">
            <MenuContent />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
