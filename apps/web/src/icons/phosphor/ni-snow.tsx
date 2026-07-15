import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Snowflake } from "@phosphor-icons/react/dist/ssr";

export default function NiSnow({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Snowflake className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
