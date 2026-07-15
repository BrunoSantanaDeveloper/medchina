import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { EyeClosed } from "@phosphor-icons/react/dist/ssr";

export default function NiEyeClose({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <EyeClosed className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
