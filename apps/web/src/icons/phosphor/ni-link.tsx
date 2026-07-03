import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Link } from "@phosphor-icons/react/dist/ssr";

export default function NiLink({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Link className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
