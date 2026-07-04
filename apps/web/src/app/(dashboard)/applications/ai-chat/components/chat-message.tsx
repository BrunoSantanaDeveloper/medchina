import { Conversation } from "./types";
import { useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Fade, Typography } from "@mui/material";

import NiDuplicate from "@/icons/nexture/ni-duplicate";
import NiLike from "@/icons/nexture/ni-like";
import NiShare from "@/icons/nexture/ni-share";
import NiUnlike from "@/icons/nexture/ni-unlike";
import { cn } from "@/lib/utils";

interface DsMarkdownProps {
  children: string;
  interval?: number;
  onStart?: () => void;
  onEnd?: () => void;
  disableTyping?: boolean;
  answerType?: string;
}

function DsMarkdown({ children, interval = 10, onStart, onEnd, disableTyping = false }: DsMarkdownProps) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (disableTyping) {
      setDisplayedText(children);
      onEnd?.();
      return;
    }

    onStart?.();
    let currentIndex = 0;
    setDisplayedText("");

    const timer = setInterval(() => {
      currentIndex += 1;
      if (currentIndex >= children.length) {
        setDisplayedText(children);
        clearInterval(timer);
        onEnd?.();
      } else {
        setDisplayedText(children.slice(0, currentIndex));
      }
    }, interval);

    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, interval, disableTyping]);

  return (
    <Typography variant="body1" className="font-body leading-relaxed whitespace-pre-line">
      {displayedText}
    </Typography>
  );
}

type ChatMessageProps = {
  conversation: Conversation;
  onAnimationEnd: () => void;
  onAnimationStart: () => void;
  onFeedbackQuestionClick: (question: string) => void;
};

export default function ChatMessage({
  conversation,
  onAnimationEnd,
  onAnimationStart,
  onFeedbackQuestionClick,
}: ChatMessageProps) {
  const [isAnimating, setIsAnimating] = useState(true);

  return (
    <Box key={conversation.id} className="w-full">
      <Card className={cn("w-full", conversation.type === "User" && "ms-auto max-w-xs md:max-w-lg")}>
        <CardContent className="relative">
          {conversation.type === "AI" ? (
            <>
              <DsMarkdown
                answerType="answer"
                interval={10}
                onEnd={() => {
                  setIsAnimating(false);
                  onAnimationEnd();
                }}
                onStart={() => {
                  setIsAnimating(true);
                  onAnimationStart();
                }}
                disableTyping={!conversation.animate}
              >
                {conversation.message}
              </DsMarkdown>

              <Fade in={!isAnimating} timeout={{ enter: 200 }}>
                <Box className="mt-4 flex flex-row items-end gap-1">
                  <Button
                    size="tiny"
                    color="grey"
                    variant="pastel"
                    startIcon={<NiLike size={"small"} />}
                    className="[.active]:text-primary [.active]:bg-grey-25 hover:text-primary [.active:hover]:text-text-primary icon-only min-w-0 md:min-w-16"
                  ></Button>
                  <Button
                    size="tiny"
                    color="grey"
                    variant="pastel"
                    startIcon={<NiUnlike size={"small"} />}
                    className="[.active]:text-primary [.active]:bg-grey-25 hover:text-primary [.active:hover]:text-text-primary icon-only min-w-0 md:min-w-16"
                  ></Button>
                  <Button
                    size="tiny"
                    color="grey"
                    variant="pastel"
                    startIcon={<NiDuplicate size={"small"} />}
                    className="[.active]:text-primary [.active]:bg-grey-25 hover:text-primary [.active:hover]:text-text-primary icon-only min-w-0 md:min-w-16"
                  ></Button>
                  <Button
                    size="tiny"
                    color="grey"
                    variant="pastel"
                    startIcon={<NiShare size={"small"} />}
                    className="[.active]:text-primary [.active]:bg-grey-25 hover:text-primary [.active:hover]:text-text-primary icon-only min-w-0 md:min-w-16"
                  ></Button>
                </Box>
              </Fade>
            </>
          ) : (
            <Typography variant="body1" className="whitespace-pre-line">
              {conversation.message}
            </Typography>
          )}
        </CardContent>
      </Card>
      {conversation.type === "AI" && (
        <Fade in={!isAnimating} timeout={{ enter: 200 }}>
          <Box className="ms-auto mt-2 flex flex-col items-end gap-1">
            <Button
              variant="outlined"
              color="grey"
              className="hover:text-primary"
              onClick={() => {
                onFeedbackQuestionClick("Can you make it longer?");
              }}
            >
              Can you make it longer?
            </Button>
            <Button
              variant="outlined"
              color="grey"
              className="hover:text-primary"
              onClick={() => {
                onFeedbackQuestionClick("How can I write my own essay like this?");
              }}
            >
              How can I write my own essay like this?
            </Button>
            <Button
              variant="outlined"
              color="grey"
              className="hover:text-primary"
              onClick={() => {
                onFeedbackQuestionClick("Flyee is a nice template isn't it?");
              }}
            >
              Flyee is a nice template isn't it?
            </Button>
          </Box>
        </Fade>
      )}
    </Box>
  );
}
