import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SpeakerSlash } from "@phosphor-icons/react/dist/ssr";

export default function NiSoundOff({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SpeakerSlash className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
