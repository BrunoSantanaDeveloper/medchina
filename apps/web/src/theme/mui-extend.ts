import { PaletteColor, PaletteColorOptions } from "@mui/material";

declare module "@mui/material/styles" {
  interface Color {
    25: string;
  }

  interface Palette {
    "accent-1": PaletteColor;
    "accent-2": PaletteColor;
    "accent-3": PaletteColor;
    "accent-4": PaletteColor;
    "text-primary": PaletteColor;
    "text-secondary": PaletteColor;
    "text-disabled": PaletteColor;
    "text-muted": PaletteColor;
  }

  interface PaletteOptions {
    "accent-1": PaletteColorOptions;
    "accent-2": PaletteColorOptions;
    "accent-3": PaletteColorOptions;
    "accent-4": PaletteColorOptions;
    "text-primary": PaletteColorOptions;
    "text-secondary": PaletteColorOptions;
    "text-disabled": PaletteColorOptions;
    "text-muted": PaletteColorOptions;
  }
}

declare module "@mui/material/Chip" {
  interface ChipPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }

  interface ChipClasses {
    colorPrimary: string;
    colorSecondary: string;
    "colorAccent-1": string;
    "colorAccent-2": string;
    "colorAccent-3": string;
    "colorAccent-4": string;
    "colorText-primary": string;
    "colorText-secondary": string;
    "colorText-disabled": string;
    colorSuccess: string;
    colorError: string;
    colorWarning: string;
    colorInfo: string;
    colorGrey: string;
    // MUI 9 builds the root class list as root + {variant} + size{Size} +
    // color{Color} (Chip.js, useUtilityClasses). The composed
    // `outlined{Color}` of MUI 5 is gone. Fifteen declarations for it used to
    // sit here, and because TypeScript accepted `chipClasses.outlinedError`
    // without complaint, fourteen stylesheet rules written against those
    // classes stayed dead and invisible for the whole life of the file.
    // Declare only what the DOM actually receives.
  }

  interface ChipOwnProps {
    disableRipple?: boolean;
    disableElevation?: boolean;
  }
}

declare module "@mui/material/CircularProgress" {
  interface CircularProgressPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/LinearProgress" {
  interface LinearProgressPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/Badge" {
  interface BadgePropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/ToggleButton" {
  interface ToggleButtonPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }

  interface ToggleButtonPropsSizeOverrides {
    tiny: true;
  }
}

declare module "@mui/material/ToggleButtonGroup" {
  interface ToggleButtonGroupPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }

  interface ToggleButtonGroupPropsSizeOverrides {
    tiny: true;
  }
}

declare module "@mui/material/Button" {
  interface ButtonPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }

  interface ButtonPropsVariantOverrides {
    pastel: true;
    surface: true;
  }

  interface ButtonPropsSizeOverrides {
    tiny: true;
  }

  interface ButtonClasses {
    sizeTiny: string;
    pastel: string;
    surface: string;
    // MUI 9 builds a class list as Mui{Comp}-{variant} + Mui{Comp}-color{Color}.
    // The composed `contained{Color}` / `text{Color}` / `outlined{Color}` /
    // `pastel{Color}` / `surface{Color}` of MUI 5 are gone. They used to be
    // declared here, and because TypeScript accepted `buttonClasses.outlinedPrimary`
    // without complaint, the stylesheet rules written against them stayed dead and
    // invisible. `variant` and `size` names that the theme really adds stay.
  }
}

declare module "@mui/material/ButtonGroup" {
  interface ButtonGroupPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }

  interface ButtonGroupPropsVariantOverrides {
    pastel: true;
    surface: true;
  }

  interface ButtonGroupPropsSizeOverrides {
    tiny: true;
  }

  interface ButtonGroupClasses {
    sizeTiny: string;
    pastel: string;
    surface: string;
    // MUI 9 builds a class list as Mui{Comp}-{variant} + Mui{Comp}-color{Color}.
    // The composed `contained{Color}` / `text{Color}` / `outlined{Color}` /
    // `pastel{Color}` / `surface{Color}` of MUI 5 are gone. They used to be
    // declared here, and because TypeScript accepted `buttonClasses.outlinedPrimary`
    // without complaint, the stylesheet rules written against them stayed dead and
    // invisible. `variant` and `size` names that the theme really adds stay.
  }
}

declare module "@mui/material/Checkbox" {
  interface CheckboxPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/Switch" {
  interface SwitchPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/Slider" {
  interface SliderPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/Fab" {
  interface FabPropsSizeOverrides {
    xlarge: true;
  }

  interface FabGroupClasses {
    sizeXlarge: string;
  }

  interface FabPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/Radio" {
  interface RadioPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }
}

declare module "@mui/material/styles" {
  interface BreakpointOverrides {
    "2xl": true;
    "3xl": true;
  }
}

declare module "@mui/material/IconButton" {
  interface IconButtonPropsColorOverrides {
    "accent-1": true;
    "accent-2": true;
    "accent-3": true;
    "accent-4": true;
    "text-primary": true;
    "text-secondary": true;
    "text-disabled": true;
    grey: true;
  }

  interface IconButtonPropsSizeOverrides {
    tiny: true;
  }

  interface IconButtonClasses {
    sizeTiny: string;
  }
}

declare module "@mui/x-charts" {
  interface TooltipPropsOverrides {
    hideTitle?: boolean;
  }
}

declare module "@mui/x-tree-view/models" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export type TreeViewBaseItem<T = {}> = import("@mui/x-tree-view").TreeViewDefaultItemModelProperties & T;
}
