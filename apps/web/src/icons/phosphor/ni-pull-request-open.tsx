import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { GitPullRequest } from "@phosphor-icons/react/dist/ssr";

export default function NiPullRequestOpen({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <GitPullRequest
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
