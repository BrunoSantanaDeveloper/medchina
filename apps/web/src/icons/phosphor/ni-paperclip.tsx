import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Paperclip } from "@phosphor-icons/react/dist/ssr";

export default function NiPaperclip({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Paperclip className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
