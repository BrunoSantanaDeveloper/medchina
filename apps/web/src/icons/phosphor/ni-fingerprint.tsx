import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Fingerprint } from "@phosphor-icons/react/dist/ssr";

export default function NiFingerprint({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Fingerprint className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
