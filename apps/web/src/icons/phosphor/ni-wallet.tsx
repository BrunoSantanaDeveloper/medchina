import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Wallet } from "@phosphor-icons/react/dist/ssr";

export default function NiWallet({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Wallet className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
