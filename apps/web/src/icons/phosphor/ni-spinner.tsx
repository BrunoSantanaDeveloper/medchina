import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Spinner } from "@phosphor-icons/react/dist/ssr";

export default function NiSpinner({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Spinner className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
