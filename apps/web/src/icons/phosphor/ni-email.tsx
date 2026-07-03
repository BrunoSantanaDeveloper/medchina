import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiEmail({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <EnvelopeSimple
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
