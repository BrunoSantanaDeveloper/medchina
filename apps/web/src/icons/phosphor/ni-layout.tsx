import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Layout } from "@phosphor-icons/react/dist/ssr";

export default function NiLayout({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Layout className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
